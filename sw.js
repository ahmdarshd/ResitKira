const CACHE_NAME = "resitkira-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./db.js",
  "./gemini.js",
  "./offline-engine.js",
  "./lhdn-data.js",
  "./tax-brackets.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      // If Tesseract CDN isn't reachable at install time, still cache the local shell.
      return caches.open(CACHE_NAME).then((cache) =>
        cache.addAll(APP_SHELL.filter((u) => !u.startsWith("http")))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for app shell + Tesseract assets; network-first (with cache fallback)
// for everything else (e.g. Gemini calls are never intercepted here — the fetch
// used for those goes through app.js directly and this fetch handler only sees
// same-origin/document requests plus the Tesseract CDN).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && (req.url.startsWith(self.location.origin) || req.url.includes("cdnjs.cloudflare.com"))) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
