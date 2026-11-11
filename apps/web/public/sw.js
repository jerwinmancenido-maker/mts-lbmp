importScripts("/sw-route-matcher.js");

var CACHE_NAME = "mts-lbmp-shell-v1";
var ROUTES = self.MtsSwRoutes;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(["/", "/app", "/manifest.json", "/icon.svg", ROUTES.OFFLINE_PAGE_KEY]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
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
          if (response.ok) {
            const copy = response.clone();
            const intakeCopy = ROUTES.isIntakePath(url.pathname) ? response.clone() : null;
            caches.open(CACHE_NAME).then((cache) => {
              // Cache the page under its own URL so a later offline visit to
              // the same route serves the right document. Intake pages also
              // refresh the shared intake shell, which covers warehouses
              // whose exact URL was never visited on this device.
              cache.put(request, copy);
              if (intakeCopy) cache.put(ROUTES.INTAKE_SHELL_KEY, intakeCopy);
            });
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          // Exact page first: a route visited online loads as itself.
          const exact = await cache.match(request, { ignoreSearch: true });
          if (exact) return exact;
          // Route-correct shell: intake routes get the intake shell, staff
          // routes get the staff app, and anything else gets the honest
          // offline page — never the wrong application.
          const fallback = ROUTES.navigationFallback(url.pathname);
          const shell = await cache.match(fallback.shellKey);
          if (shell) return shell;
          const offline = await cache.match(ROUTES.OFFLINE_PAGE_KEY);
          if (offline) return offline;
          return cache.match(ROUTES.APP_SHELL_KEY);
        })
    );
    return;
  }

  if (url.origin === self.location.origin && (url.pathname.startsWith("/_next/") || url.pathname === "/icon.svg" || url.pathname === "/manifest.json")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
