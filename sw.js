const CACHE = 'emotion-escape-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/main.js',
  './src/mood.js',
  './src/mood-mediapipe.js',
  './src/audio.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
