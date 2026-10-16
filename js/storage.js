/*
 * Persistência: localStorage, arquivos JSON e CSV.
 */
(function (global) {
  'use strict';

  const KEY_CURRENT = 'otimizador:atual';

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  const Storage = {
    loadCurrent: () => readJSON(KEY_CURRENT, null),
    saveCurrent: (state) => writeJSON(KEY_CURRENT, state),


    download(filename, content, mime) {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    readFile(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsText(file);
      });
    },
  };

  // ---------- CSV ----------
  // Colunas: nome;comprimento;largura;quantidade;veio;chapa;ativa

  const CSV_HEADER = ['nome', 'comprimento', 'largura', 'quantidade', 'veio', 'chapa', 'ativa'];
  const GRAIN_TO_CSV = { none: 'livre', length: 'comprimento', width: 'largura' };

  function detectDelimiter(line) {
    const counts = [';', ',', '\t'].map((d) => [d, line.split(d).length]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][0];
  }

  function splitLine(line, d) {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  function num(s, delimiter) {
    if (s == null || s === '') return NaN;
    let v = String(s).replace(/\s/g, '');
    if (delimiter !== ',') v = v.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    return parseFloat(v);
  }

  function bool(s) {
    return /^(1|s|sim|x|y|yes|true|v|verdadeiro)$/i.test(String(s || '').trim());
  }

  function parseGrain(s) {
    const v = String(s || '').trim().toLowerCase();
    if (/^(larg|width|w$|v$|vert)/.test(v)) return 'width';
    if (/^(c$|comp|length|h$|horiz)/.test(v)) return 'length';
    return 'none';
  }

  function parsePiecesCSV(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const d = detectDelimiter(lines[0]);
    const rows = lines.map((l) => splitLine(l, d));
    let header = null;
    if (rows.length && isNaN(num(rows[0][1], d))) header = rows.shift().map((h) => h.toLowerCase());
    // Arquivos antigos tinham 4 colunas de fita de borda antes de "chapa": são ignoradas.
    const old = header ? header.includes('fita_c1') : rows.some((r) => r.length >= 10);
    const ci = old ? 9 : 5;
    return rows
      .map((r) => ({
        name: r[0] || '',
        length: num(r[1], d),
        width: num(r[2], d),
        qty: Math.max(1, Math.round(num(r[3], d)) || 1),
        grain: parseGrain(r[4]),
        stockName: r[ci] || '',
        enabled: r[ci + 1] == null || r[ci + 1] === '' || bool(r[ci + 1]),
      }))
      .filter((p) => p.length > 0 && p.width > 0);
  }

  function csvCell(v) {
    const s = String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function piecesToCSV(pieces, stocks) {
    const stockName = (id) => ((stocks || []).find((s) => s.id === id) || {}).name || '';
    const lines = [CSV_HEADER.join(';')];
    for (const p of pieces) {
      lines.push([
        p.name, p.length, p.width, p.qty, GRAIN_TO_CSV[p.grain] || 'livre',
        stockName(p.stock), p.enabled === false ? 0 : 1,
      ].map(csvCell).join(';'));
    }
    return '﻿' + lines.join('\r\n');
  }

  Storage.parsePiecesCSV = parsePiecesCSV;
  Storage.piecesToCSV = piecesToCSV;

  global.Store = Storage;
})(window);
