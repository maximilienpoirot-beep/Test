// Service worker : l'app fonctionne hors ligne avec les dernières données consultées.
const VERSION = "meteo-v1";
const SHELL = [
  "./", "index.html", "css/style.css", "js/app.js", "js/sky.js", "js/charts.js",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "manifest.webmanifest", "icons/icon.svg",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Données météo : réseau d'abord, cache en secours (mode hors ligne)
  if (/open-meteo\.com$/.test(url.hostname)) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req)));
    return;
  }

  // Fichiers de l'app : cache immédiat, mise à jour en arrière-plan
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    }));
  }
});
