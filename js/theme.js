/*
 * Botão de tema claro/escuro.
 * Sem escolha salva, o site segue o tema do sistema; depois de clicar,
 * a escolha fica guardada neste aparelho.
 */
(function () {
  'use strict';

  const KEY = 'otimizador:tema';
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const btn = document.getElementById('btnTheme');

  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches);

  function sync() {
    const dark = isDark();
    root.classList.toggle('theme-dark', dark);
    if (!btn) return;
    const label = dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  if (btn) {
    btn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch (e) { /* sem armazenamento */ }
      sync();
    });
  }
  systemDark.addEventListener('change', sync);
  sync();
})();
