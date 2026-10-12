/*
 * Desenho dos planos de corte em SVG e exportação para PNG.
 */
(function (global) {
  'use strict';

  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Números inteiros sem casas decimais; os demais sempre com duas (12,50).
  function fmt(n) {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? nf0.format(r) : nf2.format(r);
  }

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function pieceColor(i) {
    const hue = Math.round((i * 137.508 + 25) % 360);
    return {
      fill: `hsl(${hue}, 60%, 85%)`,
      stroke: `hsl(${hue}, 32%, 38%)`,
      text: `hsl(${hue}, 45%, 18%)`,
      swatch: `hsl(${hue}, 55%, 62%)`,
    };
  }

  // Calcula o maior tamanho de fonte que cabe na peça, na horizontal ou na vertical.
  function fitLabel(lines, w, h, maxFs) {
    const chars = Math.max(...lines.map((l) => l.length), 1);
    const fit = (bw, bh) => Math.min(maxFs, (bh * 0.8) / (lines.length * 1.2), (bw * 0.88) / (chars * 0.58));
    const fh = fit(w, h);
    const fv = fit(h, w);
    return fv > fh * 1.15 ? { fs: fv, vertical: true } : { fs: fh, vertical: false };
  }

  function textBlock(lines, cx, cy, fs, color, vertical) {
    const n = lines.length;
    const rot = vertical ? ` transform="rotate(-90 ${cx} ${cy})"` : '';
    let s = `<text x="${cx}" y="${cy}" font-size="${fs}" fill="${color}" text-anchor="middle"${rot}>`;
    lines.forEach((l, i) => {
      const dy = i === 0 ? `${(-(n - 1) * 1.2) / 2 + 0.35}em` : '1.2em';
      const weight = i === 0 && n > 1 ? ' font-weight="600"' : '';
      s += `<tspan x="${cx}" dy="${dy}"${weight}>${esc(l)}</tspan>`;
    });
    return s + '</text>';
  }

  /**
   * @param sheet  chapa do resultado do otimizador
   * @param pieces lista de peças do projeto
   * @param o      { showLabels, showCuts, showEdges, key, unit }
   */
  function sheetSVG(sheet, pieces, o) {
    const { L, W } = sheet;
    const M = Math.max(L, W);
    const base = M / 55;
    const padT = base * 2;
    const padL = base * 2;
    const pad = base * 0.5;
    const sw = M / 1100;
    const key = o.key || 'x';
    const u = o.unit ? ` ${o.unit}` : '';

    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-padL} ${-padT} ${L + padL + pad} ${W + padT + pad}"`
      + ` font-family="IBM Plex Sans, Segoe UI, Arial, sans-serif" role="img"`
      + ` aria-label="Plano de corte da chapa ${esc(fmt(L))}${u} por ${esc(fmt(W))}${u}">`;

    s += `<defs><pattern id="hatch-${key}" patternUnits="userSpaceOnUse" width="${base * 0.8}" height="${base * 0.8}" patternTransform="rotate(45)">`
      + `<rect width="${base * 0.8}" height="${base * 0.8}" fill="#f1ebe1"/>`
      + `<line x1="0" y1="0" x2="0" y2="${base * 0.8}" stroke="#dcd0bc" stroke-width="${base * 0.16}"/></pattern></defs>`;

    // Cotas da chapa
    const dimColor = '#6b5d4d';
    s += `<g stroke="${dimColor}" stroke-width="${sw}">`
      + `<line x1="0" y1="${-base * 0.6}" x2="${L}" y2="${-base * 0.6}"/>`
      + `<line x1="0" y1="${-base * 0.9}" x2="0" y2="${-base * 0.3}"/>`
      + `<line x1="${L}" y1="${-base * 0.9}" x2="${L}" y2="${-base * 0.3}"/>`
      + `<line x1="${-base * 0.6}" y1="0" x2="${-base * 0.6}" y2="${W}"/>`
      + `<line x1="${-base * 0.9}" y1="0" x2="${-base * 0.3}" y2="0"/>`
      + `<line x1="${-base * 0.9}" y1="${W}" x2="${-base * 0.3}" y2="${W}"/></g>`;
    s += `<text x="${L / 2}" y="${-base * 0.95}" font-size="${base}" fill="${dimColor}" text-anchor="middle">${esc(fmt(L) + u)}</text>`;
    s += `<text x="${-base * 0.95}" y="${W / 2}" font-size="${base}" fill="${dimColor}" text-anchor="middle" transform="rotate(-90 ${-base * 0.95} ${W / 2})">${esc(fmt(W) + u)}</text>`;

    // Chapa (a área hachurada é sobra)
    s += `<rect x="0" y="0" width="${L}" height="${W}" fill="url(#hatch-${key})" stroke="#5c4a36" stroke-width="${sw * 2}"/>`;
    if (sheet.trim > 0) {
      s += `<rect x="${sheet.trim}" y="${sheet.trim}" width="${L - 2 * sheet.trim}" height="${W - 2 * sheet.trim}" fill="none" stroke="#a8977f" stroke-width="${sw}" stroke-dasharray="${base * 0.4} ${base * 0.3}"/>`;
    }

    // Peças
    for (const p of sheet.parts) {
      const piece = pieces[p.piece] || {};
      const c = pieceColor(p.piece);
      const name = piece.name || `Peça ${p.piece + 1}`;
      const dims = `${fmt(+piece.length)} × ${fmt(+piece.width)}${u}`;
      s += `<g><title>${esc(name)} — ${esc(dims)}${p.rotated ? ' (girada)' : ''}</title>`;
      s += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${sw * 1.5}"/>`;

      if (o.showEdges && piece.edges) {
        const e = piece.edges;
        // c1/c2 são as bordas do comprimento; com a peça girada elas ficam na vertical.
        const sides = p.rotated
          ? { top: e.l2, bottom: e.l1, left: e.c1, right: e.c2 }
          : { top: e.c1, bottom: e.c2, left: e.l1, right: e.l2 };
        const t = Math.min(base * 0.3, Math.min(p.w, p.h) * 0.08);
        const h = t / 2;
        const x2 = p.x + p.w, y2 = p.y + p.h;
        s += `<g stroke="#c2410c" stroke-width="${t}" stroke-linecap="butt">`;
        if (sides.top) s += `<line x1="${p.x}" y1="${p.y + h}" x2="${x2}" y2="${p.y + h}"/>`;
        if (sides.bottom) s += `<line x1="${p.x}" y1="${y2 - h}" x2="${x2}" y2="${y2 - h}"/>`;
        if (sides.left) s += `<line x1="${p.x + h}" y1="${p.y}" x2="${p.x + h}" y2="${y2}"/>`;
        if (sides.right) s += `<line x1="${x2 - h}" y1="${p.y}" x2="${x2 - h}" y2="${y2}"/>`;
        s += '</g>';
      }

      const lines = o.showLabels ? [name, dims] : [dims];
      const { fs, vertical } = fitLabel(lines, p.w, p.h, base * 1.1);
      if (fs >= base * 0.28) {
        s += textBlock(lines, p.x + p.w / 2, p.y + p.h / 2, fs, c.text, vertical);
      }
      s += '</g>';
    }

    // Linhas de corte
    if (o.showCuts) {
      s += `<g stroke="#dc2626" stroke-width="${sw * 1.6}" stroke-dasharray="${base * 0.5} ${base * 0.3}">`;
      for (const k of sheet.cuts) s += `<line x1="${k.x1}" y1="${k.y1}" x2="${k.x2}" y2="${k.y2}"/>`;
      s += '</g>';
      // Número de cada corte (o mesmo da tabela "Sequência de cortes")
      const r = base * 0.42;
      s += `<g font-size="${base * 0.48}" font-weight="600" text-anchor="middle">`;
      sheet.cuts.forEach((k, i) => {
        const mx = (k.x1 + k.x2) / 2;
        const my = (k.y1 + k.y2) / 2;
        s += `<circle cx="${mx}" cy="${my}" r="${r}" fill="#dc2626"/>`
          + `<text x="${mx}" y="${my}" dy="0.35em" fill="#ffffff">${i + 1}</text>`;
      });
      s += '</g>';
    }

    return s + '</svg>';
  }

  function svgToPng(svg, filename, width) {
    width = width || 2400;
    return new Promise((resolve, reject) => {
      const vb = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
      const height = Math.round((width * vb[3]) / vb[2]);
      const sized = svg.replace('<svg ', `<svg width="${width}" height="${height}" `);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Falha ao gerar a imagem'));
          global.Store.download(filename, blob);
          resolve();
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Falha ao gerar a imagem'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized);
    });
  }

  global.Render = { sheetSVG, svgToPng, pieceColor, fmt, esc };
})(window);
