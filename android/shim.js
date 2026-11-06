/*
 * Entra antes de tudo em cada página do site, dentro do app Android.
 * Faz funcionar no WebView o que o site espera do navegador, sem mudar o código do site:
 * baixar, abrir e compartilhar arquivos, copiar, login com Google, botão voltar,
 * cor das barras do sistema e aviso de versão nova do app.
 */
(function () {
  'use strict';

  const A = window.Android;
  if (!A || window.__appShim) return;
  window.__appShim = true;

  // ---------- Arquivos ----------

  // Guarda os Blobs: muitos sites revogam o endereço logo depois de clicar no link
  const blobs = new Map();
  const criarUrl = URL.createObjectURL;
  const revogarUrl = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    const url = criarUrl.call(URL, obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    revogarUrl.call(URL, url);
    setTimeout(() => blobs.delete(url), 300000);
  };

  async function blobDe(url) {
    if (blobs.has(url)) return blobs.get(url);
    const r = await fetch(url);
    return r.blob();
  }

  function base64(parte) {
    return new Promise((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(',')[1] || '');
      fr.onerror = () => erro(fr.error);
      fr.readAsDataURL(parte);
    });
  }

  const PEDACO = 3 * 512 * 1024; // múltiplo de 3: cada pedaço é um base64 completo

  // Passa o arquivo para o app e devolve o id dele
  async function enviar(blob, nome) {
    const id = A.arquivoInicio(nome, blob.type || '');
    if (!id) throw new Error('Não deu para criar o arquivo no aparelho.');
    for (let i = 0; i < blob.size; i += PEDACO) {
      const b = await base64(blob.slice(i, i + PEDACO));
      if (!A.arquivoPedaco(id, b)) throw new Error('Não deu para gravar o arquivo no aparelho.');
    }
    if (!A.arquivoFim(id)) throw new Error('Não deu para gravar o arquivo no aparelho.');
    return id;
  }

  const EXTENSOES = {
    'application/pdf': 'pdf', 'application/json': 'json', 'application/zip': 'zip',
    'text/csv': 'csv', 'text/plain': 'txt', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  };

  function nomePara(blob) {
    if (blob.name) return blob.name;
    const tipo = (blob.type || '').split(';')[0];
    return 'documento' + (EXTENSOES[tipo] ? '.' + EXTENSOES[tipo] : '');
  }

  function aviso(err) {
    console.error(err);
    alert('Não deu para abrir o arquivo: ' + (err && err.message ? err.message : err));
  }

  async function salvarDe(url, nome) {
    try {
      const blob = await blobDe(url);
      A.salvar(await enviar(blob, nome || nomePara(blob)));
    } catch (err) {
      aviso(err);
    }
  }

  async function abrirDe(url) {
    try {
      const blob = await blobDe(url);
      A.abrir(await enviar(blob, nomePara(blob)));
    } catch (err) {
      aviso(err);
    }
  }

  const ehLocal = (url) => /^(blob|data):/i.test(url);

  window.__appArquivo = function (id, ok) {
    if (!ok) console.info('arquivo não salvo', id);
  };

  // a.click() em link criado pelo código (nem sempre está na página)
  const clicar = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (ehLocal(this.href)) {
      if (this.hasAttribute('download')) salvarDe(this.href, this.getAttribute('download'));
      else abrirDe(this.href);
      return;
    }
    clicar.call(this);
  };

  // Toque em link que está na página
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !ehLocal(a.href) || e.defaultPrevented) return;
    e.preventDefault();
    if (a.hasAttribute('download')) salvarDe(a.href, a.getAttribute('download'));
    else abrirDe(a.href);
  });

  function navegar(url) {
    const abs = new URL(url, location.href).href;
    if (ehLocal(abs)) abrirDe(abs);
    else A.abrirNavegador(abs);
  }

  // Os sites abrem a janela antes de gerar o PDF e só depois dizem o endereço
  function janela() {
    const ir = (url) => { if (!j.closed) navegar(url); };
    const loc = {
      assign: ir,
      replace: ir,
      get href() { return 'about:blank'; },
      set href(url) { ir(url); },
      toString() { return 'about:blank'; },
    };
    const j = {
      closed: false,
      opener: null,
      get location() { return loc; },
      set location(url) { ir(url); },
      close() { j.closed = true; },
      focus() {},
      blur() {},
    };
    return j;
  }

  window.open = function (url) {
    const j = janela();
    if (url && url !== 'about:blank') j.location = url;
    return j;
  };

  // ---------- Compartilhar e copiar ----------

  function definir(nome, valor) {
    Object.defineProperty(navigator, nome, { value: valor, configurable: true });
  }

  definir('share', async function (dados) {
    const d = dados || {};
    const ids = [];
    for (const f of d.files || []) ids.push(await enviar(f, f.name || nomePara(f)));
    const texto = [d.text, d.url].filter(Boolean).join(' ');
    if (!A.compartilhar(JSON.stringify(ids), texto, d.title || '')) {
      throw new DOMException('Não deu para compartilhar.', 'AbortError');
    }
  });
  definir('canShare', () => true);

  const areaReal = navigator.clipboard;
  definir('clipboard', {
    writeText(texto) {
      A.copiar(String(texto));
      return Promise.resolve();
    },
    readText() {
      return areaReal ? areaReal.readText() : Promise.reject(new Error('indisponível'));
    },
  });

  // ---------- Service worker ----------

  // O próprio app guarda os arquivos para usar sem internet
  if (window.ServiceWorkerContainer) {
    ServiceWorkerContainer.prototype.register = () => Promise.reject(new Error('O app guarda os arquivos sozinho.'));
  }

  // ---------- Login (Supabase) ----------

  // O Google não aceita login dentro de WebView: abre no navegador e volta por id.do.app://login
  let clienteLogin = null;

  function adaptarCliente(cliente) {
    const auth = cliente.auth;
    const oauth = auth.signInWithOAuth.bind(auth);
    const otp = auth.signInWithOtp.bind(auth);

    auth.signInWithOAuth = async (dados) => {
      const opcoes = Object.assign({}, dados.options, {
        redirectTo: A.enderecoRetorno(),
        skipBrowserRedirect: true,
        queryParams: Object.assign({ prompt: 'select_account' }, dados.options && dados.options.queryParams),
      });
      const r = await oauth(Object.assign({}, dados, { options: opcoes }));
      if (!r.error && r.data && r.data.url) A.abrirNavegador(r.data.url);
      return r;
    };

    auth.signInWithOtp = (dados) => otp(Object.assign({}, dados, {
      options: Object.assign({}, dados.options, { emailRedirectTo: A.enderecoRetorno() }),
    }));

    clienteLogin = cliente;
    return cliente;
  }

  function adaptarBiblioteca(sb) {
    if (!sb || !sb.createClient) return sb;
    const criar = sb.createClient;
    return Object.assign({}, sb, {
      createClient(url, chave, opcoes) {
        const o = Object.assign({}, opcoes);
        o.auth = Object.assign({}, o.auth, { flowType: 'pkce', detectSessionInUrl: false });
        return adaptarCliente(criar(url, chave, o));
      },
    });
  }

  let supabaseAtual;
  Object.defineProperty(window, 'supabase', {
    configurable: true,
    enumerable: true,
    get() { return supabaseAtual; },
    set(v) { supabaseAtual = adaptarBiblioteca(v); },
  });

  window.onLoginRetorno = async function (endereco) {
    try {
      const u = new URL(endereco);
      const q = new URLSearchParams(u.search);
      const erro = q.get('error_description') || q.get('error');
      if (erro) throw new Error(/denied|cancel/i.test(erro) ? 'Login cancelado.' : erro);
      const codigo = q.get('code');
      if (!codigo || !clienteLogin) return;
      const r = await clienteLogin.auth.exchangeCodeForSession(codigo);
      if (r.error) throw r.error;
      location.reload(); // o site abre já logado, como depois do login no navegador
    } catch (err) {
      alert('Não deu para entrar: ' + (err && err.message ? err.message : err));
    }
  };

  // ---------- Botão voltar ----------

  window.voltarAndroid = function () {
    const abertos = document.querySelectorAll('dialog[open]');
    if (!abertos.length) return false;
    const d = abertos[abertos.length - 1];
    if (d.dispatchEvent(new Event('cancel', { cancelable: true }))) d.close();
    return true;
  };

  // ---------- Cor das barras do sistema ----------

  let corAtual = '';
  function aplicarCor() {
    const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
    const m = metas.find((x) => !x.media || matchMedia(x.media).matches);
    const cor = m && m.content;
    if (cor && cor !== corAtual) {
      corAtual = cor;
      A.tema(cor);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    aplicarCor();
    new MutationObserver(aplicarCor).observe(document.head, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['content', 'media'],
    });
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarCor);

  // ---------- Versão nova do app ----------

  const CHAVE_CONSULTA = '__app:ultimaConsulta';
  const CHAVE_NOVA = '__app:versaoNova';
  const CHAVE_FECHADA = '__app:avisoFechado';
  const SEIS_HORAS = 6 * 3600 * 1000;

  function ler(chave) {
    try { return localStorage.getItem(chave); } catch (e) { return null; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento */ }
  }

  function maisNova(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map(Number);
    const pb = String(b).replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  function mostrarAviso(versao) {
    if (ler(CHAVE_FECHADA) === versao || document.getElementById('__appAviso')) return;
    const caixa = document.createElement('div');
    caixa.id = '__appAviso';
    const sombra = caixa.attachShadow({ mode: 'closed' });
    sombra.innerHTML = `<style>
      .a{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;display:flex;gap:8px;align-items:center;
         padding:10px 12px;border-radius:10px;background:#1c1f24;color:#fff;font:14px/1.3 system-ui,sans-serif;
         box-shadow:0 4px 16px rgba(0,0,0,.35)}
      .t{flex:1}
      button{font:inherit;border:0;border-radius:8px;padding:8px 12px;min-height:40px}
      .b{background:#fff;color:#1c1f24;font-weight:600}
      .x{background:transparent;color:#fff}
    </style>
    <div class="a" role="status"><span class="t">Versão nova do app (${versao.replace(/[^\w.-]/g, '')})</span>
    <button class="b" type="button">Baixar</button><button class="x" type="button" aria-label="Fechar">✕</button></div>`;
    sombra.querySelector('.b').onclick = () => {
      A.abrirNavegador(`https://github.com/${A.repo()}/releases/latest/download/${A.apk()}`);
    };
    sombra.querySelector('.x').onclick = () => {
      gravar(CHAVE_FECHADA, versao);
      caixa.remove();
    };
    document.body.appendChild(caixa);
  }

  async function verAtualizacao() {
    const instalada = A.versao();
    const guardada = ler(CHAVE_NOVA);
    if (guardada && maisNova(guardada, instalada)) mostrarAviso(guardada);
    if (Date.now() - Number(ler(CHAVE_CONSULTA) || 0) < SEIS_HORAS) return;
    try {
      const r = await fetch(`https://api.github.com/repos/${A.repo()}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!r.ok) return;
      const dados = await r.json();
      gravar(CHAVE_CONSULTA, String(Date.now()));
      gravar(CHAVE_NOVA, dados.tag_name || '');
      if (dados.tag_name && maisNova(dados.tag_name, instalada)) mostrarAviso(dados.tag_name);
    } catch (e) {
      /* sem internet: tenta na próxima vez */
    }
  }

  window.addEventListener('load', () => setTimeout(verAtualizacao, 3000));
})();
