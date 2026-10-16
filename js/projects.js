/*
 * Projetos: guardados no aparelho (localStorage) e sincronizados com a nuvem.
 *
 * Cada alteração é gravada primeiro no aparelho e marcada como "pendente";
 * logo depois é enviada ao Supabase (tabela "projects"). Ao abrir o app, ao
 * voltar para ele e de tempos em tempos, os projetos da nuvem são baixados e
 * combinados com os do aparelho: em cada projeto, vence a alteração mais
 * recente. Assim o app funciona sem internet e os projetos aparecem no
 * celular e no computador.
 *
 * Registro: { id, name, data, alterado_em, nuvem, excluido }
 *   nuvem: o projeto já existe na nuvem (se sumir de lá, foi excluído em outro aparelho)
 *   excluido: exclusão feita aqui, ainda não enviada
 */
(function (global) {
  'use strict';

  const KEY = 'otimizador:db';
  const OLD_LIST = 'otimizador:projetos'; // formato antigo: projetos salvos pelo nome
  const PUSH_DELAY = 1200;

  let db = load();
  let user = null;
  let syncing = false;
  let again = false;
  let pullAgain = false;
  let pushTimer = null;
  let status = 'local';
  let lastError = null;
  const listeners = new Set();

  function empty(userId) {
    return { projects: {}, dirty: {}, user: userId || null };
  }

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && d.projects) return { projects: d.projects, dirty: d.dirty || {}, user: d.user || null };
    } catch (e) { /* sem armazenamento ou dados corrompidos */ }
    return empty();
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      emit({ type: 'error', error: e });
    }
  }

  function emit(ev) {
    listeners.forEach((fn) => { try { fn(ev); } catch (e) { console.error(e); } });
  }

  function setStatus(s, err) {
    status = s;
    lastError = err || null;
    emit({ type: 'status', status: s, error: lastError });
  }

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function write(rec) {
    const prev = db.projects[rec.id];
    // O horário precisa crescer sempre, mesmo com duas alterações no mesmo milissegundo.
    rec.alterado_em = Math.max(Date.now(), prev ? prev.alterado_em + 1 : 0);
    rec.nuvem = prev ? !!prev.nuvem : false;
    db.projects[rec.id] = rec;
    db.dirty[rec.id] = true;
  }

  function pendingCount() {
    return Object.keys(db.dirty).length;
  }

  function schedulePush(delay) {
    clearTimeout(pushTimer);
    if (!user) return;
    pushTimer = setTimeout(() => sync(false), delay == null ? PUSH_DELAY : delay);
  }

  // Combina os projetos da nuvem com os do aparelho. Retorna os ids que mudaram aqui.
  function merge(remote) {
    const changed = [];
    const seen = new Set();
    remote.forEach((r) => {
      seen.add(r.id);
      const t = Number(r.data && r.data.alteradoEm) || Date.parse(r.updated_at) || 0;
      const l = db.projects[r.id];
      if (l && l.excluido) return; // exclusão feita aqui, ainda não enviada
      if (!l || t > l.alterado_em) {
        const { alteradoEm, ...data } = r.data || {};
        db.projects[r.id] = { id: r.id, name: r.name, data, alterado_em: t, nuvem: true };
        delete db.dirty[r.id];
        changed.push(r.id);
      } else {
        l.nuvem = true;
        if (l.alterado_em > t) db.dirty[r.id] = true;
      }
    });
    Object.values(db.projects).forEach((l) => {
      if (seen.has(l.id)) return;
      if (l.excluido) {
        delete db.projects[l.id]; // já não existe na nuvem
        delete db.dirty[l.id];
      } else if (l.nuvem && !db.dirty[l.id]) {
        delete db.projects[l.id]; // foi excluído em outro aparelho
        changed.push(l.id);
      } else {
        l.nuvem = false;
        db.dirty[l.id] = true; // criado sem login ou sem internet: sobe para a nuvem
      }
    });
    return changed;
  }

  async function sync(pull) {
    if (!global.Cloud || !Cloud.enabled || !user) {
      setStatus('local');
      return;
    }
    if (syncing) {
      again = true;
      pullAgain = pullAgain || pull;
      return;
    }
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    syncing = true;
    setStatus('saving');
    try {
      if (pull) {
        const changed = merge(await Cloud.pullAll());
        persist();
        if (changed.length) emit({ type: 'change', source: 'remote', ids: changed });
      }
      const ids = Object.keys(db.dirty);
      if (ids.length) {
        const recs = ids.map((id) => db.projects[id]).filter(Boolean);
        const removed = recs.filter((r) => r.excluido);
        const saved = recs.filter((r) => !r.excluido);
        const sent = saved.map((r) => [r.id, r.alterado_em]);
        for (const r of removed) {
          if (r.nuvem) await Cloud.remove(r.id);
          delete db.projects[r.id];
          delete db.dirty[r.id];
        }
        if (saved.length) {
          await Cloud.push(saved.map((r) => ({ id: r.id, name: r.name, data: { ...r.data, alteradoEm: r.alterado_em } })));
        }
        // Só tira da fila o que não foi alterado de novo durante o envio.
        sent.forEach(([id, t]) => {
          const r = db.projects[id];
          if (!r) return;
          r.nuvem = true;
          if (r.alterado_em === t) delete db.dirty[id];
        });
        ids.forEach((id) => { if (!db.projects[id]) delete db.dirty[id]; });
        persist();
      }
      setStatus(pendingCount() ? 'saving' : 'saved');
    } catch (err) {
      console.error(err);
      setStatus(navigator.onLine ? 'error' : 'offline', err);
    } finally {
      syncing = false;
      if (again) {
        const p = pullAgain;
        again = false;
        pullAgain = false;
        sync(p);
      }
    }
  }

  // Traz os projetos salvos no formato antigo (pelo nome) para este armazenamento.
  function migrate() {
    let old = null;
    try { old = JSON.parse(localStorage.getItem(OLD_LIST)); } catch (e) { /* nada */ }
    if (!old || typeof old !== 'object') return;
    Object.keys(old).forEach((name) => {
      const p = old[name];
      if (!p || !p.state) return;
      const { cloudId, ...data } = p.state;
      const id = uuid();
      db.projects[id] = { id, name, data, alterado_em: p.savedAt || Date.now(), nuvem: false };
      db.dirty[id] = true;
    });
    persist();
    try { localStorage.removeItem(OLD_LIST); } catch (e) { /* nada */ }
  }

  // No modo embutido (?embed, usado pelo orcamento-marcenaria) nada é gravado.
  if (!new URLSearchParams(location.search).has('embed')) migrate();

  const Projects = {
    uuid,

    // Lista (sem os excluídos), do mais recente para o mais antigo.
    list() {
      return Object.values(db.projects)
        .filter((r) => !r.excluido)
        .sort((a, b) => b.alterado_em - a.alterado_em)
        .map((r) => ({ id: r.id, name: r.name, alterado_em: r.alterado_em, nuvem: !!r.nuvem, pendente: !!db.dirty[r.id] }));
    },

    // { ...dados, name } ou null
    get(id) {
      const r = db.projects[id];
      return r && !r.excluido ? { ...clone(r.data), name: r.name } : null;
    },

    put(id, name, data) {
      write({ id, name: name || 'Sem nome', data: clone(data), excluido: false });
      persist();
      emit({ type: 'change', source: 'local', ids: [id] });
      schedulePush();
    },

    remove(id) {
      const r = db.projects[id];
      if (!r) return;
      if (!r.nuvem) {
        delete db.projects[id];
        delete db.dirty[id];
      } else {
        write({ id, name: r.name, data: {}, excluido: true });
      }
      persist();
      emit({ type: 'change', source: 'local', ids: [id] });
      schedulePush(0);
    },

    // Chamado quando a pessoa entra ou sai da conta.
    setUser(u) {
      user = u;
      if (!u) {
        clearTimeout(pushTimer);
        setStatus('local');
        return;
      }
      if (db.user && db.user !== u.id) {
        // Outra conta neste aparelho: não mistura os projetos das duas.
        db = empty(u.id);
        emit({ type: 'change', source: 'remote', ids: [] });
      }
      db.user = u.id;
      persist();
      sync(true);
    },

    sync(pull = true) {
      return sync(pull);
    },

    // Envia já o que estiver pendente (ao sair da página, por exemplo).
    flush() {
      if (pendingCount() && user) sync(false);
    },

    status: () => status,
    lastError: () => lastError,
    pendingCount,
    hasUser: () => !!user,

    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  global.Projects = Projects;
})(window);
