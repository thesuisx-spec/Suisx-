// Service worker: app shell offline, dictionary responses cached for words you have already opened.
const VERSION = 'lex-v2';
const SHELL = ['./', './index.html', './styles.css', './app.js', './icon.svg', './manifest.webmanifest'];
const API_HOSTS = ['api.dictionaryapi.dev', 'en.wiktionary.org', 'api.datamuse.com'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (API_HOSTS.includes(url.hostname)) {
    // Network first, fall back to the last saved answer when offline.
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok || res.status === 404) {
          const copy = res.clone();
          caches.open(VERSION + '-api').then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }

  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION + '-fonts').then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Stale-while-revalidate for the shell.
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
