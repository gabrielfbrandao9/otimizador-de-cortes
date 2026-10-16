/*
 * PDF do plano de corte (jsPDF + jsPDF-AutoTable, carregados só quando precisa).
 *
 * Página 1: resumo (chapas usadas e números do plano) e lista de peças.
 * Depois, para cada desenho de chapa: uma página com o desenho (com as mesmas
 * opções de visualização da tela) e a sequência de cortes.
 *
 * As fontes padrão do PDF só têm caracteres do português "comum": clean()
 * troca ou tira o que elas não conseguem mostrar.
 */
(function (global) {
  'use strict';

  const LIBS = [
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
  ];

  const ACCENT = [180, 83, 42];
  const ACCENT_SOFT = [246, 229, 220];
  const INK = [34, 29, 23];
  const MUTED = [119, 108, 95];
  const LINE = [228, 221, 210];

  const PW = 297; // A4 deitado
  const PH = 210;
  const M = 14;

  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('o gerador de PDF não carregou. Verifique a internet e tente de novo.'));
      document.head.appendChild(s);
    });
  }

  // jsPDF primeiro; o AutoTable depende dele.
  function loadLibs() {
    if (global.jspdf && global.jspdf.jsPDF && global.jspdf.jsPDF.API.autoTable) return Promise.resolve();
    if (!loading) {
      loading = LIBS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
        .catch((err) => { loading = null; throw err; });
    }
    return loading;
  }

  const clean = (s) => String(s == null ? '' : s)
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[✓☁]/g, '')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '');

  // Desenho de uma chapa como JPEG (o PDF fica bem menor que com PNG).
  function sheetJpeg(svg, width) {
    return new Promise((resolve, reject) => {
      const vb = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
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
        resolve({ url: c.toDataURL('image/jpeg', 0.9), ratio: height / width });
      };
      img.onerror = () => reject(new Error('falha ao desenhar a chapa'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', `<svg width="${width}" height="${height}" `));
    });
  }

  /**
   * @param project  projeto (state do app)
   * @param result   resultado do otimizador
   * @param groups   chapas agrupadas [{ sheet, first, count }]
   * @param o        { view, unit: {label, len, lenU, area, areaU}, priority, steps }
   * @returns { blob, name }
   */
  async function build(project, result, groups, o) {
    await loadLibs();
    const { fmt } = global.Render;
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    const u = o.unit;
    const st = result.stats;
    const pieces = project.pieces;
    const dims = (w, h) => `${fmt(w)} x ${fmt(h)} ${u.label}`;
    const len = (v) => `${fmt(v)} ${u.label}`;
    const pct = (x) => `${fmt(x * 100)}%`;
    const color = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
    const pieceName = (i) => clean((pieces[i] && pieces[i].name) || `Peça ${i + 1}`);

    // Cabeçalho de cada página
    const header = (subtitulo) => {
      // logo: chapa com linhas de corte
      doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
      doc.roundedRect(M, 11, 13, 9, 1, 1, 'F');
      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(0.6);
      doc.line(M + 5.5, 11, M + 5.5, 20);
      doc.line(M + 5.5, 15.5, M + 13, 15.5);
      font('bold', 14);
      color(INK);
      doc.text('Otimizador de Cortes', M + 17, 16);
      font('normal', 9);
      color(MUTED);
      doc.text(clean(subtitulo), M + 17, 21.5);
      font('bold', 8.5);
      color(ACCENT);
      doc.text('P L A N O   D E   C O R T E', PW - M, 15, { align: 'right' });
      font('bold', 12);
      color(INK);
      doc.text(clean(project.name || 'Projeto'), PW - M, 21.5, { align: 'right' });
      doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]);
      doc.setLineWidth(0.6);
      doc.line(M, 26, PW - M, 26);
    };

    const tableBase = {
      theme: 'plain',
      margin: { left: M, right: M, top: 32, bottom: 14 },
      styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, lineColor: LINE },
      headStyles: { fillColor: ACCENT_SOFT, textColor: ACCENT, fontStyle: 'bold', fontSize: 7.8 },
      didParseCell: (d) => { if (d.section === 'body') d.cell.styles.lineWidth = { bottom: 0.2 }; },
    };

    // ---------- Página 1: resumo e lista de peças ----------
    const hoje = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
    header(`Gerado em ${hoje}`);

    const tipos = new Map();
    result.sheets.forEach((s) => {
      const k = `${s.name}|${s.L}|${s.W}`;
      const t = tipos.get(k) || { nome: s.name, L: s.L, W: s.W, n: 0, area: 0, usada: 0 };
      t.n++;
      t.area += s.area;
      t.usada += s.usedArea;
      tipos.set(k, t);
    });
    doc.autoTable({
      ...tableBase,
      startY: 31,
      tableWidth: 150,
      head: [['Chapa', 'Medida', 'Qtd', 'Aproveitamento']],
      body: [...tipos.values()].map((t) => [clean(t.nome || 'Chapa'), dims(t.L, t.W), String(t.n), pct(t.usada / t.area)]),
      columnStyles: { 2: { halign: 'right', cellWidth: 14 }, 3: { halign: 'right', cellWidth: 30 } },
    });

    const numeros = [
      ['Chapas utilizadas', String(st.sheetCount)],
      ['Peças', `${st.partsPlaced} de ${st.partsTotal}`],
      ['Aproveitamento', pct(st.efficiency)],
      ['Área utilizada', `${fmt(st.usedArea / u.area)} ${u.areaU}`],
      ['Área desperdiçada', `${fmt(st.wasteArea / u.area)} ${u.areaU}`],
      ['Cortes', `${st.cutCount} (${fmt(st.cutLength / u.len)} ${u.lenU})`],
      ['Espessura da serra', len(+project.kerf || 0)],
      ['Refilo', len(+project.trim || 0)],
      ['Veio', project.considerGrain ? 'Respeitado' : 'Ignorado'],
      ['Prioridade', clean(o.priority)],
    ];
    let ny = 33;
    numeros.forEach(([k, v]) => {
      font('normal', 8.5);
      color(MUTED);
      doc.text(clean(k), 175, ny);
      font('bold', 9.5);
      color(INK);
      doc.text(clean(v), PW - M, ny, { align: 'right' });
      ny += 5.3;
    });

    let y = Math.max(doc.lastAutoTable.finalY, ny) + 6;
    if (result.unplaced.length) {
      font('bold', 9.5);
      doc.setTextColor(180, 35, 24);
      const faltam = result.unplaced.map((x) => `${pieceName(x.piece)} (${x.count})`).join(', ');
      doc.splitTextToSize(clean(`Atenção: não couberam nas chapas disponíveis: ${faltam}`), PW - 2 * M).forEach((l) => { doc.text(l, M, y); y += 4.6; });
      y += 2;
    }

    const stockName = (id) => {
      const s = (project.stocks || []).find((x) => x.id === id);
      return s ? s.name : 'Qualquer';
    };
    const veio = { length: 'Comprimento', width: 'Largura' };
    font('bold', 10.5);
    color(INK);
    doc.text('Peças', M, y);
    doc.autoTable({
      ...tableBase,
      startY: y + 2,
      head: [['Peça', 'Comprimento', 'Largura', 'Qtd', 'Chapa', 'Veio']],
      body: pieces.filter((p) => p.enabled !== false && +p.length > 0 && +p.width > 0 && +p.qty > 0).map((p) => [
        clean(p.name || 'Peça'), len(+p.length), len(+p.width), String(p.qty), clean(stockName(p.stock)), veio[p.grain] || 'Livre',
      ]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', cellWidth: 12 } },
      didDrawPage: (d) => { if (d.pageNumber > 1) header('Peças (continuação)'); },
    });

    // ---------- Cada desenho de chapa: desenho + sequência de cortes ----------
    const result_ = (r) => {
      if (!r) return '-';
      if (r.piece !== undefined) return `${pieceName(r.piece)} (${dims(r.w, r.h)})`;
      if (r.kind === 'refilo') return 'refilo';
      if (r.kind === 'sobra') return `${dims(r.w, r.h)} (sobra)`;
      return dims(r.w, r.h);
    };

    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const s = g.sheet;
      const quais = g.count > 1 ? `Chapas ${g.first} a ${g.first + g.count - 1}` : `Chapa ${g.first}`;
      const sub = `${quais} de ${result.sheets.length}  |  ${s.name || 'Chapa'}  |  ${dims(s.L, s.W)}`
        + `${g.count > 1 ? `  |  ${g.count} iguais` : ''}  |  aproveitamento ${pct(s.efficiency)}`;

      doc.addPage();
      header(sub);
      const svg = global.Render.sheetSVG(s, pieces, { ...o.view, key: 'pdf' + gi, step: (o.steps && o.steps.get(gi)) || 0 });
      const img = await sheetJpeg(svg, 2400);
      const areaW = PW - 2 * M;
      const areaH = PH - 32 - 22;
      let w = areaW;
      let h = w * img.ratio;
      if (h > areaH) {
        h = areaH;
        w = h / img.ratio;
      }
      doc.addImage(img.url, 'JPEG', (PW - w) / 2, 30, w, h);

      // Números da chapa embaixo do desenho
      const waste = s.area - s.usedArea;
      const linha = [
        `Área utilizada ${fmt(s.usedArea / u.area)} ${u.areaU} (${pct(s.efficiency)})`,
        `Sobra ${fmt(waste / u.area)} ${u.areaU} (${pct(waste / s.area)})`,
        `${s.cuts.length} cortes (${fmt(s.cutLength / u.len)} ${u.lenU})`,
        `${s.parts.length} ${s.parts.length === 1 ? 'peça' : 'peças'}`,
        `${s.offcuts.length} ${s.offcuts.length === 1 ? 'sobra' : 'sobras'}`,
      ].join('   |   ');
      font('normal', 8.5);
      color(MUTED);
      doc.text(clean(linha), PW / 2, Math.min(30 + h + 7, PH - 14), { align: 'center' });

      // Sequência de cortes
      doc.addPage();
      header(`Sequência de cortes  |  ${sub}`);
      doc.autoTable({
        ...tableBase,
        startY: 31,
        head: [['#', 'Painel', 'Corte', 'Resultado']],
        body: s.cuts.map((c, i) => [
          String(i + 1), dims(c.panel.w, c.panel.h), `${c.axis}=${len(c.pos)}`, clean(`${result_(c.a)}   \\   ${result_(c.b)}`),
        ]),
        columnStyles: { 0: { cellWidth: 10, textColor: MUTED }, 1: { cellWidth: 48 }, 2: { cellWidth: 34 } },
        didDrawPage: (d) => { if (d.pageNumber > 1) header(`Sequência de cortes (continuação)  |  ${sub}`); },
      });
      font('normal', 7.5);
      color(MUTED);
      doc.text('y = corte horizontal, x = corte vertical, medidos a partir da borda de cima/esquerda do painel.', M, Math.min(doc.lastAutoTable.finalY + 5, PH - 10));
    }

    // Rodapé
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      font('normal', 7.5);
      color(MUTED);
      doc.text(clean(`Otimizador de Cortes  |  ${project.name || ''}`), M, PH - 6);
      doc.text(`Página ${p} de ${pages}`, PW - M, PH - 6, { align: 'right' });
    }
    doc.setProperties({ title: clean(`Plano de corte - ${project.name || 'projeto'}`), creator: 'Otimizador de Cortes' });

    const name = `Plano de corte - ${clean(project.name || 'projeto').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'projeto'}.pdf`;
    return { blob: doc.output('blob'), name };
  }

  global.Pdf = { build, loadLibs };
})(window);
