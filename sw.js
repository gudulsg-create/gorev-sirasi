// Basit service worker: önce ağ, ağ yoksa son kaydedilen sürüm.
// Böylece güncellemeler hemen gelir; internet yokken uygulama boş sayfa yerine açılır.
const CACHE = 'gorev-sirasi-v1';
const SHELL = ['./', './index.html', './css/style.css', './js/app.js', './js/backend.js', './js/rotation.js', './js/firebase-config.js', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Yalnızca kendi dosyalarımız ve Firebase SDK dosyaları; Firestore bağlantılarına dokunma.
  const own = url.origin === self.location.origin;
  const sdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (!own && !sdk) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
