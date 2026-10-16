/*
 * PDF do plano de corte com o mesmo visual do site (como a antiga impressão
 * "Imprimir / PDF").
 *
 * O resultado da tela é copiado para uma página invisível, com largura de
 * computador e tema claro (igual à impressão, mesmo no celular ou no modo
 * escuro). Cada parte (resumo, estatísticas, cada chapa) vira uma imagem
 * (html2canvas) e é posta em páginas A4 (jsPDF), sem cortar no meio. Partes
 * mais altas que uma página, como uma sequência de cortes longa, quebram entre
 * as linhas da tabela.
 *
 * As bibliotecas são carregadas só quando precisa (e ficam guardadas para usar
 * sem internet).
 */
(function (global) {
  'use strict';

  const JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
  const HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';

  const RENDER_W = 1000; // largura (px) da página invisível
  const PAGE_W = 210;    // A4 em pé (mm)
  const PAGE_H = 297;
  const MARGIN = 10;
  const FOOTER = 8;      // espaço do rodapé (mm)
  const GAP = 4;         // espaço entre as partes (mm)
  const SCALE = 2;       // nitidez das imagens

  function loadScript(src, doc) {
    doc = doc || document;
    return new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('o gerador de PDF não carregou. Verifique a internet e tente de novo.'));
      doc.head.appendChild(s);
    });
  }

  let jspdfLoading = null;
  function loadJsPdf() {
    if (global.jspdf && global.jspdf.jsPDF) return Promise.resolve();
    if (!jspdfLoading) jspdfLoading = loadScript(JSPDF).catch((e) => { jspdfLoading = null; throw e; });
    return jspdfLoading;
  }

  const clean = (s) => String(s == null ? '' : s)
    .replace(/[−–—]/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '');

  // Desenho SVG de uma chapa como imagem PNG (o html2canvas lida melhor com imagens).
  function svgToPng(svg, width) {
    return new Promise((resolve, reject) => {
      const src = svg.outerHTML;
      const vb = src.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
      const height = Math.round((width * vb[3]) / vb[2]);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const g = c.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, width, height);
        g.drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('falha ao desenhar a chapa'));
      const sized = src.replace(/^<svg /, `<svg width="${width}" height="${height}" `).replace(/ style="[^"]*"/, '');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized);
    });
  }

  // Página invisível com o CSS do site, largura de computador e tema claro.
  async function makeFrame() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-${RENDER_W + 2000}px;top:0;width:${RENDER_W}px;height:1200px;border:0;pointer-events:none`;
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const css = new URL('css/style.css', document.baseURI).href;
    doc.open();
    doc.write(`<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8">
      <link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="${css}">
      <style>
        html, body { background: #ffffff !important; margin: 0; padding: 0; min-height: 0; }
        .pdf-page { width: ${RENDER_W}px; }
        .results.stale { opacity: 1; }
        .no-print { display: none !important; }
        .svg-wrap { max-height: none !important; overflow: visible !important; }
        .svg-wrap img { display: block; width: 100%; height: auto; }
        .sheet, .panel, .stat, .card { box-shadow: none !important; }
        .sheets { gap: 0; }
      </style></head>
      <body><main class="pdf-page"><section class="results" id="results"></section></main></body></html>`);
    doc.close();
    // Espera o CSS e as fontes.
    await new Promise((resolve) => {
      const done = () => resolve();
      if (doc.readyState === 'complete') setTimeout(done, 50);
      else frame.addEventListener('load', done, { once: true });
      setTimeout(done, 4000);
    });
    try { await doc.fonts.ready; } catch (e) { /* sem suporte */ }
    await loadScript(HTML2CANVAS, doc);
    return frame;
  }

  // Posições (px, a partir do topo do bloco) onde dá para quebrar a página.
  function breakpoints(el) {
    const top = el.getBoundingClientRect().top;
    const pts = new Set();
    el.querySelectorAll('tr, li, .svg-wrap, header, .sheet-stats, .cuts > summary, .cuts-help, .kv, .parts-list').forEach((n) => {
      pts.add(Math.round(n.getBoundingClientRect().bottom - top));
    });
    return [...pts].sort((a, b) => a - b);
  }

  /**
   * @param resultsEl  o elemento #results da tela
   * @param project    projeto (para o nome do arquivo e o rodapé)
   * @param opts       { sheetStats: [html] } estatísticas de cada chapa, no lugar da aba da tela
   * @returns { blob, name }
   */
  async function build(resultsEl, project, opts) {
    opts = opts || {};
    await loadJsPdf();
    const frame = await makeFrame();
    try {
      const fdoc = frame.contentDocument;
      const box = fdoc.getElementById('results');

      // Cópia do resultado: sem botões, com tudo aberto e os desenhos como imagem.
      const copy = resultsEl.cloneNode(true);
      // Estatísticas por chapa: na tela só a aba escolhida; no PDF, todas as chapas.
      const panel = copy.querySelector('.panel-sheet');
      if (panel && opts.sheetStats && opts.sheetStats.length) {
        const tmp = document.createElement('div');
        tmp.innerHTML = opts.sheetStats.join('');
        panel.replaceWith(...tmp.children);
      }
      copy.querySelectorAll('.no-print').forEach((n) => n.remove());
      copy.querySelectorAll('details').forEach((d) => { d.open = true; });
      const svgs = [...resultsEl.querySelectorAll('.svg-wrap svg')];
      const copies = [...copy.querySelectorAll('.svg-wrap svg')];
      for (let i = 0; i < svgs.length; i++) {
        const img = document.createElement('img');
        img.src = await svgToPng(svgs[i], 2000);
        img.alt = '';
        copies[i].replaceWith(img);
      }
      box.innerHTML = copy.innerHTML;
      await Promise.all([...box.querySelectorAll('img')].map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; }))));

      // Partes que não devem ser cortadas no meio.
      const blocks = [];
      [...box.children].forEach((el) => {
        if (el.classList.contains('sheets')) blocks.push(...el.children);
        else blocks.push(el);
      });

      const { jsPDF } = global.jspdf;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const k = (PAGE_W - 2 * MARGIN) / RENDER_W; // mm por px
      const bottom = PAGE_H - MARGIN - FOOTER;
      let y = MARGIN;
      let first = true;

      const newPage = () => {
        pdf.addPage();
        y = MARGIN;
      };

      for (const el of blocks) {
        if (!el.getBoundingClientRect().height) continue;
        const canvas = await frame.contentWindow.html2canvas(el, {
          scale: SCALE, backgroundColor: '#ffffff', logging: false, useCORS: true,
          windowWidth: RENDER_W,
        });
        const rect = el.getBoundingClientRect();
        const x = MARGIN + rect.left * k;
        const wMm = rect.width * k;
        const hPx = rect.height;
        const pts = breakpoints(el);

        // Cada chapa começa numa página nova (como na antiga impressão).
        if (el.classList.contains('sheet') && y > MARGIN + 1) newPage();
        else if (!first) y += GAP;
        first = false;

        // Cabe inteiro nesta página ou numa nova?
        if (y + hPx * k > bottom && hPx * k <= bottom - MARGIN) newPage();

        let from = 0; // px já desenhados do bloco
        while (from < hPx - 1) {
          const room = (bottom - y) / k; // px que cabem nesta página
          let to = Math.min(hPx, from + room);
          if (to < hPx) {
            // quebra na última linha que cabe
            const cut = pts.filter((p) => p > from + 40 && p <= to).pop();
            if (cut) to = cut;
            else if (y > MARGIN + 1) { newPage(); continue; }
          }
          const slice = document.createElement('canvas');
          slice.width = canvas.width;
          slice.height = Math.max(1, Math.round((to - from) * SCALE));
          slice.getContext('2d').drawImage(canvas, 0, Math.round(from * SCALE), canvas.width, slice.height, 0, 0, canvas.width, slice.height);
          const hMm = (to - from) * k;
          pdf.addImage(slice.toDataURL('image/jpeg', 0.88), 'JPEG', x, y, wMm, hMm);
          y += hMm;
          from = to;
          if (from < hPx - 1) newPage();
        }
      }

      // Rodapé
      const pages = pdf.internal.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(119, 108, 95);
        pdf.text(clean(`Otimizador de Cortes  |  ${project.name || ''}`), MARGIN, PAGE_H - 7);
        pdf.text(`Página ${p} de ${pages}`, PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' });
      }
      pdf.setProperties({ title: clean(`Plano de corte - ${project.name || 'projeto'}`), creator: 'Otimizador de Cortes' });

      const name = `Plano de corte - ${clean(project.name || 'projeto').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'projeto'}.pdf`;
      return { blob: pdf.output('blob'), name };
    } finally {
      frame.remove();
    }
  }

  global.Pdf = { build };
})(window);
