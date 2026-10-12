/*
 * Interface: tabelas de entrada, cálculo e exibição dos resultados.
 */
(function () {
  'use strict';

  const { Optimizer, Store, Render } = window;
  const { fmt, esc } = Render;
  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 10);

  const UNITS = {
    mm: { label: 'mm', len: 1000, lenU: 'm', area: 1e6, areaU: 'm²' },
    cm: { label: 'cm', len: 100, lenU: 'm', area: 1e4, areaU: 'm²' },
    in: { label: 'pol', len: 12, lenU: 'pés', area: 144, areaU: 'pés²' },
  };

  const AUTO_CALC_LIMIT = 300; // acima disso o cálculo só roda pelo botão

  function defaultState() {
    const e = (c1, c2, l1, l2) => ({ c1, c2, l1, l2 });
    return {
      name: 'Armário de cozinha',
      unit: 'mm',
      kerf: 3,
      trim: 10,
      considerGrain: true,
      showLabels: true,
      showCuts: false,
      showEdges: true,
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
    }));
    st.stocks = (Array.isArray(st.stocks) ? st.stocks : []).map((x) => ({
      id: x.id || uid(),
      name: x.name || '',
      length: x.length ?? '',
      width: x.width ?? '',
      qty: x.qty ?? 1,
    }));
    if (!UNITS[st.unit]) st.unit = 'mm';
    return st;
  }

  let state = normalize(Store.loadCurrent() || defaultState());
  let lastResult = null;
  let calcTimer = null;

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

  function changed({ rerender } = {}) {
    persist();
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

  function pieceRow(p, i) {
    const c = Render.pieceColor(i);
    const e = p.edges;
    const edgeBtn = (k, label) =>
      `<button type="button" class="edge e-${k}${e[k] ? ' on' : ''}" data-edge="${k}" aria-pressed="${e[k]}" title="${label}"></button>`;
    return `<tr data-id="${p.id}">
      <td class="c-n"><span class="swatch" style="background:${c.swatch}">${i + 1}</span></td>
      <td><input type="text" data-f="name" value="${esc(p.name)}" placeholder="Peça ${i + 1}" aria-label="Nome"></td>
      <td class="c-num">${numInput('length', p.length, 'aria-label="Comprimento"')}</td>
      <td class="c-num">${numInput('width', p.width, 'aria-label="Largura"')}</td>
      <td class="c-qty">${numInput('qty', p.qty, 'step="1" min="1" inputmode="numeric" aria-label="Quantidade"')}</td>
      <td class="c-grain">
        <select data-f="grain" aria-label="Veio" ${state.considerGrain ? '' : 'disabled'}>
          <option value="none"${p.grain === 'none' ? ' selected' : ''}>Livre</option>
          <option value="length"${p.grain === 'length' ? ' selected' : ''}>↔ Comp.</option>
          <option value="width"${p.grain === 'width' ? ' selected' : ''}>↕ Larg.</option>
        </select>
      </td>
      <td class="c-edge">
        <div class="edgebox" role="group" aria-label="Fita de borda">
          ${edgeBtn('c1', 'Comprimento 1 (cima)')}${edgeBtn('c2', 'Comprimento 2 (baixo)')}
          ${edgeBtn('l1', 'Largura 1 (esquerda)')}${edgeBtn('l2', 'Largura 2 (direita)')}
        </div>
      </td>
      <td class="c-del"><button type="button" class="icon" data-act="del" aria-label="Remover peça">×</button></td>
    </tr>`;
  }

  function stockRow(s) {
    return `<tr data-id="${s.id}">
      <td><input type="text" data-f="name" value="${esc(s.name)}" placeholder="Material" aria-label="Material"></td>
      <td class="c-num">${numInput('length', s.length, 'aria-label="Comprimento"')}</td>
      <td class="c-num">${numInput('width', s.width, 'aria-label="Largura"')}</td>
      <td class="c-qty">${numInput('qty', s.qty, 'step="1" min="1" inputmode="numeric" aria-label="Quantidade"')}</td>
      <td class="c-del"><button type="button" class="icon" data-act="del" aria-label="Remover chapa">×</button></td>
    </tr>`;
  }

  function renderInputs() {
    $('#piecesBody').innerHTML = state.pieces.map(pieceRow).join('');
    $('#stocksBody').innerHTML = state.stocks.map(stockRow).join('');
    $('#projectName').value = state.name || '';
    $('#optUnit').value = state.unit;
    $('#optKerf').value = state.kerf;
    $('#optTrim').value = state.trim;
    $('#optGrain').checked = !!state.considerGrain;
    updateCounts();
  }

  function updateCounts() {
    const total = state.pieces.reduce((t, p) => t + (Math.floor(+p.qty) || 0), 0);
    $('#piecesCount').textContent = `${state.pieces.length} tipos · ${total} peças`;
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
      if (!item || !el.dataset.f) return;
      item[el.dataset.f] = el.type === 'number' ? (el.value === '' ? '' : +el.value) : el.value;
      changed();
    });
    body.addEventListener('change', (ev) => {
      if (ev.target.tagName === 'SELECT') {
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
    if (last) last.querySelector('input').focus();
  }

  function addPiece() {
    state.pieces.push({
      id: uid(), name: '', length: '', width: '', qty: 1,
      grain: 'none', edges: { c1: false, c2: false, l1: false, l2: false },
    });
    changed({ rerender: true });
    focusLast('#piecesBody');
  }

  function addStock() {
    const prev = state.stocks[state.stocks.length - 1];
    state.stocks.push({ id: uid(), name: '', length: prev ? prev.length : '', width: prev ? prev.width : '', qty: 1 });
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
        return `<li><span class="dot" style="background:${c.swatch}"></span>${esc(p.name || `Peça ${i + 1}`)} <span class="mono">${fmt(+p.length)} × ${fmt(+p.width)}</span> <strong>×${n}</strong></li>`;
      })
      .join('');
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
        <p class="muted">${st.partsPlaced} de ${st.partsTotal} peças · serra ${fmt(+state.kerf || 0)} ${u.label} · refilo ${fmt(+state.trim || 0)} ${u.label}</p>
      </div>
      <div class="results-actions no-print">
        <button type="button" class="btn" id="btnPrint">Imprimir / PDF</button>
        <button type="button" class="btn" id="btnPngAll">Baixar imagens</button>
      </div>
    </div>`;

    html += '<div class="stats">'
      + stat('Aproveitamento', `${fmt(st.efficiency * 100)}%`, `<span class="bar"><span style="width:${(st.efficiency * 100).toFixed(1)}%"></span></span>`)
      + stat('Chapas usadas', st.sheetCount)
      + stat('Área de chapa', `${fmt(st.totalArea / u.area)} ${u.areaU}`, `peças ${fmt(st.usedArea / u.area)} · sobra ${fmt(st.wasteArea / u.area)}`)
      + stat('Cortes', st.cutCount, `${fmt(st.cutLength / u.len)} ${u.lenU} de corte`)
      + stat('Fita de borda', `${fmt(st.edgeLength / u.len)} ${u.lenU}`)
      + '</div>';

    if (res.unplaced.length) {
      html += '<div class="alert"><strong>Peças que não couberam:</strong><ul>'
        + res.unplaced.map(({ piece, count }) => {
          const p = state.pieces[piece] || {};
          return `<li>${esc(p.name || `Peça ${piece + 1}`)} (${fmt(+p.length)} × ${fmt(+p.width)}) — ${count}</li>`;
        }).join('')
        + '</ul><p>Aumente a quantidade de chapas ou confira se a peça é maior que a chapa (considerando refilo e veio).</p></div>';
    }

    html += `<div class="view-toggles no-print">
      <label class="check inline"><input type="checkbox" data-view="showLabels"${state.showLabels ? ' checked' : ''}><span>Nomes</span></label>
      <label class="check inline"><input type="checkbox" data-view="showEdges"${state.showEdges ? ' checked' : ''}><span>Fita de borda</span></label>
      <label class="check inline"><input type="checkbox" data-view="showCuts"${state.showCuts ? ' checked' : ''}><span>Linhas de corte</span></label>
    </div>`;

    const groups = groupSheets(res.sheets);
    html += '<div class="sheets">';
    groups.forEach((g, gi) => {
      const s = g.sheet;
      const title = g.count > 1 ? `Chapas ${g.first}–${g.first + g.count - 1}` : `Chapa ${g.first}`;
      html += `<article class="sheet" data-group="${gi}">
        <header>
          <div>
            <h3>${title}${g.count > 1 ? ` <span class="badge">×${g.count}</span>` : ''}</h3>
            <p class="muted">${esc(s.name || 'Chapa')} · <span class="mono">${fmt(s.L)} × ${fmt(s.W)}</span> · ${s.parts.length} peças</p>
          </div>
          <div class="sheet-eff"><span class="mono">${fmt(s.efficiency * 100)}%</span><small>aproveitamento</small></div>
          <button type="button" class="icon no-print" data-png="${gi}" title="Baixar imagem desta chapa" aria-label="Baixar imagem">⤓</button>
        </header>
        <div class="svg-wrap">${Render.sheetSVG(s, state.pieces, { ...viewOpts(), key: gi })}</div>
        <ul class="parts-list">${partsSummary(s)}</ul>
      </article>`;
    });
    html += '</div>';

    box.innerHTML = html;
    box._groups = groups;
  }

  function viewOpts() {
    return { showLabels: state.showLabels, showEdges: state.showEdges, showCuts: state.showCuts };
  }

  async function downloadPng(gi) {
    const g = $('#results')._groups[gi];
    const svg = Render.sheetSVG(g.sheet, state.pieces, { ...viewOpts(), key: 'png' + gi });
    await Render.svgToPng(svg, `${slug(state.name)}-chapa-${g.first}.png`);
  }

  // ---------- Projetos ----------

  function openProjects() {
    const list = Store.listProjects();
    const ul = $('#projectList');
    if (!list.length) {
      ul.innerHTML = '<li class="muted">Nenhum projeto salvo ainda. Use “Salvar” para guardar o projeto atual neste navegador.</li>';
    } else {
      const df = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      ul.innerHTML = list.map((p) => `<li>
        <div><strong>${esc(p.name)}</strong><small>${p.savedAt ? df.format(p.savedAt) : ''}</small></div>
        <button type="button" class="btn" data-open="${esc(p.name)}">Abrir</button>
        <button type="button" class="icon" data-del="${esc(p.name)}" aria-label="Excluir">×</button>
      </li>`).join('');
    }
    $('#dlgProjects').showModal();
  }

  function loadState(s, msg) {
    state = normalize(s);
    persist();
    renderInputs();
    lastResult = null;
    calculate();
    if (msg) toast(msg);
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
        Store.download(`${slug(state.name)}.json`, JSON.stringify(state, null, 2), 'application/json');
      } else if (kind === 'export-csv') {
        Store.download(`${slug(state.name)}-pecas.csv`, Store.piecesToCSV(state.pieces), 'text/csv;charset=utf-8');
      } else if (kind === 'import-json') {
        const f = await pickFile('.json,application/json');
        if (!f) return;
        const data = JSON.parse(await Store.readFile(f));
        if (!data || !Array.isArray(data.pieces)) throw new Error('arquivo não parece ser um projeto');
        loadState(data, 'Projeto importado');
      } else if (kind === 'import-csv') {
        const f = await pickFile('.csv,text/csv,.txt');
        if (!f) return;
        const pieces = Store.parsePiecesCSV(await Store.readFile(f));
        if (!pieces.length) throw new Error('nenhuma peça encontrada no CSV');
        const replace = state.pieces.every((p) => !p.length && !p.width) ||
          confirm(`Encontradas ${pieces.length} peças.\n\nOK = substituir a lista atual\nCancelar = adicionar ao final`);
        const mapped = pieces.map((p) => ({ id: uid(), ...p }));
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

    $('#addPiece').addEventListener('click', addPiece);
    $('#addStock').addEventListener('click', addStock);
    $('#clearPieces').addEventListener('click', () => {
      if (!state.pieces.length || !confirm('Remover todas as peças da lista?')) return;
      state.pieces = [];
      addPiece();
    });

    $('#projectName').addEventListener('input', (e) => { state.name = e.target.value; persist(); });
    $('#optUnit').addEventListener('change', (e) => { state.unit = e.target.value; changed(); });
    $('#optKerf').addEventListener('input', (e) => { state.kerf = e.target.value === '' ? 0 : +e.target.value; changed(); });
    $('#optTrim').addEventListener('input', (e) => { state.trim = e.target.value === '' ? 0 : +e.target.value; changed(); });
    $('#optGrain').addEventListener('change', (e) => {
      state.considerGrain = e.target.checked;
      document.querySelectorAll('#piecesBody select[data-f="grain"]').forEach((s) => { s.disabled = !state.considerGrain; });
      changed();
    });

    $('#btnCalc').addEventListener('click', calculate);

    $('#btnNew').addEventListener('click', () => {
      if (!confirm('Começar um projeto novo? As alterações não salvas serão perdidas.')) return;
      loadState({
        ...defaultState(),
        name: 'Novo projeto',
        pieces: [{ id: uid(), name: '', length: '', width: '', qty: 1, grain: 'none', edges: {} }],
      });
    });
    $('#btnSave').addEventListener('click', () => {
      const name = (state.name || '').trim() || prompt('Nome do projeto:');
      if (!name) return;
      state.name = name;
      $('#projectName').value = name;
      toast(Store.saveProject(name, state) ? `“${name}” salvo neste navegador` : 'Não foi possível salvar (armazenamento indisponível)');
    });
    $('#btnOpen').addEventListener('click', openProjects);

    $('#projectList').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.open) {
        const s = Store.loadProject(btn.dataset.open);
        $('#dlgProjects').close();
        if (s) loadState(s, `“${btn.dataset.open}” aberto`);
      } else if (btn.dataset.del) {
        e.preventDefault();
        if (confirm(`Excluir o projeto “${btn.dataset.del}”?`)) {
          Store.deleteProject(btn.dataset.del);
          openProjects();
        }
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
      if (btn.id === 'btnPrint') window.print();
      else if (btn.id === 'btnPngAll') {
        for (let i = 0; i < results._groups.length; i++) await downloadPng(i);
      } else if (btn.dataset.png) downloadPng(+btn.dataset.png);
    });
  }

  renderInputs();
  bind();
  calculate();
})();
