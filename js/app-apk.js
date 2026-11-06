/*
 * Botões com o atributo data-app-apk.
 * No site: baixam o app Android (.apk). No iPhone ficam escondidos, porque APK não instala lá.
 * Dentro do app: viram "Atualizar" e procuram uma versão nova do app. Se não houver,
 * recarregam a página para trazer as novidades do site.
 * Na tag <script>: data-repo (repositório no GitHub) e data-apk (nome do arquivo na Release).
 * O valor de data-app-apk, se houver, é o texto do botão dentro do app.
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
