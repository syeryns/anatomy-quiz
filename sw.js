const SHELL_CACHE = 'anatomy-quiz-shell-v6';
const RUNTIME_CACHE = 'anatomy-quiz-runtime-v5';

const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './ocr.js',
  './editor.js',
  './quiz.js',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isRuntimeCacheable(url) {
  return (
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('unpkg.com') ||
    url.pathname.endsWith('.traineddata') ||
    url.pathname.endsWith('.traineddata.gz') ||
    url.pathname.endsWith('.wasm') ||
    url.pathname.includes('tesseract')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isRuntimeCacheable(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const response = await fetch(req);
        if (response && response.ok) cache.put(req, response.clone());
        return response;
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
