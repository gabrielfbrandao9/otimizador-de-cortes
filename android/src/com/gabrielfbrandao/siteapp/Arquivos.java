package com.gabrielfbrandao.siteapp;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * Entrega a outros apps os arquivos temporários (PDF para abrir, arquivo para compartilhar,
 * foto da câmera), sem dar acesso a nada além da pasta cache/arquivos e só a quem recebeu o link.
 * O endereço é content://id.do.app.arquivos/pasta/nome.
 */
public class Arquivos extends ContentProvider {

    static File raiz(Context c) {
        File r = new File(c.getCacheDir(), "arquivos");
        r.mkdirs();
        return r;
    }

    static Uri uri(Context c, File f) {
        return new Uri.Builder()
                .scheme("content")
                .authority(c.getPackageName() + ".arquivos")
                .appendPath(f.getParentFile().getName())
                .appendPath(f.getName())
                .build();
    }

    static String nomeSeguro(String nome) {
        String n = nome == null ? "" : nome.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.isEmpty()) n = "arquivo";
        return n.length() > 120 ? n.substring(n.length() - 120) : n;
    }

    private File arquivo(Uri uri) throws FileNotFoundException {
        if (uri.getPathSegments().size() != 2) throw new FileNotFoundException();
        File raiz = raiz(getContext());
        File f = new File(new File(raiz, uri.getPathSegments().get(0)), uri.getPathSegments().get(1));
        try {
            if (!f.getCanonicalPath().startsWith(raiz.getCanonicalPath() + File.separator)) {
                throw new FileNotFoundException();
            }
        } catch (IOException e) {
            throw new FileNotFoundException();
        }
        return f;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String modo) throws FileNotFoundException {
        return ParcelFileDescriptor.open(arquivo(uri), ParcelFileDescriptor.parseMode(modo));
    }

    @Override
    public Cursor query(Uri uri, String[] colunas, String selecao, String[] args, String ordem) {
        File f;
        try {
            f = arquivo(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = colunas != null ? colunas : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        Object[] linha = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) linha[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) linha[i] = f.length();
        }
        MatrixCursor c = new MatrixCursor(cols, 1);
        c.addRow(linha);
        return c;
    }

    @Override
    public String getType(Uri uri) {
        String nome = uri.getLastPathSegment();
        int p = nome == null ? -1 : nome.lastIndexOf('.');
        String t = p < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(nome.substring(p + 1).toLowerCase());
        return t != null ? t : "application/octet-stream";
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Uri insert(Uri uri, ContentValues valores) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selecao, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues valores, String selecao, String[] args) {
        return 0;
    }
}
