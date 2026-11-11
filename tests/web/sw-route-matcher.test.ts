import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

/**
 * Phase 4 PR 3 — A1 service-worker route correctness.
 *
 * The matcher under test is the exact file the service worker loads via
 * importScripts (apps/web/public/sw-route-matcher.js, UMD), so the routing
 * decision verified here is the one that runs on the tablet — not a copy.
 * The bug being fixed: the old worker served the staff /app shell for
 * every offline navigation, so a wall-QR scan on an offline phone landed
 * in the staff app instead of the public intake form.
 */

type NavigationFallback = { kind: "intake" | "app" | "offline"; shellKey: string };
type SwRoutes = {
  INTAKE_SHELL_KEY: string;
  APP_SHELL_KEY: string;
  OFFLINE_PAGE_KEY: string;
  navigationFallback: (pathname: string) => NavigationFallback;
  isIntakePath: (pathname: string) => boolean;
};

const require = createRequire(import.meta.url);
// The repo root is "type": "module", so under Node the file's CommonJS
// branch is inert — but the UMD wrapper also publishes the API on the
// global object, which is exactly how the service worker reads it
// (self.MtsSwRoutes). Load for the side effect, then read the global.
require("../../apps/web/public/sw-route-matcher.js");
const routes = (globalThis as { MtsSwRoutes?: SwRoutes }).MtsSwRoutes as SwRoutes;

describe("A1 — SW navigation fallback routing", () => {
  test("wall-QR intake routes fall back to the intake shell", () => {
    expect(routes.navigationFallback("/intake/main-warehouse")).toEqual({ kind: "intake", shellKey: "/intake-shell" });
    expect(routes.navigationFallback("/intake/daet-branch")).toEqual({ kind: "intake", shellKey: "/intake-shell" });
    expect(routes.navigationFallback("/intake")).toEqual({ kind: "intake", shellKey: "/intake-shell" });
  });

  test("staff routes fall back to the staff app shell", () => {
    expect(routes.navigationFallback("/")).toEqual({ kind: "app", shellKey: "/app" });
    expect(routes.navigationFallback("/app")).toEqual({ kind: "app", shellKey: "/app" });
    expect(routes.navigationFallback("/app/trips")).toEqual({ kind: "app", shellKey: "/app" });
  });

  test("unknown routes get the honest offline page, never another app", () => {
    expect(routes.navigationFallback("/tracking")).toEqual({ kind: "offline", shellKey: "/offline.html" });
    expect(routes.navigationFallback("/some/unvisited/page")).toEqual({ kind: "offline", shellKey: "/offline.html" });
  });

  test("lookalike prefixes do not leak into the wrong shell", () => {
    // "/intakeville" is not an intake route; "/apple" is not the staff app.
    expect(routes.navigationFallback("/intakeville").kind).toBe("offline");
    expect(routes.navigationFallback("/apple").kind).toBe("offline");
  });

  test("isIntakePath matches the fallback decision", () => {
    expect(routes.isIntakePath("/intake/main-warehouse")).toBe(true);
    expect(routes.isIntakePath("/app")).toBe(false);
    expect(routes.isIntakePath("/tracking")).toBe(false);
  });

  test("empty path is treated as the staff root", () => {
    expect(routes.navigationFallback("").kind).toBe("app");
  });
});
