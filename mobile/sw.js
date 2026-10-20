// OSCAR Mobile : service worker.
// * Réseau d'abord pour l'application (HTML, JS) : une nouvelle version publiée s'applique à la prochaine ouverture.
// * Copie locale en secours : l'application s'ouvre même sans réseau (avec le dernier résumé enregistré).
// * Les appels au relais (Supabase) ne sont jamais mis en cache.
const CACHE = "oscar-mobile-v1";
const SHELL = ["./", "./index.html", "./app.js", "./oscar-crypto.js", "./manifest.webmanifest", "./icons/icon-256.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html"))),
  );
});
