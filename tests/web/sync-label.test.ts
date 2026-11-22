import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { deriveSyncHeader, type SyncHeaderInput } from "../../apps/web/src/app/ui/sync-label";

/**
 * Round 2 fix loop — R2-07 (filed Round 1 as C-F5, re-evidenced in
 * Round 2 as C2R-F1): the header sync pill read "Synced 9:49 AM" at
 * the same moment the status line under it read "Cached 9:49 AM /
 * Syncing". The header was the stale side during a load: the shell
 * refresh and the per-module load drove one shared syncState, and
 * whichever finished first erased the other's in-flight state; and
 * the old label chain had no branch for the queue drain's "Syncing"
 * state, falling through to "Synced <time>" mid-drain.
 *
 * The derivation pinned here takes an in-flight count (each load flow
 * counts only itself) and must never produce a "Synced" claim while
 * anything is running or the queue is non-empty.
 */

const base: SyncHeaderInput = {
  pendingSyncCount: 0,
  syncState: "Online",
  loadsInFlight: 0,
  lastSyncedAt: "9:49 AM",
  lastCachedAt: "9:49 AM"
};

describe("deriveSyncHeader — the header never claims Synced mid-sync (R2-07)", () => {
  test("the filed case: shell refresh done, module load still running — Syncing, not Synced", () => {
    // syncState already reads "Online" and lastSyncedAt is stamped
    // (the shell refresh finished), but a module load is in flight.
    // The pre-fix chain answered "Synced 9:49 AM" here.
    expect(deriveSyncHeader({ ...base, loadsInFlight: 1 })).toEqual({ label: "Syncing", toneClass: "syncing" });
  });

  test("a drain in flight reads Syncing under its own state", () => {
    // processOfflineQueue / processQueuedPhotos set syncState
    // "Syncing"; the pre-fix label chain had no branch for it and
    // fell through to "Synced <time>" while the drain ran.
    expect(deriveSyncHeader({ ...base, syncState: "Syncing", loadsInFlight: 1 })).toEqual({ label: "Syncing", toneClass: "syncing" });
    expect(deriveSyncHeader({ ...base, syncState: "Syncing", loadsInFlight: 0 })).toEqual({ label: "Syncing", toneClass: "syncing" });
  });

  test("a load painting from cache is Syncing while it runs, Cached once settled", () => {
    expect(deriveSyncHeader({ ...base, syncState: "Cached", loadsInFlight: 1 })).toEqual({ label: "Syncing", toneClass: "syncing" });
    expect(deriveSyncHeader({ ...base, syncState: "Cached", loadsInFlight: 0 })).toEqual({ label: "Cached 9:49 AM", toneClass: "cached" });
    expect(deriveSyncHeader({ ...base, syncState: "Cached", loadsInFlight: 0, lastCachedAt: "" })).toEqual({ label: "Cached", toneClass: "cached" });
  });

  test("the Refreshing state is the in-flight label, count or not", () => {
    expect(deriveSyncHeader({ ...base, syncState: "Refreshing" })).toEqual({ label: "Syncing", toneClass: "syncing" });
  });

  test("a non-empty queue outranks every other claim, including an active sync", () => {
    expect(deriveSyncHeader({ ...base, pendingSyncCount: 3 })).toEqual({ label: "Needs Sync: 3", toneClass: "pending" });
    expect(deriveSyncHeader({ ...base, pendingSyncCount: 3, loadsInFlight: 1, syncState: "Syncing" })).toEqual({
      label: "Needs Sync: 3",
      toneClass: "pending"
    });
  });

  test("offline and failure states keep their labels and the offline tone", () => {
    expect(deriveSyncHeader({ ...base, syncState: "Offline" })).toEqual({ label: "Offline", toneClass: "offline" });
    expect(deriveSyncHeader({ ...base, syncState: "Sync failed" })).toEqual({ label: "Sync failed", toneClass: "offline" });
  });

  test("settled and idle is the only road to Synced", () => {
    expect(deriveSyncHeader(base)).toEqual({ label: "Synced 9:49 AM", toneClass: "" });
    expect(deriveSyncHeader({ ...base, lastSyncedAt: "" })).toEqual({ label: "Online", toneClass: "" });
    // The photo-queued "Pending sync" state keeps its pre-fix
    // fall-through when the count has not landed yet.
    expect(deriveSyncHeader({ ...base, syncState: "Pending sync" })).toEqual({ label: "Synced 9:49 AM", toneClass: "" });
  });
});

describe("app shell wiring (R2-07)", () => {
  const shell = readFileSync(new URL("../../apps/web/src/app/ui/app-shell.tsx", import.meta.url), "utf8");

  test("the header derives from sync-label.ts, fed by the in-flight count", () => {
    expect(shell).toContain('from "./sync-label"');
    expect(shell).toContain("deriveSyncHeader({");
    expect(shell).toContain("loadsInFlight: syncLoadsInFlight");
    // The old inline chain — the one with no "Syncing" branch — is gone.
    expect(shell).not.toContain("const syncLabel = pendingSyncCount > 0");
  });

  test("every load flow counts itself in flight", () => {
    // Shell refresh and module load wrap their inner loads; the queue
    // drain counts itself at its effect call site.
    expect(shell).toContain("await loadShellData();");
    expect(shell).toContain("await loadCurrentTabData(tab);");
    expect(shell).toContain(".finally(endSyncActivity)");
    expect(shell.match(/beginSyncActivity\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(shell.match(/endSyncActivity\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test("a photo-only drain cannot leave the Syncing state stuck", () => {
    // processOfflineQueue's empty-queue return lands on a terminal
    // state — processQueuedPhotos set "Syncing" and nothing else runs
    // on that path to clear it.
    expect(shell).toContain('setSyncState(waiting.length ? "Sync failed" : "Online")');
  });
});
