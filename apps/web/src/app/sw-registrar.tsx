"use client";

import { useEffect } from "react";

/**
 * Phase 4 A1: the service worker is registered from the root layout so
 * every route gets it — including the public wall-QR intake pages, which do
 * not mount the staff app shell. Registration used to live inside
 * app-shell.tsx, so a phone whose first-ever visit was the intake URL never
 * installed the worker and had no offline fallback at all.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app still works without shell caching; operational cache is handled separately.
    });
  }, []);

  return null;
}
