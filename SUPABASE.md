# Configurar o salvamento na nuvem (Supabase)

Com isso, quem usa o site pode **entrar com Google ou e-mail** e ter os projetos salvos online,
acessíveis de qualquer computador ou celular. Cada pessoa só vê os próprios projetos.

O plano gratuito do Supabase é suficiente. Sem esta configuração o site continua funcionando,
só que com salvamento apenas no navegador.

---

## 1. Criar o projeto no Supabase

1. Crie uma conta em <https://supabase.com> (dá para entrar com o GitHub).
2. Clique em **New project**.
   - **Name**: `otimizador-de-cortes`
   - **Database password**: gere uma e guarde (não vai ser usada no site).
   - **Region**: *South America (São Paulo)*.
3. Espere uns 2 minutos até o projeto ficar pronto.

## 2. Criar a tabela de projetos

1. No menu lateral, abra **SQL Editor** → **New query**.
2. Copie todo o conteúdo do arquivo [`supabase/schema.sql`](supabase/schema.sql), cole e clique em **Run**.
3. Deve aparecer *Success. No rows returned*.

Esse script cria a tabela `projects` e as **regras de segurança (RLS)** que garantem que cada pessoa
só leia e altere os próprios projetos.

## 3. Ligar o site ao Supabase

1. Abra **Project Settings** (engrenagem) → **API Keys** (ou **Data API**, dependendo da versão do painel).
2. Copie:
   - a **Project URL**, algo como `https://abcdefghijklm.supabase.co`;
   - a chave **anon public** (aba *Legacy API keys*) ou a **publishable key** (`sb_publishable_...`).
3. Cole os dois em [`js/config.js`](js/config.js):

   ```js
   window.APP_CONFIG = {
     supabaseUrl: 'https://abcdefghijklm.supabase.co',
     supabaseKey: 'eyJhbGciOi...',
     loginGoogle: true,
     loginEmail: true,
   };
   ```

> **Pode publicar essa chave no GitHub?** Sim. A chave anon/publishable foi feita para ficar no
> navegador; quem protege os dados são as regras RLS do passo 2.
> **Nunca** use a chave `service_role` / `secret`: ela ignora as regras de segurança.

## 4. Informar os endereços do site

Em **Authentication** → **URL Configuration**:

- **Site URL**: `https://SEU-USUARIO.github.io/otimizador-de-cortes/`
- **Redirect URLs**: adicione
  - `https://SEU-USUARIO.github.io/otimizador-de-cortes/**`
  - `http://localhost:8765/**`, para testar no seu computador.

Sem isso, o link do e-mail e o login do Google não conseguem voltar para o site.

Pronto: **o login por e-mail já funciona**. A pessoa digita o e-mail, recebe um link e, ao clicar, entra no site.

## 5. (Opcional) Entrar com Google

Se não quiser configurar agora, coloque `loginGoogle: false` no `js/config.js` para esconder o botão.

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto.
2. Vá em **APIs e serviços** → **Tela de consentimento OAuth**:
   - tipo **Externo**;
   - preencha o nome do app ("Otimizador de Cortes") e seu e-mail;
   - salve e **publique** o app. Em modo "teste", só os e-mails cadastrados conseguem entrar.
3. Vá em **Credenciais** → **Criar credenciais** → **ID do cliente OAuth**:
   - tipo: **Aplicativo da Web**;
   - em **URIs de redirecionamento autorizados**, adicione o endereço que o Supabase mostra em
     *Authentication → Sign In / Providers → Google* ("Callback URL"), algo como
     `https://abcdefghijklm.supabase.co/auth/v1/callback`.
4. Copie o **ID do cliente** e a **Chave secreta do cliente**.
5. No Supabase, em **Authentication** → **Sign In / Providers** → **Google**: ative, cole os dois valores e salve.

## Coisas boas de saber

- **Projeto pausado**: no plano gratuito, o Supabase pausa o projeto depois de 1 semana sem nenhum acesso.
  Se isso acontecer, entre no painel e clique em **Restore**. Os dados não se perdem.
- **Limite de e-mails**: o envio de e-mail embutido do Supabase permite poucos e-mails por hora,
  o que serve para uso pessoal. Para muitos usuários, configure um SMTP próprio
  (*Authentication → Emails → SMTP Settings*, por exemplo com Resend ou Brevo) ou prefira o login com Google.
- **Ver os dados**: em **Table Editor** → `projects` aparecem todos os projetos salvos.
- **Excluir conta de alguém**: em **Authentication** → **Users**. Os projetos da pessoa são apagados junto.
