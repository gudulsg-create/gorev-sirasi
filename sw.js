// Basit service worker: önce ağ, ağ yoksa son kaydedilen sürüm.
// Böylece güncellemeler hemen gelir; internet yokken uygulama boş sayfa yerine açılır.
const CACHE = 'gorev-sirasi-v4';
const SHELL = ['./', './index.html', './css/style.css', './js/app.js', './js/backend.js', './js/rotation.js', './js/swipe.js', './js/firebase-config.js', './manifest.webmanifest', './icons/icon-192.png'];

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
  // Kendi dosyalarımızda tarayıcı önbelleğini atla (her açılışta güncel sürümü kontrol et).
  e.respondWith(
    fetch(own ? new Request(req, { cache: 'no-cache' }) : req)
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

// ---------------- Bildirimler ----------------
self.addEventListener('push', (e) => {
  let d = {};
  try {
    const p = e.data ? e.data.json() : {};
    d = p.data || p.notification || p;
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  const title = d.title || 'Görev Sırası';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: d.url || self.registration.scope },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        try { await w.navigate(url); } catch { /* yoksay */ }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
