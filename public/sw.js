/* TapIn kiosk service worker: lets the gate kiosk open with no internet (after one online visit).
   Scope: /kiosk only. API calls (/api/*) are never cached — taps go through the kiosk's own offline queue. */
const VERSION = "tapin-kiosk-v1";
const SHELL = ["/kiosk", "/manifest.webmanifest", "/icon.svg", "/pwa-icon/192", "/pwa-icon/512"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // The kiosk page: fresh from the network when possible, the saved copy when not.
  if (req.mode === "navigate") {
    event.respondWith(
      Promise.race([fetch(req), timeout(5000)])
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put("/kiosk", res.clone()));
          return res;
        })
        .catch(() => caches.match("/kiosk")),
    );
    return;
  }

  // App code, fonts and icons never change under the same name: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa-icon/") || url.pathname === "/icon.svg") {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
