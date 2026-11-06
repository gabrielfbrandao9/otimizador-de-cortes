package com.gabrielfbrandao.siteapp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * App que mostra um site publicado no GitHub Pages num WebView.
 *
 * O WebView abre o endereço real do site, mas quem responde é o app. Assim links, login e
 * chamadas ao Supabase enxergam o mesmo endereço do site. Cada arquivo vem, nesta ordem:
 *   1. do site publicado, se houver internet (o app se atualiza sozinho e guarda uma cópia);
 *   2. da última cópia baixada;
 *   3. da cópia que veio dentro do APK (assets/www).
 * Bibliotecas externas (jsDelivr, cdnjs, Google Fonts) ficam guardadas para funcionar sem internet.
 *
 * Em toda página HTML entra assets/app/shim.js, que faz funcionar no WebView o que o site
 * espera do navegador: baixar e abrir arquivos, compartilhar, login com Google etc.
 * O que muda de um app para outro está em assets/app/config.properties.
 */
public class MainActivity extends Activity {

    private static final int REQ_SALVAR = 1;
    private static final int REQ_ESCOLHER = 2;
    private static final Pattern HEAD = Pattern.compile("<head[^>]*>", Pattern.CASE_INSENSITIVE);

    private String site;      // https://usuario.github.io/repositorio
    private String siteHost;  // usuario.github.io
    private String sitePath;  // /repositorio
    private String repo;      // usuario/repositorio
    private String apk;       // Nome.apk
    private String retornoLogin; // id.do.app (esquema do endereço de volta do login)

    private WebView web;
    private ValueCallback<Uri[]> escolha;
    private File fotoCamera;
    private Uri fotoCameraUri;
    private String salvandoId;
    private String loginPendente;
    private boolean paginaPronta;
    private volatile long semRedeAte = 0;

    private static final class Transferencia {
        File arquivo;
        String mime;
        OutputStream saida;
    }

    private final Map<String, Transferencia> arquivos = new ConcurrentHashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        lerConfig();
        retornoLogin = getPackageName();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Ponte(), "Android");
        web.setWebViewClient(new Cliente());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, disposicao, mime, tamanho) -> {
            if (url != null && url.startsWith("http")) abrirFora(Uri.parse(url));
        });

        limparCacheDeOutraVersao();
        limparArquivosAntigos();
        guardarRetornoLogin(getIntent());
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(site + "/");
    }

    private void lerConfig() {
        Properties p = new Properties();
        try (InputStream in = getAssets().open("app/config.properties")) {
            p.load(in);
        } catch (IOException e) {
            throw new IllegalStateException("config.properties ausente", e);
        }
        site = p.getProperty("site");
        repo = p.getProperty("repo");
        apk = p.getProperty("apk");
        Uri u = Uri.parse(site);
        siteHost = u.getHost();
        sitePath = u.getPath();
    }

    private String versaoApp() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    // APK novo instalado: a cópia baixada pela versão anterior pode ser mais velha que a do APK
    private void limparCacheDeOutraVersao() {
        SharedPreferences p = getSharedPreferences("app", MODE_PRIVATE);
        String atual = versaoApp();
        if (!atual.equals(p.getString("cacheDaVersao", ""))) {
            apagar(new File(getFilesDir(), "web"));
            p.edit().putString("cacheDaVersao", atual).apply();
        }
    }

    // Arquivos temporários (PDFs abertos, fotos): tira os de mais de um dia
    private void limparArquivosAntigos() {
        File[] pastas = Arquivos.raiz(this).listFiles();
        if (pastas == null) return;
        long limite = System.currentTimeMillis() - 24L * 3600 * 1000;
        for (File f : pastas) if (f.lastModified() < limite) apagar(f);
    }

    private static void apagar(File f) {
        File[] filhos = f.listFiles();
        if (filhos != null) for (File c : filhos) apagar(c);
        f.delete();
    }

    // ---------- Volta do login ----------

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        guardarRetornoLogin(intent);
        entregarLogin();
    }

    private void guardarRetornoLogin(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u != null && retornoLogin.equals(u.getScheme())) loginPendente = u.toString();
    }

    private void entregarLogin() {
        if (loginPendente == null || !paginaPronta) return;
        String url = loginPendente;
        loginPendente = null;
        web.evaluateJavascript("window.onLoginRetorno && window.onLoginRetorno(" + JSONObject.quote(url) + ")", null);
    }

    // ---------- Ciclo de vida ----------

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // Voltar: fecha o diálogo aberto, depois volta uma tela; sem nada para voltar, sai.
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.voltarAndroid && window.voltarAndroid()) === true", valor -> {
            if ("true".equals(valor)) return;
            if (web.canGoBack()) web.goBack();
            else finish();
        });
    }

    private void chamarJs(String js) {
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    private void abrirFora(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            // nenhum app abre esse endereço: ignora
        }
    }

    // ---------- Resultado do seletor de arquivos e do "Salvar como" ----------

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_ESCOLHER) entregarEscolha(resultCode, data);
        else if (requestCode == REQ_SALVAR) terminarSalvar(resultCode == RESULT_OK && data != null ? data.getData() : null);
    }

    private void entregarEscolha(int resultCode, Intent data) {
        ArrayList<Uri> uris = new ArrayList<>();
        if (resultCode == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                ClipData c = data.getClipData();
                for (int i = 0; i < c.getItemCount(); i++) uris.add(c.getItemAt(i).getUri());
            } else if (data != null && data.getData() != null) {
                uris.add(data.getData());
            } else if (fotoCamera != null && fotoCamera.length() > 0) {
                uris.add(fotoCameraUri); // a câmera grava no arquivo que indicamos e não devolve dados
            }
        }
        fotoCamera = null;
        fotoCameraUri = null;
        if (escolha != null) escolha.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0]));
        escolha = null;
    }

    private void terminarSalvar(Uri destino) {
        String id = salvandoId;
        salvandoId = null;
        Transferencia t = id == null ? null : arquivos.get(id);
        if (destino == null || t == null) {
            retornoArquivo(id, false);
            return;
        }
        new Thread(() -> {
            boolean ok = false;
            try (InputStream in = new FileInputStream(t.arquivo);
                 OutputStream out = getContentResolver().openOutputStream(destino, "w")) {
                if (out != null) {
                    byte[] b = new byte[65536];
                    int n;
                    while ((n = in.read(b)) > 0) out.write(b, 0, n);
                    ok = true;
                }
            } catch (Exception e) {
                ok = false;
            }
            retornoArquivo(id, ok);
        }).start();
    }

    private void retornoArquivo(String id, boolean ok) {
        chamarJs("window.__appArquivo && window.__appArquivo(" + JSONObject.quote(id == null ? "" : id) + ", " + ok + ")");
    }

    // ---------- Funções que o site chama como window.Android.xxx(...) ----------

    private class Ponte {
        @JavascriptInterface
        public String versao() {
            return versaoApp();
        }

        @JavascriptInterface
        public String repo() {
            return repo;
        }

        @JavascriptInterface
        public String apk() {
            return apk;
        }

        @JavascriptInterface
        public String enderecoRetorno() {
            return retornoLogin + "://login";
        }

        // Login com Google, links externos e download de versão nova abrem no navegador do celular
        // (o Google não aceita login dentro de WebView)
        @JavascriptInterface
        public void abrirNavegador(String url) {
            Uri u = Uri.parse(url);
            String esquema = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
            if (!esquema.matches("https?|mailto|tel|sms|whatsapp")) return;
            runOnUiThread(() -> abrirFora(u));
        }

        @JavascriptInterface
        public void copiar(String texto) {
            runOnUiThread(() -> {
                ClipboardManager c = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (c != null) c.setPrimaryClip(ClipData.newPlainText("texto", texto));
            });
        }

        @JavascriptInterface
        public void tema(String css) {
            runOnUiThread(() -> {
                int c;
                try {
                    c = Color.parseColor(css.trim());
                } catch (Exception e) {
                    return;
                }
                double luz = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255;
                boolean fundoClaro = luz > 0.6;
                Window w = getWindow();
                w.setStatusBarColor(c);
                w.setNavigationBarColor(c);
                View v = w.getDecorView();
                int f = v.getSystemUiVisibility();
                f = fundoClaro ? (f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
                if (Build.VERSION.SDK_INT >= 26) {
                    f = fundoClaro ? (f | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
                }
                v.setSystemUiVisibility(f);
            });
        }

        // Arquivos passam do site para o app em pedaços, para não estourar a memória em cópias grandes
        @JavascriptInterface
        public String arquivoInicio(String nome, String mime) {
            try {
                String id = UUID.randomUUID().toString();
                File pasta = new File(Arquivos.raiz(MainActivity.this), id);
                if (!pasta.mkdirs()) return "";
                Transferencia t = new Transferencia();
                t.arquivo = new File(pasta, Arquivos.nomeSeguro(nome));
                t.mime = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                t.saida = new FileOutputStream(t.arquivo);
                arquivos.put(id, t);
                return id;
            } catch (IOException e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean arquivoPedaco(String id, String base64) {
            Transferencia t = arquivos.get(id);
            if (t == null || t.saida == null) return false;
            try {
                t.saida.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (IOException | IllegalArgumentException e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean arquivoFim(String id) {
            Transferencia t = arquivos.get(id);
            if (t == null || t.saida == null) return false;
            try {
                t.saida.close();
                t.saida = null;
                return true;
            } catch (IOException e) {
                return false;
            }
        }

        @JavascriptInterface
        public void salvar(String id) {
            runOnUiThread(() -> pedirSalvar(id));
        }

        @JavascriptInterface
        public void abrir(String id) {
            runOnUiThread(() -> {
                Transferencia t = arquivos.get(id);
                if (t == null) return;
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(Arquivos.uri(MainActivity.this, t.arquivo), t.mime);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException e) {
                    pedirSalvar(id); // nenhum app abre esse tipo: oferece salvar
                }
            });
        }

        @JavascriptInterface
        public boolean compartilhar(String idsJson, String texto, String titulo) {
            ArrayList<Uri> uris = new ArrayList<>();
            String mime = null;
            try {
                JSONArray ids = new JSONArray(idsJson);
                for (int k = 0; k < ids.length(); k++) {
                    Transferencia t = arquivos.get(ids.getString(k));
                    if (t == null) return false;
                    uris.add(Arquivos.uri(MainActivity.this, t.arquivo));
                    mime = mime == null || mime.equals(t.mime) ? t.mime : "*/*";
                }
            } catch (Exception e) {
                return false;
            }
            Intent i = new Intent(uris.size() > 1 ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND);
            i.setType(mime == null ? "text/plain" : mime);
            if (texto != null && !texto.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, texto);
            if (titulo != null && !titulo.isEmpty()) i.putExtra(Intent.EXTRA_SUBJECT, titulo);
            if (uris.size() == 1) {
                i.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            } else if (uris.size() > 1) {
                i.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            }
            if (!uris.isEmpty()) {
                ClipData clip = ClipData.newRawUri(null, uris.get(0));
                for (int k = 1; k < uris.size(); k++) clip.addItem(new ClipData.Item(uris.get(k)));
                i.setClipData(clip);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            Intent escolher = Intent.createChooser(i, null);
            runOnUiThread(() -> {
                try {
                    startActivity(escolher);
                } catch (ActivityNotFoundException e) {
                    // sem nenhum app para compartilhar: ignora
                }
            });
            return true;
        }
    }

    private void pedirSalvar(String id) {
        Transferencia t = arquivos.get(id);
        if (t == null || salvandoId != null) {
            retornoArquivo(id, false);
            return;
        }
        salvandoId = id;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(t.mime);
        i.putExtra(Intent.EXTRA_TITLE, t.arquivo.getName());
        try {
            startActivityForResult(i, REQ_SALVAR);
        } catch (ActivityNotFoundException e) {
            salvandoId = null;
            retornoArquivo(id, false);
        }
    }

    // ---------- Entrega dos arquivos do site e das bibliotecas ----------

    private byte[] baixar(String url, String agente, int esperaConexao, int esperaLeitura) throws IOException {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(esperaConexao);
            c.setReadTimeout(esperaLeitura);
            c.setUseCaches(false);
            c.setRequestProperty("Cache-Control", "no-cache");
            if (agente != null) c.setRequestProperty("User-Agent", agente);
            if (c.getResponseCode() != 200) return null;
            try (InputStream in = c.getInputStream()) {
                return tudo(in);
            }
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static byte[] tudo(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        return out.toByteArray();
    }

    private void guardar(File f, byte[] dados) {
        try {
            File dir = f.getParentFile();
            if (dir != null && !dir.isDirectory() && !dir.mkdirs()) return;
            File tmp = new File(f.getPath() + ".tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(dados);
            }
            if (!tmp.renameTo(f)) {
                f.delete();
                tmp.renameTo(f);
            }
        } catch (IOException e) {
            // sem espaço: segue sem guardar
        }
    }

    private byte[] arquivoDoSite(String rel) {
        // 1. Versão mais nova, do site publicado
        if (System.currentTimeMillis() >= semRedeAte) {
            try {
                byte[] novo = baixar(site + rel, null, 2500, 5000);
                if (novo != null) {
                    guardar(new File(new File(getFilesDir(), "web"), rel.substring(1)), novo);
                    return novo;
                }
            } catch (IOException e) {
                // Sem rede: por um tempo usa só as cópias, sem ficar esperando
                semRedeAte = System.currentTimeMillis() + 30000;
            }
        }
        // 2. Última cópia baixada
        File f = new File(new File(getFilesDir(), "web"), rel.substring(1));
        if (f.isFile()) {
            try (InputStream in = new FileInputStream(f)) {
                return tudo(in);
            } catch (IOException e) {
                // tenta a do APK
            }
        }
        // 3. Cópia que veio no APK
        try (InputStream in = getAssets().open("www" + rel)) {
            return tudo(in);
        } catch (IOException e) {
            return null;
        }
    }

    private byte[] comShim(byte[] html) {
        String s = new String(html, StandardCharsets.UTF_8);
        String tag = "<script src=\"" + sitePath + "/__app/shim.js\"></script>";
        Matcher m = HEAD.matcher(s);
        s = m.find() ? s.substring(0, m.end()) + tag + s.substring(m.end()) : tag + s;
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static WebResourceResponse resposta(String mime, InputStream dados) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", h, dados);
    }

    private static WebResourceResponse naoAchou() {
        Map<String, String> h = new HashMap<>();
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", h, new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse doSite(String path) {
        String rel = path.length() > sitePath.length() ? path.substring(sitePath.length()) : "/";
        if (rel.endsWith("/")) rel += "index.html";
        if (rel.contains("..")) return naoAchou();
        if (rel.equals("/__app/shim.js")) {
            try {
                return resposta("text/javascript", getAssets().open("app/shim.js"));
            } catch (IOException e) {
                return naoAchou();
            }
        }
        byte[] dados = arquivoDoSite(rel);
        if (dados == null) return naoAchou();
        if (rel.toLowerCase().endsWith(".html")) dados = comShim(dados);
        return resposta(tipo(rel), new ByteArrayInputStream(dados));
    }

    private static boolean ehBiblioteca(String host) {
        return "cdn.jsdelivr.net".equals(host) || "cdnjs.cloudflare.com".equals(host)
                || "fonts.googleapis.com".equals(host) || "fonts.gstatic.com".equals(host);
    }

    // Os endereços das bibliotecas têm a versão: a cópia guardada vale para sempre
    private WebResourceResponse daBiblioteca(WebResourceRequest req) {
        String url = req.getUrl().toString();
        String nome = sha1(url);
        if (nome == null) return null;
        String mime = "fonts.googleapis.com".equals(req.getUrl().getHost()) ? "text/css" : tipo(req.getUrl().getPath());
        File f = new File(new File(getFilesDir(), "cdn"), nome);
        try {
            if (f.isFile()) return resposta(mime, new FileInputStream(f));
        } catch (IOException e) {
            // baixa de novo
        }
        try {
            return resposta(mime, getAssets().open("cdn/" + nome));
        } catch (IOException e) {
            // não veio no APK
        }
        try {
            byte[] novo = baixar(url, req.getRequestHeaders().get("User-Agent"), 5000, 15000);
            if (novo == null) return null;
            guardar(f, novo);
            return resposta(mime, new ByteArrayInputStream(novo));
        } catch (IOException e) {
            return null;
        }
    }

    private static String sha1(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (byte x : d) b.append(String.format("%02x", x));
            return b.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private boolean ehDoSite(Uri u) {
        String p = u.getPath();
        return siteHost.equals(u.getHost()) && p != null && (p.equals(sitePath) || p.startsWith(sitePath + "/"));
    }

    private class Cliente extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap icone) {
            paginaPronta = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            paginaPronta = true;
            entregarLogin();
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            if (!"GET".equals(req.getMethod())) return null;
            Uri u = req.getUrl();
            if (ehDoSite(u)) return doSite(u.getPath());
            if (ehBiblioteca(u.getHost())) return daBiblioteca(req);
            return null;
        }

        // O que é do site fica no app; o resto abre fora. Quadros internos (iframe) não saem daqui.
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!req.isForMainFrame() || ehDoSite(u)) return false;
            abrirFora(u);
            return true;
        }
    }

    private class Chrome extends WebChromeClient {
        // Diálogos sem o endereço do site no título
        @Override
        public boolean onJsAlert(WebView view, String url, String mensagem, JsResult r) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(mensagem)
                    .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm())
                    .setOnCancelListener(d -> r.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String mensagem, JsResult r) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(mensagem)
                    .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm())
                    .setNegativeButton(android.R.string.cancel, (d, w) -> r.cancel())
                    .setOnCancelListener(d -> r.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String mensagem, String padrao, JsPromptResult r) {
            EditText campo = new EditText(MainActivity.this);
            campo.setText(padrao);
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(mensagem)
                    .setView(campo)
                    .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm(campo.getText().toString()))
                    .setNegativeButton(android.R.string.cancel, (d, w) -> r.cancel())
                    .setOnCancelListener(d -> r.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (escolha != null) escolha.onReceiveValue(null);
            escolha = callback;

            boolean soImagem = aceitaSoImagem(params.getAcceptTypes());
            Intent camera = soImagem ? intentCamera() : null;
            Intent intent;
            if (params.isCaptureEnabled() && camera != null) {
                intent = camera; // <input capture>: vai direto para a câmera
            } else {
                Intent galeria = intentEscolher(params);
                if (camera != null) {
                    intent = Intent.createChooser(galeria, null);
                    intent.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
                } else {
                    intent = galeria;
                }
            }
            try {
                startActivityForResult(intent, REQ_ESCOLHER);
            } catch (ActivityNotFoundException e) {
                escolha = null;
                return false;
            }
            return true;
        }
    }

    private static boolean aceitaSoImagem(String[] tipos) {
        if (tipos == null || tipos.length == 0) return false;
        for (String t : tipos) if (t == null || !t.startsWith("image/")) return false;
        return true;
    }

    private Intent intentEscolher(WebChromeClient.FileChooserParams params) {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        ArrayList<String> mimes = new ArrayList<>();
        boolean porExtensao = false;
        String[] tipos = params.getAcceptTypes();
        if (tipos != null) {
            for (String t : tipos) {
                if (t == null || t.isEmpty()) continue;
                if (t.contains("/")) mimes.add(t);
                else porExtensao = true; // ".json": o Android nem sempre sabe o tipo, então mostra tudo
            }
        }
        if (porExtensao || mimes.isEmpty()) {
            i.setType("*/*");
        } else if (mimes.size() == 1) {
            i.setType(mimes.get(0));
        } else {
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        }
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        return i;
    }

    private Intent intentCamera() {
        File pasta = new File(Arquivos.raiz(this), "camera-" + UUID.randomUUID());
        if (!pasta.mkdirs()) return null;
        fotoCamera = new File(pasta, "foto-" + System.currentTimeMillis() + ".jpg");
        fotoCameraUri = Arquivos.uri(this, fotoCamera);
        Intent i = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, fotoCameraUri);
        i.setClipData(ClipData.newRawUri(null, fotoCameraUri));
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return i.resolveActivity(getPackageManager()) != null || Build.VERSION.SDK_INT >= 30 ? i : null;
    }

    private static String tipo(String path) {
        String p = path == null ? "" : path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".pdf")) return "application/pdf";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }
}
