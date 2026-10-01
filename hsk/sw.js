// Service worker: приложение и данные работают без интернета после первого открытия;
// записи произношения (Wikimedia Commons, Tatoeba) сохраняются, когда их однажды прослушали.
const VERSION = 'hsk-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './icon.svg', './manifest.webmanifest',
  './lib/hanzi-writer.min.js', './data/words.js', './data/grammar.js', './data/syllables.js'];
const AUDIO_HOSTS = ['upload.wikimedia.org', 'audio.tatoeba.org'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hsk-') && !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (AUDIO_HOSTS.includes(url.hostname)) {
    // Записи не меняются: сначала кэш, потом сеть.
    e.respondWith(
      caches.open(VERSION + '-audio').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/strokes/')) {
    e.respondWith(
      caches.open(VERSION + '-strokes').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  // Остальное: из кэша сразу, в фоне обновить.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
