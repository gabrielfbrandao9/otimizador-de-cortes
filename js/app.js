/*
 * Interface: tabelas de entrada, cálculo e exibição dos resultados.
 */
(function () {
  'use strict';

  const { Optimizer, Store, Render, Cloud, Projects, Pdf } = window;
  const { fmt, esc } = Render;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
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
    return {
      name: 'Armário de cozinha',
      unit: 'mm',
      kerf: 3,
      trim: 10,
      considerGrain: true,
      priority: 'waste',
      showLabels: true,
      showOffcuts: true,
      showOrder: false,
      zoom: 1,
      fontScale: 1,
      mono: false,
      vertical: false,
      stocks: [{ id: uid(), name: 'MDF 18mm', length: 2750, width: 1840, qty: 5 }],
      pieces: [
        { id: uid(), name: 'Lateral', length: 720, width: 550, qty: 2, grain: 'length' },
        { id: uid(), name: 'Base', length: 764, width: 550, qty: 2, grain: 'length' },
        { id: uid(), name: 'Prateleira', length: 762, width: 500, qty: 2, grain: 'length' },
        { id: uid(), name: 'Porta', length: 716, width: 397, qty: 4, grain: 'length' },
        { id: uid(), name: 'Travessa', length: 764, width: 100, qty: 4, grain: 'none' },
        { id: uid(), name: 'Gaveta frente', length: 396, width: 180, qty: 3, grain: 'length' },
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
      stock: typeof p.stock === 'string' ? p.stock : '',
      enabled: p.enabled !== false,
    }));
    delete st.showEdges;
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
    st.id = typeof st.id === 'string' && st.id ? st.id : (typeof st.cloudId === 'string' && st.cloudId) || Projects.uuid();
    delete st.cloudId;
    return st;
  }

  // Modo embutido (endereço com ?embed): o orcamento-marcenaria abre o Otimizador
  // escondido para gerar o PDF de um projeto. Nesse modo nada é carregado nem
  // salvo (nem no aparelho nem na nuvem) e o projeto aberto não é tocado.
  const EMBED = new URLSearchParams(location.search).has('embed');

  let state = normalize((!EMBED && Store.loadCurrent()) || defaultState());
  let lastResult = null;
  let calcTimer = null;
  let saveTimer = null;
  let refreshPending = false;
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
    if (EMBED) return;
    Store.saveCurrent(state);
  }

  function changed({ rerender } = {}) {
    persist();
    scheduleSave();
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
      grain: 'none',
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
        ${row('Espessura da serra', len(+state.kerf || 0))}
        ${row('Refilo', len(+state.trim || 0))}
        ${row('Veio', state.considerGrain ? 'Respeitado' : 'Ignorado')}
        ${row('Prioridade de otimização', PRIORITIES[state.priority])}
      </table>
    </details>`;
  }

  // Painel "Estatísticas por chapa", com navegação ‹ 1 / N ›
  let panelIndex = 0;

  // forPdf: título "Estatísticas da chapa N de M" (no PDF aparecem todas as chapas).
  function panelStats(res, groups, forPdf) {
    const n = res.sheets.length;
    if (!n) return '';
    if (panelIndex >= n) panelIndex = 0;
    const i = panelIndex;
    const s = res.sheets[i];
    const u = UNITS[state.unit];
    const waste = s.area - s.usedArea;
    const gi = groups.findIndex((g) => i >= g.first - 1 && i < g.first - 1 + g.count);
    const g = groups[gi];

    const offcuts = s.offcuts.length
      ? `${s.offcuts.length} <span class="muted">(${s.offcuts.map((o) => `${fmt(o.w)} × ${fmt(o.h)} ${unit()}`).join('; ')})</span>`
      : '0';
    const same = g && g.count > 1
      ? `${row('Chapas iguais', `Este plano se repete em ${g.count} chapas (${g.first} a ${g.first + g.count - 1})`)}`
      : '';

    return `<details class="panel panel-sheet" data-key="panel-stats" open>
      <summary>
        <span>${forPdf ? `Estatísticas da chapa ${i + 1} de ${n}` : 'Estatísticas por chapa'}</span>
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
        ${canShareFiles()
          ? '<button type="button" class="btn primary" data-pdf="share">Enviar PDF</button>'
          : '<button type="button" class="btn primary" data-pdf="download">Baixar PDF</button>'}
        <button type="button" class="btn" data-pdf="open">Ver / imprimir</button>
        ${canShareFiles() ? '<button type="button" class="btn" data-pdf="download">Baixar</button>' : ''}
        <button type="button" class="btn" id="btnPngAll">Baixar imagens</button>
      </div>
    </div>`;

    html += '<div class="stats">'
      + stat('Aproveitamento', `${fmt(st.efficiency * 100)}%`, `<span class="bar"><span style="width:${(st.efficiency * 100).toFixed(1)}%"></span></span>`)
      + stat('Chapas usadas', st.sheetCount)
      + stat('Área de chapa', `${fmt(st.totalArea / u.area)} ${u.areaU}`, `peças ${fmt(st.usedArea / u.area)} ${u.areaU} · sobra ${fmt(st.wasteArea / u.area)} ${u.areaU}`)
      + stat('Cortes', st.cutCount, `${fmt(st.cutLength / u.len)} ${u.lenU} de corte`)
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
      showLabels: state.showLabels,
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

  // ---------- PDF (como no orcamento-marcenaria) ----------

  function canShareFiles() {
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] }));
    } catch (e) {
      return false;
    }
  }

  // Estatísticas de cada chapa (na tela só aparece a aba escolhida; no PDF, todas).
  function allSheetStats() {
    const groups = $('#results')._groups || [];
    const keep = panelIndex;
    const out = lastResult.sheets.map((_, i) => {
      panelIndex = i;
      return panelStats(lastResult, groups, true);
    });
    panelIndex = keep;
    return out;
  }

  // O PDF tem o mesmo visual do resultado na tela (como a antiga impressão).
  async function makePdf() {
    if (!lastResult || !lastResult.sheets.length) throw new Error('calcule o plano de corte primeiro');
    toast('Gerando o PDF…');
    return Pdf.build($('#results'), state, { sheetStats: allSheetStats() });
  }

  function pdfError(err) {
    toast('Não foi possível gerar o PDF: ' + err.message);
  }

  async function pdfOpen() {
    const w = window.open('', '_blank'); // abre já, para o navegador não bloquear
    try {
      const { blob, name } = await makePdf();
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url;
      else Store.download(name, blob);
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (err) {
      if (w) w.close();
      pdfError(err);
    }
  }

  async function pdfDownload() {
    try {
      const { blob, name } = await makePdf();
      Store.download(name, blob);
      toast(`PDF salvo: ${name}`);
    } catch (err) {
      pdfError(err);
    }
  }

  async function pdfShare() {
    let pdf;
    try {
      pdf = await makePdf();
      const file = new File([pdf.blob], pdf.name, { type: 'application/pdf' });
      await navigator.share({ files: [file], title: pdf.name.replace(/\.pdf$/, '') });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (pdf) {
        Store.download(pdf.name, pdf.blob);
        toast('Não deu para abrir o compartilhamento; o PDF foi baixado.');
      } else {
        pdfError(err);
      }
    }
  }

  // ---------- Projetos (salvamento automático) ----------

  // Dados do projeto, sem o id (para salvar, exportar e compartilhar).
  function projectData() {
    const { id, ...data } = state;
    return data;
  }

  const hasContent = (s) => s.pieces.some((p) => +p.length > 0 && +p.width > 0);

  // Cada alteração é gravada no aparelho e, logo depois, enviada para a nuvem.
  function scheduleSave() {
    if (EMBED) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
    renderSync();
  }

  function flushSave() {
    if (EMBED || !saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    Projects.put(state.id, (state.name || '').trim() || 'Sem nome', projectData());
    renderSync();
  }

  function renderSync() {
    const el = $('#saveStatus');
    const st = Projects.status();
    const pend = Projects.pendingCount();
    let text;
    let mode = st;
    if (saveTimer) { text = 'Salvando…'; mode = 'saving'; }
    else if (!Cloud.enabled) { text = '✓ Salvo no aparelho'; mode = 'saved'; }
    else if (!user) { text = 'Salvo só neste aparelho · entrar'; mode = 'local'; }
    else if (st === 'saving') text = 'Salvando na nuvem…';
    else if (st === 'saved') text = '✓ Salvo na nuvem';
    else if (st === 'offline') text = pend ? `Sem internet · ${pend} pendente${pend > 1 ? 's' : ''}` : 'Sem internet';
    else if (st === 'error') text = 'Erro ao salvar · tentar de novo';
    else text = '✓ Salvo no aparelho';
    el.innerHTML = `<span class="sync-text">${esc(text)}</span>`;
    el.setAttribute('aria-label', text);
    el.dataset.state = mode;
    el.title = mode === 'error' && Projects.lastError()
      ? `Erro: ${Projects.lastError().message || Projects.lastError()}. Clique para tentar de novo.`
      : user ? 'Clique para sincronizar agora' : (Cloud.enabled ? 'Entre na sua conta para guardar na nuvem' : '');
  }

  function onSyncStatusClick() {
    if (mobile.matches) toast($('#saveStatus').textContent);
    if (Cloud.enabled && !user) return openLogin();
    flushSave();
    Projects.sync(true);
  }

  // Troca o projeto aberto (o anterior já está salvo).
  function loadState(s, msg) {
    state = normalize(s);
    persist();
    renderInputs();
    lastResult = null;
    steps.clear();
    calculate();
    renderSync();
    if (msg) toast(msg);
  }

  // Abre dados recebidos (exemplo, arquivo, link) como um projeto novo.
  function openAsNew(data, msg) {
    flushSave();
    const { id, cloudId, ...rest } = data;
    loadState({ ...rest, id: Projects.uuid() }, msg);
    Projects.put(state.id, (state.name || '').trim() || 'Sem nome', projectData());
  }

  function newProject() {
    flushSave();
    loadState({
      ...defaultState(),
      id: Projects.uuid(),
      name: 'Novo projeto',
      pieces: [{ id: uid(), name: '', length: '', width: '', qty: 1, grain: 'none' }],
    });
  }

  function openProject(id) {
    if (id === state.id) return;
    const data = Projects.get(id);
    if (!data) return;
    flushSave();
    loadState({ ...data, id }, `“${data.name}” aberto`);
  }

  // Projeto aberto foi excluído (aqui ou em outro aparelho): abre o mais recente ou um novo.
  function leaveDeletedProject() {
    const next = Projects.list()[0];
    if (next) loadState({ ...Projects.get(next.id), id: next.id });
    else newProject();
  }

  function renderProjectList() {
    const list = Projects.list();
    const note = !Cloud.enabled
      ? 'Os projetos são salvos automaticamente neste aparelho.'
      : user
        ? `Salvos automaticamente neste aparelho e na nuvem (${esc(user.email || 'sua conta')}). Aparecem em todos os aparelhos em que você entrar.`
        : 'Salvos automaticamente neste aparelho. <button type="button" class="link" data-act="login">Entre na sua conta</button> para guardar na nuvem e abrir em outros aparelhos.';
    $('#projectsNote').innerHTML = note;
    const ul = $('#projectList');
    if (!list.length) {
      ul.innerHTML = '<li class="muted">Nenhum projeto ainda. Eles aparecem aqui assim que você começa a editar.</li>';
      return;
    }
    ul.innerHTML = list.map((p) => {
      const current = p.id === state.id;
      const where = !user ? '' : p.nuvem && !p.pendente ? ' · ☁ na nuvem' : ' · enviando…';
      return `<li${current ? ' class="current"' : ''}>
        <div><strong>${esc(p.name)}</strong><small>${dateFmt.format(p.alterado_em)}${where}${current ? ' · aberto agora' : ''}</small></div>
        ${current ? '' : `<button type="button" class="btn" data-open="${esc(p.id)}">Abrir</button>`}
        <button type="button" class="icon" data-del="${esc(p.id)}" data-name="${esc(p.name)}" aria-label="Excluir">×</button>
      </li>`;
    }).join('');
  }

  function openProjects() {
    flushSave();
    renderProjectList();
    $('#dlgProjects').showModal();
    if (user) Projects.sync(true);
  }

  function onProjectsClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const d = btn.dataset;
    if (d.open) {
      $('#dlgProjects').close();
      openProject(d.open);
    } else if (d.del) {
      e.preventDefault();
      const where = user ? 'deste aparelho e da nuvem' : 'deste aparelho';
      if (!confirm(`Excluir “${d.name}” ${where}? Isso não pode ser desfeito.`)) return;
      if (d.del === state.id) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      Projects.remove(d.del);
      if (d.del === state.id) leaveDeletedProject();
      renderProjectList();
      toast('Projeto excluído');
    }
  }

  function isTyping() {
    const a = document.activeElement;
    return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !a.closest('dialog');
  }

  // Chegaram alterações de outro aparelho.
  function onRemoteChange(ids) {
    if ($('#dlgProjects').open) renderProjectList();
    if (ids.length && !ids.includes(state.id)) return;
    if (saveTimer) return; // há alteração local ainda não salva: ela vence
    const data = Projects.get(state.id);
    if (!data) {
      if (!hasContent(state) || Projects.list().length) {
        toast(`O projeto “${state.name || 'sem nome'}” foi excluído em outro aparelho.`);
        leaveDeletedProject();
      }
      return;
    }
    if (isTyping() || $$('dialog[open]').some((dlg) => dlg.id !== 'dlgProjects')) {
      if (!refreshPending) {
        refreshPending = true;
        waitAndRefresh();
      }
      return;
    }
    refreshPending = false;
    if (JSON.stringify(normalize({ ...data, id: state.id })) === JSON.stringify(state)) return;
    const y = window.scrollY;
    loadState({ ...data, id: state.id });
    window.scrollTo(0, y);
  }

  // Espera a pessoa terminar de digitar (ou fechar a janela aberta) para aplicar o que chegou.
  function waitAndRefresh() {
    setTimeout(() => {
      if (!refreshPending) return;
      if (isTyping() || $$('dialog[open]').some((dlg) => dlg.id !== 'dlgProjects')) return waitAndRefresh();
      refreshPending = false;
      onRemoteChange([state.id]);
    }, 1000);
  }

  function bindProjects() {
    Projects.on((ev) => {
      if (ev.type === 'status') renderSync();
      if (ev.type === 'change' && ev.source === 'remote') onRemoteChange(ev.ids);
      if (ev.type === 'change' && ev.source === 'local' && $('#dlgProjects').open) renderProjectList();
    });
    $('#saveStatus').addEventListener('click', onSyncStatusClick);

    // Aplica as alterações de outro aparelho que chegaram enquanto a pessoa digitava.
    document.addEventListener('focusout', () => {
      setTimeout(() => { if (refreshPending && !isTyping()) onRemoteChange([state.id]); }, 250);
    });

    // Ao voltar para o app, busca o que mudou em outro aparelho; ao sair, envia o que falta.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') Projects.sync(true);
      else { flushSave(); Projects.flush(); }
    });
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('online', () => Projects.sync(true));
    setInterval(() => { if (document.visibilityState === 'visible' && user) Projects.sync(true); }, 90000);

    // Abre o projeto com a versão mais recente salva no aparelho (pode ter chegado de outro aparelho).
    const saved = Projects.get(state.id);
    if (saved) {
      const fresh = normalize({ ...saved, id: state.id });
      if (JSON.stringify(fresh) !== JSON.stringify(state)) {
        state = fresh;
        persist();
        renderInputs();
      }
    } else if (hasContent(state)) {
      // Primeira vez com esta versão: o projeto aberto entra na lista.
      Projects.put(state.id, (state.name || '').trim() || 'Sem nome', projectData());
    }
    renderSync();
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
      $('#menuInstall').hidden = false;
    });
    $('#btnInstall').addEventListener('click', async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      $('#btnInstall').hidden = true;
      $('#menuInstall').hidden = true;
    });
    window.addEventListener('appinstalled', () => {
      $('#btnInstall').hidden = true;
      $('#menuInstall').hidden = true;
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
    history.replaceState(null, '', location.pathname + location.search);
    openAsNew(data, `Projeto compartilhado “${name}” aberto e salvo nos seus projetos.`);
  }

  // ---------- Conta ----------

  function renderAccount() {
    const box = $('#account');
    const menu = $('#menuAccount');
    box.hidden = !Cloud.enabled;
    menu.hidden = !Cloud.enabled;
    if (!Cloud.enabled) return;
    menu.innerHTML = user
      ? `<hr><button type="button" data-act="logout">Sair da conta <small class="muted">(${esc(user.email || '')})</small></button>`
      : '<hr><button type="button" data-act="login">Entrar na conta</button>';
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
      if ((u && u.id) !== (previous && previous.id)) {
        flushSave();
        Projects.setUser(u);
      }
      renderSync();
      if ($('#dlgProjects').open) renderProjectList();
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
        openAsNew(data, `Projeto “${data.name || 'importado'}” importado`);
      } else if (kind === 'example-wardrobe') {
        const data = await (await fetch('exemplos/guarda-roupa-4-portas-4-gavetas.json')).json();
        openAsNew(data, `Exemplo “${data.name}” aberto`);
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
      scheduleSave();
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

    $('#btnNew').addEventListener('click', newProject);
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
        onSyncStatusClick();
      }
    });

    const dropdown = $('.dropdown');
    dropdown.addEventListener('click', (e) => {
      const btn = e.target.closest('.menu button');
      if (!btn) return;
      dropdown.open = false;
      if (btn.dataset.file) fileAction(btn.dataset.file);
      else if (btn.dataset.menu === 'new') newProject();
      else if (btn.dataset.menu === 'open') openProjects();
      else if (btn.dataset.menu === 'share') openShare();
      else if (btn.dataset.menu === 'install') $('#btnInstall').click();
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
      scheduleSave();
      renderResults();
    });
    results.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.zoom) {
        state.zoom = nextIn(ZOOMS, state.zoom, +btn.dataset.zoom);
        persist();
        scheduleSave();
        applyZoom();
      } else if (btn.dataset.font) {
        state.fontScale = nextIn(FONT_SCALES, state.fontScale, +btn.dataset.font);
        persist();
        scheduleSave();
        renderResults();
        results.querySelector(`[data-font="${btn.dataset.font}"]`).focus();
      } else if (btn.dataset.set) {
        state[btn.dataset.set] = btn.dataset.val === 'true';
        persist();
        scheduleSave();
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
      } else if (btn.dataset.pdf === 'open') pdfOpen();
      else if (btn.dataset.pdf === 'download') pdfDownload();
      else if (btn.dataset.pdf === 'share') pdfShare();
      else if (btn.id === 'btnPngAll') {
        for (let i = 0; i < results._groups.length; i++) await downloadPng(i);
      } else if (btn.dataset.png) downloadPng(+btn.dataset.png);
    });
  }

  if (EMBED) {
    // Gera o mesmo PDF do botão "Baixar PDF" para o projeto recebido.
    // Retorna { blob, name, stats, unplaced } (unplaced = peças que não couberam).
    window.OtimizadorEmbed = {
      async pdf(project) {
        state = normalize({ ...project, id: 'embed' });
        renderInputs();
        lastResult = Optimizer.optimize(state);
        steps.clear();
        renderResults();
        if (!lastResult.sheets.length) throw new Error('nenhuma peça coube nas chapas do projeto');
        const pdf = await Pdf.build($('#results'), state, { sheetStats: allSheetStats() });
        return { ...pdf, stats: lastResult.stats, unplaced: lastResult.unplaced.reduce((t, u) => t + u.count, 0) };
      },
    };
    renderInputs();
    bind();
  } else {
    renderInputs();
    bind();
    bindProjects();
    bindApp();
    renderAccount();
    bindAccount();
    calculate();
    openSharedFromUrl();
  }
})();
