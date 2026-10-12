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

    async signInWithGoogle() {
      check(await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } }));
    },

    async signInWithEmail(email) {
      check(await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } }));
    },

    async signOut() {
      check(await client.auth.signOut());
    },

    async list() {
      return check(await client.from(TABLE).select('id, name, updated_at').order('updated_at', { ascending: false }));
    },

    async load(id) {
      return check(await client.from(TABLE).select('id, name, data').eq('id', id).single());
    },

    // Atualiza o projeto se ele existir (e for da pessoa); senão cria um novo. Retorna o id.
    async save(id, name, data) {
      if (id) {
        const rows = check(await client.from(TABLE).update({ name, data }).eq('id', id).select('id'));
        if (rows.length) return rows[0].id;
      }
      return check(await client.from(TABLE).insert({ name, data }).select('id').single()).id;
    },

    async remove(id) {
      check(await client.from(TABLE).delete().eq('id', id));
    },
  };

  global.Cloud = Cloud;
})(window);
