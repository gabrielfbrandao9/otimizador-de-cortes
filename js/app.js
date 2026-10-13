/*
 * Interface: tabelas de entrada, cálculo e exibição dos resultados.
 */
(function () {
  'use strict';

  const { Optimizer, Store, Render, Cloud } = window;
  const { fmt, esc } = Render;
  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 10);

  const UNITS = {
    mm: { label: 'mm', len: 1000, lenU: 'm', area: 1e6, areaU: 'm²' },
    cm: { label: 'cm', len: 100, lenU: 'm', area: 1e4, areaU: 'm²' },
    in: { label: 'pol', len: 12, lenU: 'pés', area: 144, areaU: 'pés²' },
  };

  const PRIORITIES = {
    waste: 'Menor área desperdiçada',
    cuts: 'Menos cortes',
  };

  const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
  const FONT_SCALES = [0.6, 0.8, 1, 1.25, 1.5, 2];

  const AUTO_CALC_LIMIT = 300; // acima disso o cálculo só roda pelo botão

  function defaultState() {
    const e = (c1, c2, l1, l2) => ({ c1, c2, l1, l2 });
    return {
      name: 'Armário de cozinha',
      unit: 'mm',
      kerf: 3,
      trim: 10,
      considerGrain: true,
      priority: 'waste',
      showLabels: true,
      showEdges: true,
      showOffcuts: true,
      showOrder: false,
      zoom: 1,
      fontScale: 1,
      mono: false,
      vertical: false,
      stocks: [{ id: uid(), name: 'MDF 18mm', length: 2750, width: 1840, qty: 5 }],
      pieces: [
        { id: uid(), name: 'Lateral', length: 720, width: 550, qty: 2, grain: 'length', edges: e(true, false, false, false) },
        { id: uid(), name: 'Base', length: 764, width: 550, qty: 2, grain: 'length', edges: e(true, false, false, false) },
        { id: uid(), name: 'Prateleira', length: 762, width: 500, qty: 2, grain: 'length', edges: e(true, false, false, false) },
        { id: uid(), name: 'Porta', length: 716, width: 397, qty: 4, grain: 'length', edges: e(true, true, true, true) },
        { id: uid(), name: 'Travessa', length: 764, width: 100, qty: 4, grain: 'none', edges: e(false, false, false, false) },
        { id: uid(), name: 'Gaveta frente', length: 396, width: 180, qty: 3, grain: 'length', edges: e(true, true, true, true) },
      ],
    };
  }

  function normalize(s) {
    const d = defaultState();
    const st = Object.assign({}, d, s || {});
    st.pieces = (Array.isArray(st.pieces) ? st.pieces : []).map((p) => ({
      id: p.id || uid(),
      name: p.name || '',
      length: p.length ?? '',
      width: p.width ?? '',
      qty: p.qty ?? 1,
      grain: ['none', 'length', 'width'].includes(p.grain) ? p.grain : 'none',
      edges: Object.assign({ c1: false, c2: false, l1: false, l2: false }, p.edges || {}),
      stock: typeof p.stock === 'string' ? p.stock : '',
      enabled: p.enabled !== false,
    }));
    st.stocks = (Array.isArray(st.stocks) ? st.stocks : []).map((x) => ({
      id: x.id || uid(),
      name: x.name || '',
      length: x.length ?? '',
      width: x.width ?? '',
      qty: x.qty ?? 1,
      enabled: x.enabled !== false,
    }));
    const stockIds = new Set(st.stocks.map((x) => x.id));
    st.pieces.forEach((p) => { if (p.stock && !stockIds.has(p.stock)) p.stock = ''; });
    if (!UNITS[st.unit]) st.unit = 'mm';
    if (!PRIORITIES[st.priority]) st.priority = 'waste';
    if (!ZOOMS.includes(st.zoom)) st.zoom = 1;
    if (!FONT_SCALES.includes(st.fontScale)) st.fontScale = 1;
    st.cloudId = typeof st.cloudId === 'string' ? st.cloudId : null;
    return st;
  }

  let state = normalize(Store.loadCurrent() || defaultState());
  let lastResult = null;
  let calcTimer = null;
  let user = null;

  const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // ---------- Utilidades ----------

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function persist() {
    Store.saveCurrent(state);
  }

  function setStatus(text) {
    $('#saveStatus').textContent = text;
  }

  function changed({ rerender } = {}) {
    persist();
    setStatus('Alterações não salvas');
    if (rerender) renderInputs();
    updateCounts();
    markStale();
    const total = state.pieces.reduce((t, p) => t + (Math.floor(+p.qty) || 0), 0);
    if (total <= AUTO_CALC_LIMIT) {
      clearTimeout(calcTimer);
      calcTimer = setTimeout(calculate, 450);
    }
  }

  function markStale() {
    $('#results').classList.add('stale');
  }

  function slug(s) {
    return (s || 'projeto')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'projeto';
  }

  // ---------- Tabelas de entrada ----------

  function numInput(field, value, extra = '') {
    return `<input type="number" data-f="${field}" value="${esc(value)}" min="0" step="any" inputmode="decimal" ${extra}>`;
  }

  function stockLabel(s, i) {
    const size = +s.length > 0 && +s.width > 0 ? ` (${fmt(+s.length)}×${fmt(+s.width)} ${UNITS[state.unit].label})` : '';
    return `${s.name || `Chapa ${i + 1}`}${size}`;
  }

  function stockSelect(p) {
    const opts = state.stocks.map((s, i) =>
      `<option value="${esc(s.id)}"${p.stock === s.id ? ' selected' : ''}>${esc(stockLabel(s, i))}${s.enabled ? '' : ' (desativada)'}</option>`).join('');
    return `<select data-f="stock" aria-label="Chapa"><option value="">Qualquer</option>${opts}</select>`;
  }

  function pieceRow(p, i) {
    const c = Render.pieceColor(i);
    const e = p.edges;
    const edgeBtn = (k, label) =>
      `<button type="button" class="edge e-${k}${e[k] ? ' on' : ''}" data-edge="${k}" aria-pressed="${e[k]}" title="${label}"></button>`;
    return `<tr data-id="${p.id}"${p.enabled ? '' : ' class="off"'}>
      <td class="c-on">${enabledBox(p, 'Usar esta peça no cálculo')}</td>
      <td class="c-n"><span class="swatch" style="background:${c.swatch}">${i + 1}</span></td>
      <td class="c-name"><input type="text" data-f="name" value="${esc(p.name)}" placeholder="Peça ${i + 1}" aria-label="Nome"></td>
      <td class="c-num c-len" data-label="Comp. (${unit()})">${numInput('length', p.length, 'aria-label="Comprimento"')}</td>
      <td class="c-num c-wid" data-label="Larg. (${unit()})">${numInput('width', p.width, 'aria-label="Largura"')}</td>
      <td class="c-qty" data-label="Qtd">${numInput('qty', p.qty, 'step="1" min="1" inputmode="numeric" aria-label="Quantidade"')}</td>
      <td class="c-grain" data-label="Veio">
        <select data-f="grain" aria-label="Veio" ${state.considerGrain ? '' : 'disabled'}>
          <option value="none"${p.grain === 'none' ? ' selected' : ''}>Livre</option>
          <option value="length"${p.grain === 'length' ? ' selected' : ''}>↔ Comp.</option>
          <option value="width"${p.grain === 'width' ? ' selected' : ''}>↕ Larg.</option>
        </select>
      </td>
      <td class="c-stock" data-label="Chapa">${stockSelect(p)}</td>
      <td class="c-edge" data-label="Fita">
        <div class="edgebox" role="group" aria-label="Fita de borda">
          ${edgeBtn('c1', 'Comprimento 1 (cima)')}${edgeBtn('c2', 'Comprimento 2 (baixo)')}
          ${edgeBtn('l1', 'Largura 1 (esquerda)')}${edgeBtn('l2', 'Largura 2 (direita)')}
        </div>
      </td>
      <td class="c-del"><button type="button" class="icon" data-act="del" aria-label="Remover peça">×</button></td>
    </tr>`;
  }

  function enabledBox(item, label) {
    return `<input type="checkbox" data-f="enabled"${item.enabled ? ' checked' : ''} aria-label="${label}" title="${label}">`;
  }

  // Caixa "todas" do cabeçalho: marcada, desmarcada ou parcial.
  function syncAllBox(sel, list) {
    const box = $(sel);
    const on = list.filter((x) => x.enabled).length;
    box.checked = list.length > 0 && on === list.length;
    box.indeterminate = on > 0 && on < list.length;
  }

  function stockRow(s) {
    return `<tr data-id="${s.id}"${s.enabled ? '' : ' class="off"'}>
      <td class="c-on">${enabledBox(s, 'Usar esta chapa no cálculo')}</td>
      <td class="c-name"><input type="text" data-f="name" value="${esc(s.name)}" placeholder="Material" aria-label="Material"></td>
      <td class="c-num c-len" data-label="Comp. (${unit()})">${numInput('length', s.length, 'aria-label="Comprimento"')}</td>
      <td class="c-num c-wid" data-label="Larg. (${unit()})">${numInput('width', s.width, 'aria-label="Largura"')}</td>
      <td class="c-qty" data-label="Qtd">${numInput('qty', s.qty, 'step="1" min="1" inputmode="numeric" aria-label="Quantidade"')}</td>
      <td class="c-del"><button type="button" class="icon" data-act="del" aria-label="Remover chapa">×</button></td>
    </tr>`;
  }

  function renderPieces() {
    $('#piecesBody').innerHTML = state.pieces.map(pieceRow).join('');
    // Com uma chapa só não há o que escolher: esconde a coluna.
    $('.grid.pieces').classList.toggle('one-stock', state.stocks.length < 2);
    syncAllBox('#allPieces', state.pieces);
  }

  function renderInputs() {
    renderPieces();
    $('#stocksBody').innerHTML = state.stocks.map(stockRow).join('');
    syncAllBox('#allStocks', state.stocks);
    $('#projectName').value = state.name || '';
    $('#optUnit').value = state.unit;
    $('#optKerf').value = state.kerf;
    $('#optTrim').value = state.trim;
    $('#optGrain').checked = !!state.considerGrain;
    $('#optPriority').value = state.priority;
    updateUnitLabels();
    updateCounts();
  }

  function updateUnitLabels() {
    document.querySelectorAll('.u').forEach((el) => { el.textContent = UNITS[state.unit].label; });
  }

  function updateCounts() {
    const active = state.pieces.filter((p) => p.enabled);
    const total = active.reduce((t, p) => t + (Math.floor(+p.qty) || 0), 0);
    const off = state.pieces.length - active.length;
    $('#piecesCount').textContent = `${active.length} tipos · ${total} peças${off ? ` · ${off} desativada${off > 1 ? 's' : ''}` : ''}`;
  }

  function bindTable(bodySel, list) {
    const body = $(bodySel);
    const find = (el) => {
      const tr = el.closest('tr');
      return tr && state[list].find((x) => x.id === tr.dataset.id);
    };

    body.addEventListener('input', (ev) => {
      const el = ev.target;
      const item = find(el);
      if (!item || !el.dataset.f || el.type === 'checkbox') return;
      item[el.dataset.f] = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value;
      if (list === 'stocks') renderPieces();
      changed();
    });
    body.addEventListener('change', (ev) => {
      if (ev.target.type === 'checkbox' && ev.target.dataset.f === 'enabled') {
        const item = find(ev.target);
        if (!item) return;
        item.enabled = ev.target.checked;
        ev.target.closest('tr').classList.toggle('off', !item.enabled);
        if (list === 'stocks') { renderPieces(); syncAllBox('#allStocks', state.stocks); }
        else syncAllBox('#allPieces', state.pieces);
        changed();
      } else if (ev.target.tagName === 'SELECT') {
        const item = find(ev.target);
        if (item) { item[ev.target.dataset.f] = ev.target.value; changed(); }
      }
    });
    body.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      const item = find(btn);
      if (!item) return;
      if (btn.dataset.act === 'del') {
        state[list] = state[list].filter((x) => x !== item);
        if (list === 'stocks') state.pieces.forEach((p) => { if (p.stock === item.id) p.stock = ''; });
        changed({ rerender: true });
      } else if (btn.dataset.edge) {
        const k = btn.dataset.edge;
        item.edges[k] = !item.edges[k];
        btn.classList.toggle('on', item.edges[k]);
        btn.setAttribute('aria-pressed', item.edges[k]);
        changed();
      }
    });
    // Enter na última linha cria uma nova linha
    body.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
      ev.preventDefault();
      const tr = ev.target.closest('tr');
      if (tr && !tr.nextElementSibling) {
        (list === 'pieces' ? addPiece : addStock)();
      } else if (tr) {
        const field = ev.target.dataset.f;
        const next = tr.nextElementSibling.querySelector(`[data-f="${field}"]`);
        if (next) next.focus();
      }
    });
  }

  function focusLast(bodySel) {
    const rows = $(bodySel).querySelectorAll('tr');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('input[type="text"]').focus();
  }

  function addPiece() {
    const prev = state.pieces[state.pieces.length - 1];
    state.pieces.push({
      id: uid(), name: '', length: '', width: '', qty: 1,
      grain: 'none', edges: { c1: false, c2: false, l1: false, l2: false },
      stock: prev ? prev.stock : '',
      enabled: true,
    });
    changed({ rerender: true });
    focusLast('#piecesBody');
  }

  function addStock() {
    const prev = state.stocks[state.stocks.length - 1];
    state.stocks.push({ id: uid(), name: '', length: prev ? prev.length : '', width: prev ? prev.width : '', qty: 1, enabled: true });
    changed({ rerender: true });
    focusLast('#stocksBody');
  }

  // ---------- Cálculo ----------

  function calculate() {
    clearTimeout(calcTimer);
    const btn = $('#btnCalc');
    btn.disabled = true;
    btn.textContent = 'Calculando…';
    // Deixa o navegador desenhar o estado "Calculando" antes do trabalho pesado.
    setTimeout(() => {
      try {
        lastResult = Optimizer.optimize(state);
        steps.clear();
        renderResults();
      } catch (err) {
        console.error(err);
        toast('Erro ao calcular: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Calcular plano de corte';
      }
    }, 20);
  }

  // Agrupa chapas consecutivas com o mesmo plano de corte.
  function groupSheets(sheets) {
    const groups = [];
    const sig = (s) =>
      s.stockIndex + '|' + s.parts.map((p) => [p.piece, p.x, p.y, p.w, p.h].map((v) => +(+v).toFixed(3)).join(',')).join(';');
    sheets.forEach((s, i) => {
      const k = sig(s);
      const g = groups[groups.length - 1];
      if (g && g.sig === k) g.count++;
      else groups.push({ sig: k, sheet: s, first: i + 1, count: 1 });
    });
    return groups;
  }

  function stat(label, value, sub) {
    return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;
  }

  function partsSummary(sheet) {
    const counts = new Map();
    for (const p of sheet.parts) counts.set(p.piece, (counts.get(p.piece) || 0) + 1);
    return [...counts]
      .sort((a, b) => a[0] - b[0])
      .map(([i, n]) => {
        const p = state.pieces[i] || {};
        const c = Render.pieceColor(i);
        return `<li><span class="dot" style="background:${c.swatch}"></span>${esc(p.name || `Peça ${i + 1}`)} ${dims(+p.length, +p.width)} <strong>×${n}</strong></li>`;
      })
      .join('');
  }

  const pct = (x) => `${fmt(x * 100)}%`;
  const unit = () => UNITS[state.unit].label;
  const dims = (w, h) => `<span class="mono">${fmt(w)} × ${fmt(h)} ${unit()}</span>`;
  const len = (v) => `${fmt(v)} ${unit()}`;
  const row = (label, value) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`;

  // Tabela "Estatísticas" do plano inteiro
  function statsTable(res) {
    const u = UNITS[state.unit];
    const st = res.stats;
    const byStock = new Map();
    for (const s of res.sheets) byStock.set(s.stockIndex, (byStock.get(s.stockIndex) || 0) + 1);
    const used = [...byStock].map(([i, n]) => {
      const s = res.sheets.find((x) => x.stockIndex === i);
      return `${dims(s.L, s.W)} <strong>×${n}</strong>${s.name ? ` <span class="muted">· ${esc(s.name)}</span>` : ''}`;
    }).join('<br>') || '—';
    const offcuts = res.sheets.reduce((t, s) => t + s.offcuts.length, 0);

    return `<details class="panel" data-key="stats" open>
      <summary>Estatísticas</summary>
      <table class="kv">
        ${row('Chapas utilizadas', used)}
        ${row('Peças', `${st.partsPlaced} de ${st.partsTotal}`)}
        ${row('Área total utilizada', `${fmt(st.usedArea / u.area)} ${u.areaU} <span class="muted">· ${pct(st.efficiency)}</span>`)}
        ${row('Área total desperdiçada', `${fmt(st.wasteArea / u.area)} ${u.areaU} <span class="muted">· ${pct(st.totalArea ? st.wasteArea / st.totalArea : 0)}</span>`)}
        ${row('Sobras', offcuts)}
        ${row('Cortes totais', st.cutCount)}
        ${row('Comprimento de corte total', `${fmt(st.cutLength / u.len)} ${u.lenU}`)}
        ${row('Fita de borda', `${fmt(st.edgeLength / u.len)} ${u.lenU}`)}
        ${row('Espessura da serra', len(+state.kerf || 0))}
        ${row('Refilo', len(+state.trim || 0))}
        ${row('Veio', state.considerGrain ? 'Respeitado' : 'Ignorado')}
        ${row('Prioridade de otimização', PRIORITIES[state.priority])}
      </table>
    </details>`;
  }

  // Painel "Estatísticas por chapa", com navegação ‹ 1 / N ›
  let panelIndex = 0;

  function panelStats(res, groups) {
    const n = res.sheets.length;
    if (!n) return '';
    if (panelIndex >= n) panelIndex = 0;
    const i = panelIndex;
    const s = res.sheets[i];
    const u = UNITS[state.unit];
    const waste = s.area - s.usedArea;
    const gi = groups.findIndex((g) => i >= g.first - 1 && i < g.first - 1 + g.count);
    const g = groups[gi];

    let edge = 0;
    for (const p of s.parts) {
      const pc = state.pieces[p.piece] || {};
      const e = pc.edges || {};
      edge += ((e.c1 ? 1 : 0) + (e.c2 ? 1 : 0)) * (+pc.length || 0) + ((e.l1 ? 1 : 0) + (e.l2 ? 1 : 0)) * (+pc.width || 0);
    }
    const offcuts = s.offcuts.length
      ? `${s.offcuts.length} <span class="muted">(${s.offcuts.map((o) => `${fmt(o.w)} × ${fmt(o.h)} ${unit()}`).join('; ')})</span>`
      : '0';
    const same = g && g.count > 1
      ? `${row('Chapas iguais', `Este plano se repete em ${g.count} chapas (${g.first} a ${g.first + g.count - 1})`)}`
      : '';

    return `<details class="panel panel-sheet" data-key="panel-stats" open>
      <summary>
        <span>Estatísticas por chapa</span>
        <span class="pager no-print">
          <button type="button" class="pager-btn" data-panel="-1" aria-label="Chapa anterior"${n < 2 ? ' disabled' : ''}>‹</button>
          <span class="pager-label"><strong>${i + 1}</strong> / ${n}</span>
          <button type="button" class="pager-btn" data-panel="1" aria-label="Próxima chapa"${n < 2 ? ' disabled' : ''}>›</button>
        </span>
      </summary>
      <table class="kv">
        ${row('Chapa', `<strong>Chapa ${i + 1}</strong> <button type="button" class="link no-print" data-goto="${gi}">ver desenho</button>`)}
        ${row('Material', esc(s.name || '—'))}
        ${row('Medidas', dims(s.L, s.W))}
        ${row('Área utilizada', `${fmt(s.usedArea / u.area)} ${u.areaU} <span class="muted">· ${pct(s.efficiency)}</span>`)}
        ${row('Área de sobra', `${fmt(waste / u.area)} ${u.areaU} <span class="muted">· ${pct(waste / s.area)}</span>`)}
        ${row('Cortes', s.cuts.length)}
        ${row('Comprimento de corte', `${fmt(s.cutLength / u.len)} ${u.lenU}`)}
        ${row('Peças', s.parts.length)}
        ${row('Sobras', offcuts)}
        ${row('Fita de borda', `${fmt(edge / u.len)} ${u.lenU}`)}
        ${same}
      </table>
    </details>`;
  }

  function cutResult(r) {
    if (!r) return '<span class="muted">–</span>';
    if (r.piece !== undefined) {
      const p = state.pieces[r.piece] || {};
      const c = Render.pieceColor(r.piece);
      return `<span class="dot" style="background:${c.swatch}"></span><strong>${esc(p.name || `Peça ${r.piece + 1}`)}</strong> ${dims(r.w, r.h)}`;
    }
    if (r.kind === 'refilo') return '<span class="muted">refilo</span>';
    if (r.kind === 'sobra') return `${dims(r.w, r.h)} <span class="tag">sobra</span>`;
    return dims(r.w, r.h);
  }

  // Tabela "Sequência de cortes" de uma chapa
  function cutsTable(s, key) {
    const rows = s.cuts.map((c, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${dims(c.panel.w, c.panel.h)}</td>
        <td class="mono">${c.axis}=${len(c.pos)}</td>
        <td><div class="cut-res">${cutResult(c.a)}<span class="sep-bar">\\</span>${cutResult(c.b)}</div></td>
      </tr>`).join('');
    return `<details class="cuts" data-key="${key}">
      <summary>Sequência de cortes <span class="muted">(${s.cuts.length})</span></summary>
      <p class="muted cuts-help"><span class="mono">y</span> = corte horizontal, <span class="mono">x</span> = corte vertical, medidos a partir da borda de cima/esquerda do painel.</p>
      <div class="table-wrap">
        <table class="cut-table">
          <thead><tr><th>#</th><th>Painel</th><th>Corte</th><th>Resultado</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
  }

  function renderResults() {
    const res = lastResult;
    const box = $('#results');
    box.classList.remove('stale');
    if (!res) return;
    const u = UNITS[state.unit];
    const st = res.stats;

    if (!st.partsTotal) {
      box.innerHTML = '<div class="empty"><p>Nenhuma peça válida. Preencha comprimento, largura e quantidade.</p></div>';
      return;
    }

    let html = '';
    html += `<div class="results-head">
      <div>
        <h2>${esc(state.name || 'Plano de corte')}</h2>
        <p class="muted">${st.partsPlaced} de ${st.partsTotal} peças · serra ${len(+state.kerf || 0)} · refilo ${len(+state.trim || 0)}</p>
      </div>
      <div class="results-actions no-print">
        <button type="button" class="btn" id="btnPrint">Imprimir / PDF</button>
        <button type="button" class="btn" id="btnPngAll">Baixar imagens</button>
      </div>
    </div>`;

    html += '<div class="stats">'
      + stat('Aproveitamento', `${fmt(st.efficiency * 100)}%`, `<span class="bar"><span style="width:${(st.efficiency * 100).toFixed(1)}%"></span></span>`)
      + stat('Chapas usadas', st.sheetCount)
      + stat('Área de chapa', `${fmt(st.totalArea / u.area)} ${u.areaU}`, `peças ${fmt(st.usedArea / u.area)} ${u.areaU} · sobra ${fmt(st.wasteArea / u.area)} ${u.areaU}`)
      + stat('Cortes', st.cutCount, `${fmt(st.cutLength / u.len)} ${u.lenU} de corte`)
      + stat('Fita de borda', `${fmt(st.edgeLength / u.len)} ${u.lenU}`)
      + '</div>';

    if (res.unplaced.length) {
      html += '<div class="alert"><strong>Peças que não couberam:</strong><ul>'
        + res.unplaced.map(({ piece, count }) => {
          const p = state.pieces[piece] || {};
          return `<li>${esc(p.name || `Peça ${piece + 1}`)} (${fmt(+p.length)} × ${fmt(+p.width)} ${unit()}) — ${count}</li>`;
        }).join('')
        + '</ul><p>Aumente a quantidade de chapas ou confira se a peça é maior que a chapa (considerando refilo, veio e a chapa escolhida para ela).</p></div>';
    }

    html += statsTable(res);
    const groups = groupSheets(res.sheets);
    html += panelStats(res, groups);

    html += viewBar();
    html += `<div class="view-toggles no-print">
      <label class="check inline"><input type="checkbox" data-view="showLabels"${state.showLabels ? ' checked' : ''}><span>Nomes</span></label>
      <label class="check inline"><input type="checkbox" data-view="showEdges"${state.showEdges ? ' checked' : ''}><span>Fita de borda</span></label>
      <label class="check inline"><input type="checkbox" data-view="showOffcuts"${state.showOffcuts ? ' checked' : ''}><span>Sobras</span></label>
      <label class="check inline"><input type="checkbox" data-view="showOrder"${state.showOrder ? ' checked' : ''}><span>Ordem dos cortes</span></label>
    </div>`;

    html += '<div class="sheets">';
    groups.forEach((g, gi) => {
      const s = g.sheet;
      const title = g.count > 1 ? `Chapas ${g.first}–${g.first + g.count - 1}` : `Chapa ${g.first}`;
      html += `<article class="sheet" data-group="${gi}">
        <header>
          <div>
            <h3>${title}${g.count > 1 ? ` <span class="badge">×${g.count}</span>` : ''}</h3>
            <p class="muted">${esc(s.name || 'Chapa')} · ${dims(s.L, s.W)} · ${s.parts.length} ${s.parts.length === 1 ? 'peça' : 'peças'}</p>
          </div>
          <div class="sheet-eff"><span class="mono">${fmt(s.efficiency * 100)}%</span><small>aproveitamento</small></div>
          <button type="button" class="icon no-print" data-png="${gi}" title="Baixar imagem desta chapa" aria-label="Baixar imagem">⤓</button>
        </header>
        <div class="svg-wrap">${sheetImage(s, gi)}</div>
        ${state.showOrder ? stepper(s, gi) : ''}
        <ul class="parts-list">${partsSummary(s)}</ul>
        ${cutsTable(s, `cuts-${gi}`)}
      </article>`;
    });
    html += '</div>';

    // Mantém abertas/fechadas as seções como estavam antes de redesenhar.
    const previous = new Map([...box.querySelectorAll('details[data-key]')].map((d) => [d.dataset.key, d.open]));
    box.innerHTML = html;
    box.querySelectorAll('details[data-key]').forEach((d) => {
      if (previous.has(d.dataset.key)) d.open = previous.get(d.dataset.key);
    });
    box._groups = groups;
    updateTabBadge(res);
    applyZoom();
    groups.forEach((_, gi) => highlightStep(gi));
  }

  function viewOpts() {
    return {
      showLabels: state.showLabels, showEdges: state.showEdges,
      showOffcuts: state.showOffcuts, showOrder: state.showOrder,
      fontScale: state.fontScale, mono: state.mono, vertical: state.vertical, unit: unit(),
    };
  }

  // ---------- Visualização das chapas ----------

  const steps = new Map(); // passo a passo de cada chapa: 0 = todos os cortes

  function sheetImage(s, gi) {
    return Render.sheetSVG(s, state.pieces, { ...viewOpts(), key: gi, step: steps.get(gi) || 0 });
  }

  function viewBar() {
    const seg = (key, options) => options.map(([val, label]) =>
      `<button type="button" class="seg-btn${state[key] === val ? ' on' : ''}" data-set="${key}" data-val="${val}" aria-pressed="${state[key] === val}">${label}</button>`).join('');
    return `<div class="viewbar no-print" role="toolbar" aria-label="Visualização das chapas">
      <div class="vb-group">
        <span class="vb-label">Zoom</span>
        <button type="button" class="vb-btn" data-zoom="-1" aria-label="Diminuir zoom"${state.zoom <= ZOOMS[0] ? ' disabled' : ''}>−</button>
        <span class="vb-val" id="zoomVal">${Math.round(state.zoom * 100)}%</span>
        <button type="button" class="vb-btn" data-zoom="1" aria-label="Aumentar zoom"${state.zoom >= ZOOMS[ZOOMS.length - 1] ? ' disabled' : ''}>+</button>
      </div>
      <div class="vb-group">
        <span class="vb-label">Letras</span>
        <button type="button" class="vb-btn small-a" data-font="-1" aria-label="Diminuir letras"${state.fontScale <= FONT_SCALES[0] ? ' disabled' : ''}>A−</button>
        <span class="vb-val">${Math.round(state.fontScale * 100)}%</span>
        <button type="button" class="vb-btn" data-font="1" aria-label="Aumentar letras"${state.fontScale >= FONT_SCALES[FONT_SCALES.length - 1] ? ' disabled' : ''}>A+</button>
      </div>
      <div class="vb-group seg" role="group" aria-label="Cores">${seg('mono', [[false, 'Colorido'], [true, 'Sem cores']])}</div>
      <div class="vb-group seg" role="group" aria-label="Orientação">${seg('vertical', [[false, '▭ Horizontal'], [true, '▯ Vertical']])}</div>
    </div>`;
  }

  // O zoom só muda o tamanho das imagens, sem redesenhar.
  function applyZoom() {
    const z = state.zoom;
    document.querySelectorAll('#results .svg-wrap svg').forEach((svg) => {
      svg.style.width = `${z * 100}%`;
      svg.style.maxHeight = `${z * 75}vh`;
    });
    const label = $('#zoomVal');
    if (label) label.textContent = `${Math.round(z * 100)}%`;
    const minus = $('#results [data-zoom="-1"]');
    const plus = $('#results [data-zoom="1"]');
    if (minus) minus.disabled = z <= ZOOMS[0];
    if (plus) plus.disabled = z >= ZOOMS[ZOOMS.length - 1];
  }

  function nextIn(list, value, dir) {
    const i = list.indexOf(value);
    return list[Math.min(list.length - 1, Math.max(0, (i < 0 ? list.indexOf(1) : i) + dir))];
  }

  function stepper(s, gi) {
    const n = s.cuts.length;
    const k = steps.get(gi) || 0;
    const label = k ? `Corte <strong>${k}</strong> de ${n}` : `Todos os cortes (${n})`;
    return `<div class="stepper no-print" data-group="${gi}">
      <span class="vb-label">Passo a passo</span>
      <button type="button" class="vb-btn" data-step="-1" aria-label="Corte anterior">‹</button>
      <span class="step-label">${label}</span>
      <button type="button" class="vb-btn" data-step="1" aria-label="Próximo corte">›</button>
      ${k ? '<button type="button" class="link" data-step="0">ver todos</button>' : ''}
    </div>`;
  }

  // Destaca na tabela "Sequência de cortes" o corte do passo atual.
  function highlightStep(gi) {
    const card = $(`#results .sheet[data-group="${gi}"]`);
    if (!card) return;
    const k = steps.get(gi) || 0;
    card.querySelectorAll('.cut-table tbody tr').forEach((tr, i) => tr.classList.toggle('current', k > 0 && i === k - 1));
  }

  function setStep(gi, dir) {
    const g = $('#results')._groups[gi];
    const n = g.sheet.cuts.length;
    const k = steps.get(gi) || 0;
    const next = dir === 0 ? 0 : (k + dir + n + 1) % (n + 1); // 0 = todos
    steps.set(gi, next);
    const card = $(`#results .sheet[data-group="${gi}"]`);
    card.querySelector('.svg-wrap').innerHTML = sheetImage(g.sheet, gi);
    card.querySelector('.stepper').outerHTML = stepper(g.sheet, gi);
    applyZoom();
    highlightStep(gi);
    card.querySelector(`.stepper [data-step="${dir === 0 ? 1 : dir}"]`).focus();
  }

  async function downloadPng(gi) {
    const g = $('#results')._groups[gi];
    const svg = Render.sheetSVG(g.sheet, state.pieces, { ...viewOpts(), key: 'png' + gi, step: steps.get(gi) || 0 });
    await Render.svgToPng(svg, `${slug(state.name)}-chapa-${g.first}.png`);
  }

  // ---------- Projetos ----------

  // Dados do projeto sem o vínculo com a nuvem (para salvar/exportar).
  function projectData() {
    const { cloudId, ...data } = state;
    return data;
  }

  async function save() {
    let name = (state.name || '').trim();
    if (!name) {
      name = (prompt('Nome do projeto:') || '').trim();
      if (!name) return;
    }
    state.name = name;
    $('#projectName').value = name;

    if (user) {
      setStatus('Salvando…');
      try {
        state.cloudId = await Cloud.save(state.cloudId, name, projectData());
        persist();
        setStatus(`Salvo na nuvem às ${timeFmt.format(new Date())}`);
        toast(`“${name}” salvo na nuvem`);
      } catch (err) {
        Store.saveProject(name, projectData());
        setStatus('Erro ao salvar na nuvem');
        toast(`Não foi possível salvar na nuvem (${err.message}). Uma cópia ficou neste navegador.`);
      }
      return;
    }

    if (!Store.saveProject(name, projectData())) {
      toast('Não foi possível salvar (armazenamento do navegador indisponível)');
      return;
    }
    setStatus(`Salvo neste navegador às ${timeFmt.format(new Date())}`);
    toast(Cloud.enabled ? `“${name}” salvo neste navegador. Entre na sua conta para salvar na nuvem.` : `“${name}” salvo neste navegador`);
  }

  function renderLocalList() {
    const list = Store.listProjects();
    const ul = $('#projectList');
    if (!list.length) {
      ul.innerHTML = '<li class="muted">Nenhum projeto salvo neste navegador.</li>';
      return;
    }
    ul.innerHTML = list.map((p) => `<li>
      <div><strong>${esc(p.name)}</strong><small>${p.savedAt ? dateFmt.format(p.savedAt) : ''}</small></div>
      ${user ? `<button type="button" class="btn ghost" data-upload="${esc(p.name)}" title="Enviar uma cópia para a nuvem">Enviar p/ nuvem</button>` : ''}
      <button type="button" class="btn" data-open="${esc(p.name)}">Abrir</button>
      <button type="button" class="icon" data-del="${esc(p.name)}" aria-label="Excluir">×</button>
    </li>`).join('');
  }

  async function renderCloudList() {
    const section = $('#cloudSection');
    section.hidden = !Cloud.enabled;
    if (!Cloud.enabled) return;
    const ul = $('#cloudList');
    if (!user) {
      ul.innerHTML = '<li class="muted"><div>Entre na sua conta para salvar projetos na nuvem e abri-los em qualquer aparelho.</div><button type="button" class="btn" data-act="login">Entrar</button></li>';
      return;
    }
    ul.innerHTML = '<li class="muted">Carregando…</li>';
    try {
      const rows = await Cloud.list();
      ul.innerHTML = rows.length
        ? rows.map((r) => {
          const current = r.id === state.cloudId;
          return `<li${current ? ' class="current"' : ''}>
            <div><strong>${esc(r.name)}</strong><small>${dateFmt.format(new Date(r.updated_at))}${current ? ' · aberto agora' : ''}</small></div>
            <button type="button" class="btn" data-cloud-open="${esc(r.id)}">Abrir</button>
            <button type="button" class="icon" data-cloud-del="${esc(r.id)}" data-name="${esc(r.name)}" aria-label="Excluir">×</button>
          </li>`;
        }).join('')
        : '<li class="muted">Nenhum projeto na nuvem ainda. Clique em “Salvar” para enviar o projeto atual.</li>';
    } catch (err) {
      ul.innerHTML = `<li class="muted">Erro ao carregar: ${esc(err.message)}</li>`;
    }
  }

  function openProjects() {
    renderLocalList();
    $('#dlgProjects').showModal();
    renderCloudList();
  }

  async function onProjectsClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const d = btn.dataset;
    try {
      if (d.open) {
        const s = Store.loadProject(d.open);
        $('#dlgProjects').close();
        // Cópia local não fica vinculada a um projeto da nuvem.
        if (s) loadState({ ...s, cloudId: null }, `“${d.open}” aberto`);
      } else if (d.del) {
        e.preventDefault();
        if (confirm(`Excluir “${d.del}” deste navegador?`)) {
          Store.deleteProject(d.del);
          renderLocalList();
        }
      } else if (d.upload) {
        e.preventDefault();
        const s = Store.loadProject(d.upload);
        if (!s) return;
        btn.disabled = true;
        const { cloudId, ...data } = normalize(s);
        await Cloud.save(null, d.upload, data);
        toast(`“${d.upload}” enviado para a nuvem`);
        btn.disabled = false;
        renderCloudList();
      } else if (d.cloudOpen) {
        btn.disabled = true;
        const row = await Cloud.load(d.cloudOpen);
        $('#dlgProjects').close();
        loadState({ ...row.data, name: row.name, cloudId: row.id }, `“${row.name}” aberto da nuvem`);
        setStatus('Aberto da nuvem');
      } else if (d.cloudDel) {
        e.preventDefault();
        if (!confirm(`Excluir “${d.name}” da nuvem? Isso não pode ser desfeito.`)) return;
        await Cloud.remove(d.cloudDel);
        if (state.cloudId === d.cloudDel) { state.cloudId = null; persist(); }
        toast('Projeto excluído da nuvem');
        renderCloudList();
      }
    } catch (err) {
      btn.disabled = false;
      toast('Erro: ' + err.message);
    }
  }

  function loadState(s, msg) {
    state = normalize(s);
    persist();
    renderInputs();
    setStatus('');
    lastResult = null;
    calculate();
    if (msg) toast(msg);
  }

  // ---------- App no celular: abas, instalação e modo offline ----------

  const mobile = window.matchMedia('(max-width: 760px)');
  const TABS = ['pieces', 'stocks', 'options', 'plan'];

  function setTab(tab) {
    if (!TABS.includes(tab)) tab = 'pieces';
    document.body.dataset.tab = tab;
    document.querySelectorAll('.tabbar [data-goto-tab]').forEach((b) => {
      const on = b.dataset.gotoTab === tab;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    try { sessionStorage.setItem('otimizador:aba', tab); } catch (e) { /* sem armazenamento */ }
    if (mobile.matches) window.scrollTo(0, 0);
  }

  function updateTabBadge(res) {
    const badge = $('#tabBadge');
    if (!badge) return;
    if (!res || !res.stats.partsTotal) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.classList.toggle('warn', res.unplaced.length > 0);
    badge.textContent = res.unplaced.length ? '!' : `${Math.round(res.stats.efficiency * 100)}%`;
  }

  let installPrompt = null;

  function bindApp() {
    let saved = null;
    try { saved = sessionStorage.getItem('otimizador:aba'); } catch (e) { /* sem armazenamento */ }
    setTab(saved || 'pieces');
    document.querySelector('.tabbar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-goto-tab]');
      if (b) setTab(b.dataset.gotoTab);
    });
    // No celular, calcular leva direto para o plano.
    $('#btnCalc').addEventListener('click', () => { if (mobile.matches) setTab('plan'); });

    // Funciona sem internet depois da primeira visita.
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }

    // Botão "Instalar app" (Android/Chrome)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installPrompt = e;
      $('#btnInstall').hidden = false;
    });
    $('#btnInstall').addEventListener('click', async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      $('#btnInstall').hidden = true;
    });
    window.addEventListener('appinstalled', () => {
      $('#btnInstall').hidden = true;
      toast('App instalado! Procure “Cortes” na tela inicial.');
    });

    // Aviso de "sem internet"
    const net = () => {
      $('#netStatus').hidden = navigator.onLine;
      document.body.classList.toggle('offline', !navigator.onLine);
    };
    window.addEventListener('online', () => { net(); toast('Conexão restabelecida'); });
    window.addEventListener('offline', () => { net(); toast('Sem internet: o app continua funcionando. A nuvem volta com a conexão.'); });
    net();
  }

  // ---------- Compartilhar ----------
  // O projeto vai dentro do próprio link (#p=...), compactado. Não precisa de servidor nem de login.

  function toBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  async function pipeBytes(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }

  // "z" = JSON compactado (deflate); "j" = JSON puro, para navegadores sem CompressionStream.
  async function encodeProject(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    if (window.CompressionStream) return 'z' + toBase64Url(await pipeBytes(bytes, new CompressionStream('deflate-raw')));
    return 'j' + toBase64Url(bytes);
  }

  async function decodeProject(code) {
    let bytes = fromBase64Url(code.slice(1));
    if (code[0] === 'z') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
    else if (code[0] !== 'j') throw new Error('link inválido');
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function openShare() {
    const name = (state.name || '').trim() || 'Projeto';
    // No computador local (localhost) o link aponta para o site publicado, para a outra pessoa conseguir abrir.
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
    const base = local && (window.APP_CONFIG || {}).siteUrl ? window.APP_CONFIG.siteUrl : location.origin + location.pathname;
    const url = `${base}#p=${await encodeProject(projectData())}`;
    const text = `Plano de corte “${name}” no Otimizador de Cortes:`;
    $('#shareLink').value = url;
    $('#shareWhats').href = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
    $('#shareEmail').href = `mailto:?subject=${encodeURIComponent(`Plano de corte: ${name}`)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`;
    $('#btnNativeShare').hidden = !navigator.share;
    $('#btnCopyLink').textContent = 'Copiar';
    $('#dlgShare').showModal();
    $('#shareLink').select();
  }

  async function copyShareLink() {
    const input = $('#shareLink');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch (e) {
      input.select();
      document.execCommand('copy');
    }
    $('#btnCopyLink').textContent = 'Copiado ✓';
    toast('Link copiado');
  }

  // Abre um projeto recebido por link.
  async function openSharedFromUrl() {
    const m = location.hash.match(/^#p=([\w-]+)$/);
    if (!m) return;
    let data;
    try {
      data = await decodeProject(m[1]);
      if (!data || !Array.isArray(data.pieces)) throw new Error('link inválido');
    } catch (err) {
      history.replaceState(null, '', location.pathname + location.search);
      toast('Este link de projeto está incompleto ou corrompido.');
      return;
    }
    const name = data.name || 'Projeto compartilhado';
    const hasCurrent = state.pieces.some((p) => +p.length > 0 && +p.width > 0);
    if (hasCurrent && !confirm(`Abrir o projeto compartilhado “${name}”?\n\nEle vai substituir o projeto aberto agora (“${state.name || 'sem nome'}”). Se precisar dele, cancele e salve-o antes.`)) {
      return;
    }
    history.replaceState(null, '', location.pathname + location.search);
    loadState({ ...data, cloudId: null }, `Projeto compartilhado “${name}” aberto. Clique em Salvar para guardar sua cópia.`);
  }

  // ---------- Conta ----------

  function renderAccount() {
    const box = $('#account');
    box.hidden = !Cloud.enabled;
    if (!Cloud.enabled) return;
    if (!user) {
      box.innerHTML = '<button type="button" class="btn" data-act="login">Entrar</button>';
      return;
    }
    const email = user.email || 'Conectado';
    const avatar = user.user_metadata && user.user_metadata.avatar_url;
    box.innerHTML = `<span class="user" title="${esc(email)}">
        ${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${esc(email[0].toUpperCase())}</span>`}
        <span class="user-email">${esc(email)}</span>
      </span>
      <button type="button" class="btn ghost" data-act="logout">Sair</button>`;
  }

  function loginMsg(text, isError) {
    const p = $('#loginMsg');
    p.textContent = text;
    p.classList.toggle('error', !!isError);
  }

  async function openLogin() {
    // Só mostra cada forma de login se ela estiver ligada no config.js E ativada no Supabase.
    const active = await Cloud.providers();
    const google = Cloud.loginGoogle && (!active || active.google !== false);
    const email = Cloud.loginEmail && (!active || active.email !== false);
    $('#btnGoogle').hidden = !google;
    $('#emailLogin').hidden = !email;
    $('#loginSep').hidden = !(google && email);
    loginMsg('');
    $('#dlgLogin').showModal();
  }

  async function logout() {
    try {
      await Cloud.signOut();
      toast('Você saiu da conta');
    } catch (err) {
      toast('Erro ao sair: ' + err.message);
    }
  }

  function bindAccount() {
    if (!Cloud.enabled) return;

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="login"], [data-act="logout"]');
      if (!btn) return;
      e.preventDefault();
      if (btn.dataset.act === 'logout') return logout();
      if ($('#dlgProjects').open) $('#dlgProjects').close();
      openLogin();
    });

    $('#btnGoogle').addEventListener('click', async () => {
      loginMsg('Abrindo o Google…');
      try {
        await Cloud.signInWithGoogle(); // redireciona para o Google e volta para o site
      } catch (err) {
        loginMsg('Não foi possível entrar com Google: ' + err.message, true);
      }
    });

    const sendEmail = async () => {
      const email = $('#loginEmail').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return loginMsg('Digite um e-mail válido.', true);
      const btn = $('#btnEmail');
      btn.disabled = true;
      loginMsg('Enviando…');
      try {
        await Cloud.signInWithEmail(email);
        loginMsg(`Pronto! Abra o link que enviamos para ${email} (confira também o spam).`);
      } catch (err) {
        loginMsg('Não foi possível enviar o link: ' + err.message, true);
      } finally {
        btn.disabled = false;
      }
    };
    $('#btnEmail').addEventListener('click', sendEmail);
    $('#loginEmail').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendEmail(); }
    });

    Cloud.onAuthChange((u, event) => {
      const previous = user;
      user = u;
      renderAccount();
      if (u && !previous && event === 'SIGNED_IN') {
        if ($('#dlgLogin').open) $('#dlgLogin').close();
        toast(`Conectado como ${u.email || 'usuário'}`);
      }
      if (!u && previous) {
        state.cloudId = null;
        persist();
        setStatus('');
      }
      if ($('#dlgProjects').open) { renderLocalList(); renderCloudList(); }
    });
  }

  // ---------- Arquivos ----------

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = $('#fileInput');
      input.accept = accept;
      input.value = '';
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }

  async function fileAction(kind) {
    try {
      if (kind === 'export-json') {
        Store.download(`${slug(state.name)}.json`, JSON.stringify(projectData(), null, 2), 'application/json');
      } else if (kind === 'export-csv') {
        Store.download(`${slug(state.name)}-pecas.csv`, Store.piecesToCSV(state.pieces, state.stocks), 'text/csv;charset=utf-8');
      } else if (kind === 'import-json') {
        const f = await pickFile('.json,application/json');
        if (!f) return;
        const data = JSON.parse(await Store.readFile(f));
        if (!data || !Array.isArray(data.pieces)) throw new Error('arquivo não parece ser um projeto');
        loadState({ ...data, cloudId: null }, 'Projeto importado');
      } else if (kind === 'import-csv') {
        const f = await pickFile('.csv,text/csv,.txt');
        if (!f) return;
        const pieces = Store.parsePiecesCSV(await Store.readFile(f));
        if (!pieces.length) throw new Error('nenhuma peça encontrada no CSV');
        const replace = state.pieces.every((p) => !p.length && !p.width) ||
          confirm(`Encontradas ${pieces.length} peças.\n\nOK = substituir a lista atual\nCancelar = adicionar ao final`);
        const byName = (n) => (state.stocks.find((s) => n && s.name.trim().toLowerCase() === n.trim().toLowerCase()) || {}).id || '';
        const mapped = pieces.map(({ stockName, ...p }) => ({ id: uid(), ...p, stock: byName(stockName), enabled: p.enabled !== false }));
        state.pieces = replace ? mapped : state.pieces.concat(mapped);
        changed({ rerender: true });
        toast(`${pieces.length} peças importadas`);
      }
    } catch (err) {
      toast('Não foi possível ler o arquivo: ' + err.message);
    }
  }

  // ---------- Eventos ----------

  function bind() {
    bindTable('#piecesBody', 'pieces');
    bindTable('#stocksBody', 'stocks');

    $('#allPieces').addEventListener('change', (e) => {
      state.pieces.forEach((p) => { p.enabled = e.target.checked; });
      changed({ rerender: true });
    });
    $('#allStocks').addEventListener('change', (e) => {
      state.stocks.forEach((s) => { s.enabled = e.target.checked; });
      changed({ rerender: true });
    });

    $('#addPiece').addEventListener('click', addPiece);
    $('#addStock').addEventListener('click', addStock);
    $('#clearPieces').addEventListener('click', () => {
      if (!state.pieces.length || !confirm('Remover todas as peças da lista?')) return;
      state.pieces = [];
      addPiece();
    });

    $('#projectName').addEventListener('input', (e) => {
      state.name = e.target.value;
      persist();
      setStatus('Alterações não salvas');
      const title = $('.results-head h2');
      if (title) title.textContent = state.name || 'Plano de corte';
    });
    $('#optUnit').addEventListener('change', (e) => {
      state.unit = e.target.value;
      updateUnitLabels();
      renderPieces(); // o seletor de chapa mostra as medidas com a unidade
      $('#stocksBody').innerHTML = state.stocks.map(stockRow).join('');
      changed();
    });
    $('#optKerf').addEventListener('input', (e) => { state.kerf = e.target.value === '' ? 0 : +e.target.value; changed(); });
    $('#optTrim').addEventListener('input', (e) => { state.trim = e.target.value === '' ? 0 : +e.target.value; changed(); });
    $('#optGrain').addEventListener('change', (e) => {
      state.considerGrain = e.target.checked;
      document.querySelectorAll('#piecesBody select[data-f="grain"]').forEach((s) => { s.disabled = !state.considerGrain; });
      changed();
    });

    $('#optPriority').addEventListener('change', (e) => { state.priority = e.target.value; changed(); });

    $('#btnCalc').addEventListener('click', calculate);

    // Na impressão/PDF, mostra também as seções recolhidas (ex.: sequência de cortes).
    window.addEventListener('beforeprint', () => {
      document.querySelectorAll('#results details').forEach((d) => { d.open = true; });
    });

    $('#btnNew').addEventListener('click', () => {
      if (!confirm('Começar um projeto novo? As alterações não salvas serão perdidas.')) return;
      loadState({
        ...defaultState(),
        name: 'Novo projeto',
        pieces: [{ id: uid(), name: '', length: '', width: '', qty: 1, grain: 'none', edges: {} }],
      });
    });
    $('#btnSave').addEventListener('click', save);
    $('#btnOpen').addEventListener('click', openProjects);
    $('#btnShare').addEventListener('click', openShare);
    $('#btnCopyLink').addEventListener('click', copyShareLink);
    $('#btnNativeShare').addEventListener('click', () => {
      navigator.share({ title: state.name || 'Plano de corte', url: $('#shareLink').value }).catch(() => {});
    });
    window.addEventListener('hashchange', openSharedFromUrl);
    $('#dlgProjects').addEventListener('click', onProjectsClick);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    });

    const dropdown = $('.dropdown');
    dropdown.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-file]');
      if (!btn) return;
      dropdown.open = false;
      fileAction(btn.dataset.file);
    });
    document.addEventListener('click', (e) => {
      if (dropdown.open && !dropdown.contains(e.target)) dropdown.open = false;
    });

    const results = $('#results');
    results.addEventListener('change', (e) => {
      const k = e.target.dataset.view;
      if (!k) return;
      state[k] = e.target.checked;
      persist();
      renderResults();
    });
    results.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.zoom) {
        state.zoom = nextIn(ZOOMS, state.zoom, +btn.dataset.zoom);
        persist();
        applyZoom();
      } else if (btn.dataset.font) {
        state.fontScale = nextIn(FONT_SCALES, state.fontScale, +btn.dataset.font);
        persist();
        renderResults();
        results.querySelector(`[data-font="${btn.dataset.font}"]`).focus();
      } else if (btn.dataset.set) {
        state[btn.dataset.set] = btn.dataset.val === 'true';
        persist();
        renderResults();
        results.querySelector(`[data-set="${btn.dataset.set}"][data-val="${btn.dataset.val}"]`).focus();
      } else if (btn.dataset.step !== undefined) {
        setStep(+btn.closest('.stepper').dataset.group, +btn.dataset.step);
      } else if (btn.dataset.panel) {
        e.preventDefault(); // não abre/fecha o painel
        const n = lastResult.sheets.length;
        panelIndex = (panelIndex + +btn.dataset.panel + n) % n;
        const old = results.querySelector('.panel-sheet');
        const tmp = document.createElement('div');
        tmp.innerHTML = panelStats(lastResult, results._groups);
        old.replaceWith(tmp.firstElementChild);
        results.querySelector(`.panel-sheet [data-panel="${btn.dataset.panel}"]`).focus();
      } else if (btn.dataset.goto) {
        results.querySelector(`.sheet[data-group="${btn.dataset.goto}"]`).scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (btn.id === 'btnPrint') window.print();
      else if (btn.id === 'btnPngAll') {
        for (let i = 0; i < results._groups.length; i++) await downloadPng(i);
      } else if (btn.dataset.png) downloadPng(+btn.dataset.png);
    });
  }

  renderInputs();
  bind();
  bindApp();
  renderAccount();
  bindAccount();
  calculate();
  openSharedFromUrl();
})();
