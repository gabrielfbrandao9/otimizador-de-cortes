/*
 * Salvamento na nuvem (Supabase): login e CRUD da tabela "projects".
 * Se o Supabase não estiver configurado, Cloud.enabled = false e o site
 * continua funcionando só com o armazenamento do navegador.
 */
(function (global) {
  'use strict';

  const cfg = global.APP_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseKey && global.supabase && global.supabase.createClient);
  const client = enabled ? global.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  const TABLE = 'projects';

  const redirectTo = () => global.location.origin + global.location.pathname;

  function check(res) {
    if (res.error) throw res.error;
    return res.data;
  }

  const Cloud = {
    enabled,
    loginGoogle: enabled && cfg.loginGoogle !== false,
    loginEmail: enabled && cfg.loginEmail !== false,

    onAuthChange(cb) {
      if (!client) return;
      client.auth.onAuthStateChange((event, session) => cb(session ? session.user : null, event));
    },

    // Formas de login ativadas no Supabase ({ google: true, email: true, ... }) ou null se não der para saber.
    async providers() {
      if (!enabled) return null;
      if (!this._providers) {
        this._providers = fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/auth/v1/settings', { headers: { apikey: cfg.supabaseKey } })
          .then((r) => r.json())
          .then((s) => s.external || null)
          .catch(() => null);
      }
      return this._providers;
    },

    async signInWithGoogle() {
      check(await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } }));
    },

    async signInWithEmail(email) {
      check(await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } }));
    },

    async signOut() {
      check(await client.auth.signOut());
    },

    // Todos os projetos da conta.
    async pullAll() {
      const all = [];
      for (let from = 0; ; from += 500) {
        const rows = check(await client.from(TABLE).select('id, name, data, updated_at').order('id').range(from, from + 499));
        all.push(...rows);
        if (rows.length < 500) return all;
      }
    },

    // Cria ou atualiza projetos: [{ id, name, data }]
    async push(rows) {
      for (let i = 0; i < rows.length; i += 50) {
        check(await client.from(TABLE).upsert(rows.slice(i, i + 50)));
      }
    },

    async remove(id) {
      check(await client.from(TABLE).delete().eq('id', id));
    },
  };

  global.Cloud = Cloud;
})(window);
