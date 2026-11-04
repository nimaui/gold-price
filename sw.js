importScripts('shared.js');

const VERSION = 'gold-v13';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'shared.js', 'vendor/gsap.min.js', 'manifest.webmanifest',
  'fonts/IRANSansXFaNum-Regular.woff2', 'fonts/IRANSansXFaNum-Medium.woff2',
  'assets/trend-up.svg', 'assets/arrow-up.svg', 'assets/arrow-down.svg', 'icons/icon-192.png', 'favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== 'gold-state').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// App shell. Price APIs are never cached here.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/__')) return;
  // Network first so updates show on the very next open; cache only when offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});

// Chrome/Android installed PWAs only; the browser decides the real timing.
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'gold-check') e.waitUntil(Gold.check(self.registration).catch(() => {}));
});

// Web Push from the GitHub Actions job: works even when the app is closed (iOS 16.4+ home-screen apps).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'قیمت طلا', {
    body: d.body || '', tag: d.tag || 'gold', renotify: true, dir: 'rtl', lang: 'fa',
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) =>
    cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
