/*
 * Phase 4 A1: navigation fallback routing for the service worker.
 *
 * Plain script (no modules) so sw.js can load it with importScripts, and
 * UMD-shaped so the unit tests can require the exact same file the worker
 * runs — the routing decision is never duplicated.
 *
 * Fallback kinds:
 * - "intake": the public wall-QR intake routes (/intake/<warehouse>). These
 *   must never fall back to the staff app — a drop-off customer scanning the
 *   warehouse QR code offline needs the intake form's own cached shell.
 * - "app": the staff app shell (/ and /app).
 * - "offline": anything else gets the honest offline page instead of the
 *   wrong application.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.MtsSwRoutes = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  var INTAKE_SHELL_KEY = "/intake-shell";
  var APP_SHELL_KEY = "/app";
  var OFFLINE_PAGE_KEY = "/offline.html";

  function navigationFallback(pathname) {
    var path = typeof pathname === "string" && pathname ? pathname : "/";
    if (path === "/intake" || path.indexOf("/intake/") === 0) {
      return { kind: "intake", shellKey: INTAKE_SHELL_KEY };
    }
    if (path === "/" || path === "/app" || path.indexOf("/app/") === 0) {
      return { kind: "app", shellKey: APP_SHELL_KEY };
    }
    return { kind: "offline", shellKey: OFFLINE_PAGE_KEY };
  }

  function isIntakePath(pathname) {
    return navigationFallback(pathname).kind === "intake";
  }

  return {
    INTAKE_SHELL_KEY: INTAKE_SHELL_KEY,
    APP_SHELL_KEY: APP_SHELL_KEY,
    OFFLINE_PAGE_KEY: OFFLINE_PAGE_KEY,
    navigationFallback: navigationFallback,
    isIntakePath: isIntakePath
  };
});
