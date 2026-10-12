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

  const COLORS = {
    color: {
      hatchBg: '#f1ebe1', hatchLine: '#dcd0bc', sheet: '#5c4a36', dim: '#6b5d4d', trim: '#a8977f',
      offStroke: '#9c8a70', offText: '#6b5a45', edge: '#c2410c', cut: '#dc2626', cutDone: '#b5a593',
    },
    mono: {
      hatchBg: '#ffffff', hatchLine: '#dddddd', sheet: '#000000', dim: '#333333', trim: '#888888',
      offStroke: '#777777', offText: '#333333', edge: '#000000', cut: '#000000', cutDone: '#aaaaaa',
    },
  };

  /**
   * @param sheet  chapa do resultado do otimizador
   * @param pieces lista de peças do projeto
   * @param o      { showLabels, showEdges, showOffcuts, showCuts, showOrder, step,
   *                 fontScale, mono, vertical, key, unit }
   *   step: 0 = todos os cortes; k = passo a passo, destacando o corte k
   */
  function sheetSVG(sheet, pieces, o) {
    // Na vista vertical o desenho gira 90° no sentido horário: (x, y) → (H − y, x)
    const vertical = !!o.vertical;
    const H0 = sheet.W;
    const R = (r) => (vertical ? { ...r, x: H0 - r.y - r.h, y: r.x, w: r.h, h: r.w } : r);
    const P = (x, y) => (vertical ? [H0 - y, x] : [x, y]);
    const L = vertical ? sheet.W : sheet.L; // largura na tela
    const W = vertical ? sheet.L : sheet.W; // altura na tela

    const C = o.mono ? COLORS.mono : COLORS.color;
    const k = o.fontScale || 1;
    const M = Math.max(L, W);
    const base = M / 55;
    const tb = base * k; // tamanho do texto das cotas
    const padT = tb * 2;
    const padL = tb * 2;
    const pad = base * 0.5;
    const sw = M / 1100;
    const key = o.key || 'x';
    const u = o.unit ? ` ${o.unit}` : '';

    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-padL} ${-padT} ${L + padL + pad} ${W + padT + pad}"`
      + ` font-family="IBM Plex Sans, Segoe UI, Arial, sans-serif" role="img"`
      + ` aria-label="Plano de corte da chapa ${esc(fmt(sheet.L))}${u} por ${esc(fmt(sheet.W))}${u}">`;

    s += `<defs><pattern id="hatch-${key}" patternUnits="userSpaceOnUse" width="${base * 0.8}" height="${base * 0.8}" patternTransform="rotate(45)">`
      + `<rect width="${base * 0.8}" height="${base * 0.8}" fill="${C.hatchBg}"/>`
      + `<line x1="0" y1="0" x2="0" y2="${base * 0.8}" stroke="${C.hatchLine}" stroke-width="${base * 0.16}"/></pattern></defs>`;

    // Cotas da chapa
    s += `<g stroke="${C.dim}" stroke-width="${sw}">`
      + `<line x1="0" y1="${-tb * 0.6}" x2="${L}" y2="${-tb * 0.6}"/>`
      + `<line x1="0" y1="${-tb * 0.9}" x2="0" y2="${-tb * 0.3}"/>`
      + `<line x1="${L}" y1="${-tb * 0.9}" x2="${L}" y2="${-tb * 0.3}"/>`
      + `<line x1="${-tb * 0.6}" y1="0" x2="${-tb * 0.6}" y2="${W}"/>`
      + `<line x1="${-tb * 0.9}" y1="0" x2="${-tb * 0.3}" y2="0"/>`
      + `<line x1="${-tb * 0.9}" y1="${W}" x2="${-tb * 0.3}" y2="${W}"/></g>`;
    s += `<text x="${L / 2}" y="${-tb * 0.95}" font-size="${tb}" fill="${C.dim}" text-anchor="middle">${esc(fmt(L) + u)}</text>`;
    s += `<text x="${-tb * 0.95}" y="${W / 2}" font-size="${tb}" fill="${C.dim}" text-anchor="middle" transform="rotate(-90 ${-tb * 0.95} ${W / 2})">${esc(fmt(W) + u)}</text>`;

    // Chapa (a área hachurada é sobra)
    s += `<rect x="0" y="0" width="${L}" height="${W}" fill="url(#hatch-${key})" stroke="${C.sheet}" stroke-width="${sw * 2}"/>`;
    if (sheet.trim > 0) {
      const t = sheet.trim;
      s += `<rect x="${t}" y="${t}" width="${L - 2 * t}" height="${W - 2 * t}" fill="none" stroke="${C.trim}" stroke-width="${sw}" stroke-dasharray="${base * 0.4} ${base * 0.3}"/>`;
    }

    // Rótulo com o maior tamanho que cabe, multiplicado pela escala escolhida.
    const label = (lines, r, color, maxFs) => {
      const fit = fitLabel(lines, r.w, r.h, maxFs);
      const fs = fit.fs * k;
      return fs >= base * 0.22 ? textBlock(lines, r.x + r.w / 2, r.y + r.h / 2, fs, color, fit.vertical) : '';
    };

    // Peças
    for (const part of sheet.parts) {
      const p = R(part);
      const piece = pieces[part.piece] || {};
      const c = o.mono ? { fill: '#ffffff', stroke: '#222222', text: '#111111' } : pieceColor(part.piece);
      const name = piece.name || `Peça ${part.piece + 1}`;
      const dims = `${fmt(+piece.length)} × ${fmt(+piece.width)}${u}`;
      s += `<g><title>${esc(name)} — ${esc(dims)}${part.rotated ? ' (girada)' : ''}</title>`;
      s += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${sw * 1.5}"/>`;

      if (o.showEdges && piece.edges) {
        const e = piece.edges;
        // c1/c2 são as bordas do comprimento; com a peça girada elas ficam na vertical.
        let sides = part.rotated
          ? { top: e.l2, bottom: e.l1, left: e.c1, right: e.c2 }
          : { top: e.c1, bottom: e.c2, left: e.l1, right: e.l2 };
        if (vertical) sides = { top: sides.left, right: sides.top, bottom: sides.right, left: sides.bottom };
        const t = Math.min(base * 0.3, Math.min(p.w, p.h) * 0.08);
        const h = t / 2;
        const x2 = p.x + p.w, y2 = p.y + p.h;
        s += `<g stroke="${C.edge}" stroke-width="${t}" stroke-linecap="butt">`;
        if (sides.top) s += `<line x1="${p.x}" y1="${p.y + h}" x2="${x2}" y2="${p.y + h}"/>`;
        if (sides.bottom) s += `<line x1="${p.x}" y1="${y2 - h}" x2="${x2}" y2="${y2 - h}"/>`;
        if (sides.left) s += `<line x1="${p.x + h}" y1="${p.y}" x2="${p.x + h}" y2="${y2}"/>`;
        if (sides.right) s += `<line x1="${x2 - h}" y1="${p.y}" x2="${x2 - h}" y2="${y2}"/>`;
        s += '</g>';
      }

      s += label(o.showLabels ? [name, dims] : [dims], p, c.text, base * 1.1);
      s += '</g>';
    }

    // Sobras: contorno tracejado e medidas
    if (o.showOffcuts && sheet.offcuts) {
      for (const off of sheet.offcuts) {
        const r = R(off);
        const dims = `${fmt(off.w)} × ${fmt(off.h)}${u}`;
        s += `<g><title>Sobra — ${esc(dims)}</title>`
          + `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#ffffff" fill-opacity="0.35" stroke="${C.offStroke}" stroke-width="${sw}" stroke-dasharray="${base * 0.35} ${base * 0.25}"/>`
          + label([dims], r, C.offText, base * 0.9)
          + '</g>';
      }
    }

    // Linhas de corte e ordem dos cortes
    if (o.showCuts || o.showOrder) {
      const step = o.showOrder ? o.step || 0 : 0;
      const shown = [];
      sheet.cuts.forEach((cut, i) => {
        if (step && i >= step) return; // cortes que ainda não foram feitos
        const [x1, y1] = P(cut.x1, cut.y1);
        const [x2, y2] = P(cut.x2, cut.y2);
        const done = step && i < step - 1;
        const current = step && i === step - 1;
        shown.push({ i, x: (x1 + x2) / 2, y: (y1 + y2) / 2, done, current });
        s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${done ? C.cutDone : C.cut}"`
          + ` stroke-width="${current ? sw * 6 : sw * 1.6}"${current ? '' : ` stroke-dasharray="${base * 0.5} ${base * 0.3}"`}/>`;
      });
      if (o.showOrder) {
        s += '<g font-weight="700" text-anchor="middle">';
        for (const m of shown) {
          const r = base * 0.62 * k * (m.current ? 1.5 : 1);
          s += `<circle cx="${m.x}" cy="${m.y}" r="${r}" fill="${m.done ? C.cutDone : C.cut}" stroke="#ffffff" stroke-width="${sw * 2}"/>`
            + `<text x="${m.x}" y="${m.y}" dy="0.35em" font-size="${r * 1.15}" fill="#ffffff">${m.i + 1}</text>`;
        }
        s += '</g>';
      }
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
