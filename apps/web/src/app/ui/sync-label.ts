/**
 * Header sync label derivation (extracted from app-shell.tsx in the
 * Round 2 fix loop so the derivation is unit-testable — the same
 * reason status-tone.ts was extracted in PR-12, dashboard-tiles.ts in
 * PR-11, and search-overlay.ts in PR-53).
 *
 * The defect (Round 1 C-F5, carried into Round 2 as R2-07 / C2R-F1):
 * the header pill read "Synced 9:49 AM" at the same moment the status
 * line under it read "Cached 9:49 AM / Syncing" — same timestamp,
 * opposite claims, visible across the seeded screens. Criteria Part C
 * #5 (offline honesty) is the governing rule: a contradiction teaches
 * field staff to ignore both pills.
 *
 * Root cause, in the header's own inputs (the status line's text is
 * written at load start and was the truthful side during a load):
 *
 * 1. One shared `syncState` was driven by every load flow at once —
 *    the shell's bootstrap refresh() and the per-module
 *    refreshCurrentTabData() overlap on sign-in and tab switches, and
 *    whichever finished first set "Online" and erased the other's
 *    in-flight state. The header then claimed "Synced" while the
 *    module fetch was still running.
 * 2. The old label chain had no branch for the drains' "Syncing"
 *    state at all: processOfflineQueue / processQueuedPhotos set it,
 *    the tone class honoured it, but the label text fell through to
 *    `Synced <time>` — a completion claim during an active drain.
 *
 * The fix: the derivation takes `loadsInFlight` — a count each load
 * flow (shell refresh, module load, queue drain) increments on entry
 * and decrements on exit, so no flow's completion can erase another
 * flow's activity — and any in-flight activity, or the "Refreshing" /
 * "Syncing" states, yields the in-flight label. "Synced <time>" is
 * reachable only when nothing is running, the queue is empty, and no
 * failure/offline state holds. The queue's pending count keeps first
 * place, exactly as before: a non-empty queue is the one claim that
 * outranks even an active sync.
 */

export type SyncState = "Online" | "Refreshing" | "Cached" | "Offline" | "Pending sync" | "Sync failed" | "Syncing";

export interface SyncHeaderInput {
  /** Queued actions + photos not yet synced (Pending, Failed or Syncing records). */
  pendingSyncCount: number;
  syncState: SyncState;
  /** Load flows running right now (shell refresh, module load, queue drain). */
  loadsInFlight: number;
  /** Preformatted time of the last completed shell refresh, "" if none. */
  lastSyncedAt: string;
  /** Preformatted time of the cached snapshot being shown, "" if none. */
  lastCachedAt: string;
}

export interface SyncHeader {
  label: string;
  /** Modifier class for .syncPill / .mobileSyncLine: "pending" | "offline" | "cached" | "syncing" | "". */
  toneClass: string;
}

export function deriveSyncHeader(input: SyncHeaderInput): SyncHeader {
  const { pendingSyncCount, syncState, loadsInFlight, lastSyncedAt, lastCachedAt } = input;
  if (pendingSyncCount > 0) {
    return { label: `Needs Sync: ${pendingSyncCount}`, toneClass: "pending" };
  }
  if (syncState === "Offline") {
    return { label: "Offline", toneClass: "offline" };
  }
  if (syncState === "Sync failed") {
    return { label: "Sync failed", toneClass: "offline" };
  }
  if (loadsInFlight > 0 || syncState === "Refreshing" || syncState === "Syncing") {
    return { label: "Syncing", toneClass: "syncing" };
  }
  if (syncState === "Cached") {
    return { label: `Cached${lastCachedAt ? ` ${lastCachedAt}` : ""}`, toneClass: "cached" };
  }
  if (lastSyncedAt) {
    return { label: `Synced ${lastSyncedAt}`, toneClass: "" };
  }
  return { label: "Online", toneClass: "" };
}
