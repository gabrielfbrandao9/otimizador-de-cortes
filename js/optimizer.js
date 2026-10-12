/*
 * Otimizador de Cortes — motor de otimização
 *
 * Algoritmo "guilhotina" (todo corte atravessa a peça/sobra de ponta a ponta,
 * como numa serra esquadrejadeira). Para chegar num bom resultado, o mesmo
 * problema é resolvido com várias combinações de heurísticas (ordenação das
 * peças, regra de encaixe, regra de divisão da sobra e escolha da chapa) e o
 * melhor plano é mantido.
 */
(function (global) {
  'use strict';

  const EPS = 1e-6;

  // Critérios de ordenação das peças (maiores primeiro).
  const SORTS = [
    (a, b) => b.w * b.h - a.w * a.h,
    (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
    (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || b.w * b.h - a.w * a.h,
    (a, b) => b.w + b.h - (a.w + a.h),
    (a, b) => b.w - a.w || b.h - a.h,
    (a, b) => b.h - a.h || b.w - a.w,
  ];

  // Regras de divisão da sobra após posicionar uma peça.
  //  slas/llas: eixo da sobra mais curta/longa · sas/las: eixo mais curto/longo
  //  h/v: sempre horizontal/vertical primeiro
  const SPLITS = ['slas', 'llas', 'sas', 'las', 'h', 'v'];

  // Regras de escolha do espaço livre.
  //  bssf: menor lado restante · baf: menor área restante · blsf: menor lado maior restante
  const FITS = ['bssf', 'baf', 'blsf'];

  // Ordem de abertura de novas chapas: ordem da lista ou menor área primeiro.
  const STOCK_PICKS = ['order', 'area'];

  // stockOf(p): índice da chapa obrigatória da peça, -1 = qualquer, -2 = chapa indisponível
  function expandItems(pieces, considerGrain, stockOf) {
    const items = [];
    pieces.forEach((p, index) => {
      const L = +p.length;
      const W = +p.width;
      const q = Math.floor(+p.qty);
      if (!(L > 0 && W > 0 && q > 0)) return;
      let w = L, h = W, rotated = false, canRotate = true;
      if (considerGrain && p.grain === 'length') {
        canRotate = false;
      } else if (considerGrain && p.grain === 'width') {
        w = W; h = L; rotated = true; canRotate = false;
      }
      const stock = stockOf(p);
      for (let i = 0; i < q; i++) items.push({ piece: index, w, h, rotated, canRotate, stock });
    });
    return items;
  }

  function fitsStock(stock, it, trim) {
    const sw = stock.length - 2 * trim;
    const sh = stock.width - 2 * trim;
    if (it.w <= sw + EPS && it.h <= sh + EPS) return true;
    return it.canRotate && it.h <= sw + EPS && it.w <= sh + EPS;
  }

  function findBest(sheets, it, fit) {
    let best = null;
    const orientations = it.canRotate && it.w !== it.h ? 2 : 1;
    for (const sheet of sheets) {
      if (it.stock !== -1 && sheet.stock !== it.stock) continue;
      for (let fi = 0; fi < sheet.free.length; fi++) {
        const f = sheet.free[fi];
        for (let o = 0; o < orientations; o++) {
          const w = o ? it.h : it.w;
          const h = o ? it.w : it.h;
          if (w > f.w + EPS || h > f.h + EPS) continue;
          const dw = f.w - w;
          const dh = f.h - h;
          let s1, s2;
          if (fit === 'baf') { s1 = f.w * f.h - w * h; s2 = Math.min(dw, dh); }
          else if (fit === 'blsf') { s1 = Math.max(dw, dh); s2 = Math.min(dw, dh); }
          else { s1 = Math.min(dw, dh); s2 = Math.max(dw, dh); }
          if (!best || s1 < best.s1 - EPS || (Math.abs(s1 - best.s1) <= EPS && s2 < best.s2 - EPS)) {
            best = { sheet, fi, w, h, turned: o === 1, s1, s2 };
          }
        }
      }
    }
    return best;
  }

  function place(b, it, kerf, split) {
    const { sheet, fi, w, h } = b;
    const f = sheet.free[fi];
    sheet.parts.push({ x: f.x, y: f.y, w, h, piece: it.piece, rotated: it.rotated !== b.turned });

    const dw = f.w - w;
    const dh = f.h - h;
    let horizontal;
    switch (split) {
      case 'slas': horizontal = dw < dh; break;
      case 'llas': horizontal = dw >= dh; break;
      case 'sas': horizontal = f.w <= f.h; break;
      case 'las': horizontal = f.w > f.h; break;
      case 'h': horizontal = true; break;
      default: horizontal = false;
    }

    const rw = dw - kerf;
    const bh = dh - kerf;
    const out = [];
    const cx = f.x + w + kerf / 2;
    const cy = f.y + h + kerf / 2;
    const piece = { w, h, piece: it.piece };

    // Cada corte guarda o painel que está sendo cortado, a posição do corte
    // (medida a partir da borda do painel) e os dois pedaços resultantes
    // (null = tira mais fina que a serra, vira pó).
    // Os cortes são registrados em uma ordem que pode ser executada na serra:
    // um painel só é cortado depois do corte que o separou.
    if (horizontal) {
      const bottom = bh > EPS ? { x: f.x, y: f.y + h + kerf, w: f.w, h: bh } : null;
      const right = rw > EPS ? { x: f.x + w + kerf, y: f.y, w: rw, h } : null;
      if (bottom) out.push(bottom);
      if (right) out.push(right);
      if (dh > EPS) addCut(sheet, f.x, cy, f.x + f.w, cy, f.w, f.h, 'y', h, dw > EPS ? { w: f.w, h } : piece, bottom);
      if (dw > EPS) addCut(sheet, cx, f.y, cx, f.y + h, f.w, h, 'x', w, piece, right);
    } else {
      const right = rw > EPS ? { x: f.x + w + kerf, y: f.y, w: rw, h: f.h } : null;
      const bottom = bh > EPS ? { x: f.x, y: f.y + h + kerf, w, h: bh } : null;
      if (right) out.push(right);
      if (bottom) out.push(bottom);
      if (dw > EPS) addCut(sheet, cx, f.y, cx, f.y + f.h, f.w, f.h, 'x', w, dh > EPS ? { w, h: f.h } : piece, right);
      if (dh > EPS) addCut(sheet, f.x, cy, f.x + w, cy, w, f.h, 'y', h, piece, bottom);
    }
    sheet.free.splice(fi, 1, ...out);
  }

  function addCut(sheet, x1, y1, x2, y2, pw, ph, axis, pos, a, b) {
    sheet.cuts.push({ x1, y1, x2, y2, panel: { w: pw, h: ph }, axis, pos, a, b });
  }

  function pack(items, stocks, opt, strat) {
    const { kerf, trim } = opt;
    const remaining = stocks.map((s) => s.qty);
    const order = stocks.map((_, i) => i);
    if (strat.pick === 'area') {
      order.sort((a, b) => stocks[a].length * stocks[a].width - stocks[b].length * stocks[b].width);
    }

    const sheets = [];
    const unplaced = [];
    for (const it of items) {
      let best = findBest(sheets, it, strat.fit);
      if (!best) {
        const si = order.find((i) => (it.stock === -1 || i === it.stock) && remaining[i] > 0 && fitsStock(stocks[i], it, trim));
        if (si === undefined) { unplaced.push(it); continue; }
        remaining[si]--;
        const s = stocks[si];
        const sheet = {
          stock: si,
          L: s.length,
          W: s.width,
          free: [{ x: trim, y: trim, w: s.length - 2 * trim, h: s.width - 2 * trim }],
          parts: [],
          cuts: [],
        };
        sheets.push(sheet);
        best = findBest([sheet], it, strat.fit);
      }
      place(best, it, kerf, strat.split);
    }
    return { sheets, unplaced };
  }

  function score(res, priority) {
    let area = 0, concentration = 0, cuts = 0;
    for (const s of res.sheets) {
      const a = s.L * s.W;
      const used = s.parts.reduce((t, p) => t + p.w * p.h, 0);
      area += a;
      concentration += (used / a) ** 2;
      cuts += s.cuts.length;
    }
    if (priority === 'cuts') {
      // Menos peças de fora > menos chapas > menos cortes > menos área de chapa
      return [res.unplaced.length, res.sheets.length, cuts, area, -concentration];
    }
    // Menos peças de fora > menos área de chapa > menos chapas >
    // chapas mais cheias (sobra concentrada) > menos cortes
    return [res.unplaced.length, area, res.sheets.length, -concentration, cuts];
  }

  function better(a, b) {
    for (let i = 0; i < a.length; i++) {
      const tol = Math.abs(b[i]) * 1e-9 + EPS;
      if (a[i] < b[i] - tol) return true;
      if (a[i] > b[i] + tol) return false;
    }
    return false;
  }

  function strategies(n) {
    const list = [];
    for (const split of SPLITS)
      for (const fit of FITS)
        for (const pick of STOCK_PICKS)
          for (let s = 0; s < SORTS.length; s++) list.push({ sort: s, split, fit, pick });
    // Limita o número de tentativas em listas muito grandes.
    const max = Math.max(12, Math.floor(3e8 / Math.max(1, n * n)));
    return list.slice(0, max);
  }

  /**
   * @param {object} input
   *   pieces: [{ name, length, width, qty, grain: 'none'|'length'|'width', edges: {c1,c2,l1,l2} }]
   *   stocks: [{ name, length, width, qty }]
   *   kerf, trim: números (mesma unidade das medidas)
   *   considerGrain: boolean
   */
  function optimize(input) {
    const kerf = Math.max(0, +input.kerf || 0);
    const trim = Math.max(0, +input.trim || 0);
    const stocks = input.stocks
      .map((s, index) => ({
        index,
        id: s.id,
        name: s.name,
        length: +s.length,
        width: +s.width,
        qty: Math.floor(+s.qty),
      }))
      .filter((s) => s.length > 2 * trim && s.width > 2 * trim && s.qty > 0);

    // A peça pode exigir uma chapa específica (pelo id da chapa).
    const stockById = new Map();
    stocks.forEach((s, i) => { if (s.id) stockById.set(s.id, i); });
    const stockOf = (p) => (!p.stock ? -1 : stockById.has(p.stock) ? stockById.get(p.stock) : -2);
    const items = expandItems(input.pieces, !!input.considerGrain, stockOf);

    let best = null, bestScore = null;
    if (stocks.length) {
      for (const st of strategies(items.length)) {
        const sorter = SORTS[st.sort];
        const ordered = items.slice().sort((a, b) => sorter(a, b) || a.piece - b.piece);
        const res = pack(ordered, stocks, { kerf, trim }, st);
        const sc = score(res, input.priority);
        if (!best || better(sc, bestScore)) { best = res; bestScore = sc; }
      }
    } else {
      best = { sheets: [], unplaced: items };
    }

    return finalize(best, stocks, input, trim);
  }

  function finalize(res, stocks, input, trim) {
    let totalArea = 0, usedArea = 0, cutCount = 0, cutLength = 0, edgeLength = 0;

    const sheets = res.sheets.map((s) => {
      // Pedaços que nunca foram cortados de novo são sobras; os demais são painéis intermediários.
      const leftovers = new Set(s.free);
      const result = (r) => {
        if (!r) return null;
        if (r.piece !== undefined) return { w: r.w, h: r.h, piece: r.piece };
        return { w: r.w, h: r.h, kind: leftovers.has(r) ? 'sobra' : 'painel' };
      };
      const cuts = s.cuts.map((c) => ({ ...c, a: result(c.a), b: result(c.b) }));

      if (trim > 0) {
        const { L, W } = s;
        const T = trim;
        const R = (w, h, kind) => ({ w, h, kind });
        cuts.unshift(
          { x1: 0, y1: T, x2: L, y2: T, panel: { w: L, h: W }, axis: 'y', pos: T, a: R(L, T, 'refilo'), b: R(L, W - T, 'painel') },
          { x1: 0, y1: W - T, x2: L, y2: W - T, panel: { w: L, h: W - T }, axis: 'y', pos: W - 2 * T, a: R(L, W - 2 * T, 'painel'), b: R(L, T, 'refilo') },
          { x1: T, y1: T, x2: T, y2: W - T, panel: { w: L, h: W - 2 * T }, axis: 'x', pos: T, a: R(T, W - 2 * T, 'refilo'), b: R(L - T, W - 2 * T, 'painel') },
          { x1: L - T, y1: T, x2: L - T, y2: W - T, panel: { w: L - T, h: W - 2 * T }, axis: 'x', pos: L - 2 * T, a: R(L - 2 * T, W - 2 * T, 'painel'), b: R(T, W - 2 * T, 'refilo') }
        );
      }
      const area = s.L * s.W;
      const used = s.parts.reduce((t, p) => t + p.w * p.h, 0);
      let sheetCutLength = 0;
      for (const c of cuts) sheetCutLength += Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
      totalArea += area;
      usedArea += used;
      cutCount += cuts.length;
      cutLength += sheetCutLength;
      for (const p of s.parts) {
        const piece = input.pieces[p.piece];
        const e = piece.edges || {};
        edgeLength += ((e.c1 ? 1 : 0) + (e.c2 ? 1 : 0)) * +piece.length;
        edgeLength += ((e.l1 ? 1 : 0) + (e.l2 ? 1 : 0)) * +piece.width;
      }
      return {
        stockIndex: stocks[s.stock].index,
        name: stocks[s.stock].name,
        L: s.L,
        W: s.W,
        trim,
        parts: s.parts,
        cuts,
        cutLength: sheetCutLength,
        offcuts: s.free.map(({ x, y, w, h }) => ({ x, y, w, h })).sort((a, b) => b.w * b.h - a.w * a.h),
        area,
        usedArea: used,
        efficiency: used / area,
      };
    });

    const unplacedMap = new Map();
    for (const it of res.unplaced) unplacedMap.set(it.piece, (unplacedMap.get(it.piece) || 0) + 1);
    const unplaced = [...unplacedMap].map(([piece, count]) => ({ piece, count }));

    const partsPlaced = sheets.reduce((t, s) => t + s.parts.length, 0);
    return {
      sheets,
      unplaced,
      stats: {
        sheetCount: sheets.length,
        totalArea,
        usedArea,
        wasteArea: totalArea - usedArea,
        efficiency: totalArea ? usedArea / totalArea : 0,
        cutCount,
        cutLength,
        edgeLength,
        partsPlaced,
        partsTotal: partsPlaced + res.unplaced.length,
      },
    };
  }

  global.Optimizer = { optimize };
})(typeof window !== 'undefined' ? window : globalThis);
