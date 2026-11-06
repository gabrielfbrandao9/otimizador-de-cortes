/*
 * Botões com o atributo data-app-apk.
 * No site: baixam o app Android (.apk). No iPhone ficam escondidos, porque APK não instala lá.
 * Dentro do app: viram "Atualizar" e procuram uma versão nova do app. Se não houver,
 * recarregam a página para trazer as novidades do site.
 * Na tag <script>: data-repo (repositório no GitHub) e data-apk (nome do arquivo na Release).
 * O valor de data-app-apk, se houver, é o texto do botão dentro do app.
 *
 * Dentro do app, link para a página inicial de outro site abre o app dele. Se não estiver
 * instalado, oferece baixar. Usa o endereço de retorno do login que todo app já responde,
 * por isso funciona sem APK novo.
 */
(function () {
  'use strict';

  const script = document.currentScript;
  const BASE = 'https://github.com/gabrielfbrandao9/' + script.dataset.repo;
  const DOWNLOAD = BASE + '/releases/latest/download/' + script.dataset.apk;
  const API = 'https://api.github.com/repos/gabrielfbrandao9/' + script.dataset.repo + '/releases/latest';

  const A = window.Android;
  const noApp = !!(A && A.versao);
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function preparar() {
    document.querySelectorAll('[data-app-apk]:not([data-apk-pronto])').forEach((b) => {
      b.setAttribute('data-apk-pronto', noApp ? 'app' : 'site');
      b.title = noApp ? 'Procurar versão nova do app' : 'Baixar o app para Android (.apk)';
      if (noApp) b.textContent = b.dataset.appApk || 'Atualizar';
      b.hidden = !noApp && iphone;
    });
  }

  function maisNova(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  async function atualizar(botao) {
    const texto = botao.textContent;
    botao.disabled = true;
    botao.textContent = 'Verificando…';
    try {
      const r = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const dados = await r.json();
      const nova = String(dados.tag_name || '').replace(/^v/i, '');
      const atual = String(A.versao());
      if (nova && maisNova(nova, atual)) {
        const baixar = confirm(`Versão ${nova} do app disponível (você tem a ${atual}).\n\nBaixar agora? Depois é só tocar em Instalar: seus dados continuam.`);
        if (baixar) A.abrirNavegador(DOWNLOAD);
      } else {
        alert(`Você já está na versão mais recente do app (${atual}).`);
        location.reload(); // traz as novidades do site
      }
    } catch (e) {
      alert('Não deu para procurar atualização agora. Confira a internet e tente de novo.');
    } finally {
      botao.disabled = false;
      botao.textContent = texto;
    }
  }

  // ---------- Abrir o app de outro site ----------

  const APPS = {
    'biblioteca-de-jogos': { id: 'jogos', nome: 'Jogos', apk: 'BibliotecaDeJogos.apk' },
    'calculadora-racao': { id: 'racao', nome: 'Ração', apk: 'CalculadoraRacao.apk' },
    'cobrinha-neon': { id: 'cobrinha', nome: 'Cobrinha', apk: 'CobrinhaNeon.apk' },
    'controle-financas': { id: 'financas', nome: 'Finanças', apk: 'MinhasFinancas.apk' },
    'controle-porcos': { id: 'porcos', nome: 'Porcos', apk: 'ControlePorcos.apk' },
    'orcamento-marcenaria': { id: 'orcamentos', nome: 'Orçamentos', apk: 'OrcamentoMarcenaria.apk' },
    'otimizador-de-cortes': { id: 'cortes', nome: 'Cortes', apk: 'OtimizadorDeCortes.apk' },
  };

  function appDoLink(link) {
    let u;
    try { u = new URL(link.href); } catch (e) { return null; }
    if (u.origin !== 'https://gabrielfbrandao9.github.io' || u.search || u.hash) return null;
    const repo = (u.pathname.match(/^\/([^/]+)\/?$/) || [])[1];
    if (!repo || repo === script.dataset.repo || !APPS[repo]) return null;
    return Object.assign({ repo }, APPS[repo]);
  }

  function abrirOutroApp(app) {
    let saiu = false;
    const marcar = () => { saiu = true; };
    window.addEventListener('blur', marcar);
    window.addEventListener('pagehide', marcar);
    document.addEventListener('visibilitychange', marcar);

    const link = document.createElement('a');
    link.href = `com.gabrielfbrandao.${app.id}://login`;
    link.click();

    // Se o outro app abriu, este sai da frente; se continuou aqui, ele não está instalado
    setTimeout(() => {
      window.removeEventListener('blur', marcar);
      window.removeEventListener('pagehide', marcar);
      document.removeEventListener('visibilitychange', marcar);
      if (saiu || document.visibilityState !== 'visible') return;
      if (confirm(`O app ${app.nome} não está instalado neste celular.\n\nBaixar agora?`)) {
        A.abrirNavegador(`https://github.com/gabrielfbrandao9/${app.repo}/releases/latest/download/${app.apk}`);
      }
    }, 1800);
  }

  if (noApp) {
    document.addEventListener('click', (e) => {
      const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      const app = link && appDoLink(link);
      if (!app) return;
      e.preventDefault();
      e.stopPropagation();
      abrirOutroApp(app);
    }, true);
  }

  // ---------- Botão do app ----------

  document.addEventListener('click', (e) => {
    const botao = e.target && e.target.closest ? e.target.closest('[data-app-apk]') : null;
    if (!botao) return;
    e.preventDefault();
    if (noApp) atualizar(botao);
    else location.href = DOWNLOAD;
  });

  // Algumas telas criam o botão depois (Ajustes)
  preparar();
  new MutationObserver(preparar).observe(document.documentElement, { childList: true, subtree: true });
})();
