/*
 * Service worker: faz o app abrir e funcionar sem internet.
 *
 * - Arquivos do próprio site: tenta a rede primeiro (para pegar a versão mais
 *   nova depois de cada publicação) e usa a cópia guardada quando está offline.
 * - Fontes e biblioteca do Supabase (CDN): usa a cópia guardada; se não houver, baixa.
 * - Login e banco de dados do Supabase nunca são guardados: passam direto.
 *
 * Ao mudar a lista de arquivos, aumente a versão para limpar o cache antigo.
 */
const VERSION = 'v11';
const CACHE = `cortes-${VERSION}`;

const APP_FILES = [
  './',
  'index.html',
  'privacidade.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/config.js',
  'js/cloud.js',
  'js/projects.js',
  'js/optimizer.js',
  'js/storage.js',
  'js/render.js',
  'js/pdf.js',
  'js/app.js',
  'js/theme.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'exemplos/guarda-roupa-4-portas-4-gavetas.json',
];

const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap',
];

const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_FILES);
    // Arquivos externos: se algum falhar, o app continua instalável.
    await Promise.all(CDN_FILES.map((url) => cache.add(new Request(url, { mode: 'cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('cortes-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isCacheableCdn(url) {
  return url.hostname === 'fonts.googleapis.com'
    || url.hostname === 'fonts.gstatic.com'
    || url.hostname === 'cdn.jsdelivr.net'
    || url.hostname === 'cdnjs.cloudflare.com';
}

// Rede primeiro, com limite de tempo; sem rede, usa o cache.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // "no-cache": confere com o servidor, para nunca misturar HTML novo com CSS/JS antigos.
    const response = await Promise.race([
      fetch(request, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT)),
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

// Cache primeiro (arquivos externos com versão fixa).
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (isCacheableCdn(url)) {
    event.respondWith(cacheFirst(request));
  }
  // Demais endereços (Supabase etc.) seguem direto para a rede.
});
