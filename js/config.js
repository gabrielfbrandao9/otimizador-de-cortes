/*
 * Configuração do Supabase (salvar projetos na nuvem). Veja SUPABASE.md.
 *
 * Deixe supabaseUrl/supabaseKey vazios para usar o site só com salvamento
 * no navegador.
 *
 * A chave "anon" (ou "publishable") é pública por natureza e pode ficar no
 * GitHub: quem protege os dados são as regras de segurança (RLS) criadas
 * pelo arquivo supabase/schema.sql. NUNCA coloque aqui a chave "service_role"
 * ou "secret".
 */
window.APP_CONFIG = {
  supabaseUrl: '',   // ex.: 'https://abcdefghijklm.supabase.co'
  supabaseKey: '',   // chave anon/publishable

  // Formas de login exibidas na tela "Entrar"
  loginGoogle: true, // exige configurar o Google no Supabase (passo 5 do SUPABASE.md)
  loginEmail: true,  // link mágico por e-mail, já vem ativado no Supabase
};
