self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("mts-lbmp-shell-v1").then((cache) => cache.addAll(["/", "/app", "/manifest.json", "/icon.svg"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== "mts-lbmp-shell-v1").map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api") || url.port === "4100") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open("mts-lbmp-shell-v1").then((cache) => cache.put("/app", copy));
          return response;
        })
        .catch(() => caches.match("/app").then((response) => response || caches.match("/")))
    );
    return;
  }

  if (url.origin === self.location.origin && (url.pathname.startsWith("/_next/") || url.pathname === "/icon.svg" || url.pathname === "/manifest.json")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open("mts-lbmp-shell-v1").then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
