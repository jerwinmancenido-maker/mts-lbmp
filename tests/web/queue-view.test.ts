import { describe, expect, test, vi } from "vitest";
import { selectSyncedQueueRecordsToPrune, type OfflineQueueRecord } from "../../apps/web/src/app/ui/cache";
import {
  OFFLINE_QUEUE_MAX_AUTO_ATTEMPTS,
  attemptQueueRecordSync,
  formatQueueAge,
  queueItemView,
  shouldAutoRetryQueueRecord,
  sortQueueItemViews
} from "../../apps/web/src/app/ui/queue-view";

/**
 * Phase 4 PR 3 — A7 queue visibility/housekeeping + A3 queued PATCH replay.
 *
 * The view-model derivation, the single-record sync attempt, and the prune
 * selection are pure seams (IndexedDB/HTTP injected), tested here with
 * plain records. The PATCH test is the queued-draft-update proof at the
 * seam the Device Setup Retry button and the replayer both call: one send
 * per attempt, always with the queue record's id as the idempotency key,
 * so a replay can never create a second draft version server-side (the
 * server half is covered by tests/api/draft-patch-idempotency.test.ts).
 */

let seq = 0;
function record(partial: Partial<OfflineQueueRecord>): OfflineQueueRecord {
  seq += 1;
  return {
    id: `queue_test_${seq}`,
    type: "payment",
    method: "POST",
    path: "/payments",
    body: {},
    createdAt: "2026-11-12T00:00:00.000Z",
    status: "Pending",
    attempts: 0,
    ...partial
  };
}

const NOW = new Date("2026-11-12T02:00:00.000Z");

describe("A7 — queue item view models", () => {
  test("payment shows label, DR/amount detail, age, and state", () => {
    const view = queueItemView(
      record({ type: "payment", path: "/payments", body: { customerDrNumber: "DR-9", amountPaid: 1250 }, createdAt: "2026-11-12T01:30:00.000Z" }),
      NOW
    );
    expect(view.label).toBe("Payment collection");
    expect(view.detail).toContain("DR-9");
    expect(view.detail).toContain("1,250");
    expect(view.ageLabel).toBe("30m ago");
    expect(view.statusLabel).toBe("Pending");
    expect(view.canRetry).toBe(true);
    expect(view.canDiscard).toBe(true);
  });

  test("queued receiving draft PATCH is labelled as a draft update", () => {
    const view = queueItemView(
      record({ type: "receivingDraft", method: "PATCH", path: "/receiving/drafts/draft_1", body: { customerDrNumber: "DR-5" } }),
      NOW
    );
    expect(view.label).toBe("Receiving draft update");
    expect(view.detail).toContain("DR-5");
    const created = queueItemView(record({ type: "receivingDraft", method: "POST", path: "/receiving/drafts" }), NOW);
    expect(created.label).toBe("Receiving draft (new)");
  });

  test("delivery and return paths get distinct labels", () => {
    expect(queueItemView(record({ type: "delivery", path: "/deliveries/complete" }), NOW).label).toBe("Delivery completed");
    expect(queueItemView(record({ type: "delivery", path: "/deliveries/fail" }), NOW).label).toBe("Delivery failed attempt");
    expect(queueItemView(record({ type: "delivery", path: "/returns" }), NOW).label).toBe("Return record");
    expect(queueItemView(record({ type: "photo", path: "/receiving/x/dr-photo" }), NOW).label).toBe("DR photo attachment");
  });

  test("failed items surface their last error; parked items are flagged", () => {
    const failed = queueItemView(record({ status: "Failed", attempts: 2, lastError: "Network request failed" }), NOW);
    expect(failed.statusLabel).toBe("Failed");
    expect(failed.lastError).toBe("Network request failed");
    expect(failed.parked).toBe(false);

    const parked = queueItemView(record({ status: "Failed", attempts: OFFLINE_QUEUE_MAX_AUTO_ATTEMPTS, lastError: "400 Bad Request" }), NOW);
    expect(parked.statusLabel).toBe("Failed — needs attention");
    expect(parked.parked).toBe(true);
    expect(parked.canRetry).toBe(true); // manual retry stays available
  });

  test("failed items sort ahead of pending ones", () => {
    const views = sortQueueItemViews([
      queueItemView(record({ status: "Pending", createdAt: "2026-11-12T00:00:00.000Z" }), NOW),
      queueItemView(record({ status: "Failed", createdAt: "2026-11-12T01:00:00.000Z" }), NOW)
    ]);
    expect(views[0].status).toBe("Failed");
    expect(views[1].status).toBe("Pending");
  });

  test("age formatting covers minutes, hours, and days", () => {
    expect(formatQueueAge("2026-11-12T01:59:30.000Z", NOW)).toBe("just now");
    expect(formatQueueAge("2026-11-12T00:30:00.000Z", NOW)).toBe("1h ago");
    expect(formatQueueAge("2026-11-10T02:00:00.000Z", NOW)).toBe("2d ago");
  });
});

describe("A7 — auto-retry policy", () => {
  test("pending always retries; failed retries only below the attempt cap", () => {
    expect(shouldAutoRetryQueueRecord(record({ status: "Pending", attempts: 0 }))).toBe(true);
    expect(shouldAutoRetryQueueRecord(record({ status: "Failed", attempts: OFFLINE_QUEUE_MAX_AUTO_ATTEMPTS - 1 }))).toBe(true);
    expect(shouldAutoRetryQueueRecord(record({ status: "Failed", attempts: OFFLINE_QUEUE_MAX_AUTO_ATTEMPTS }))).toBe(false);
    expect(shouldAutoRetryQueueRecord(record({ status: "Synced", attempts: 0 }))).toBe(false);
    expect(shouldAutoRetryQueueRecord(record({ status: "Syncing", attempts: 0 }))).toBe(false);
  });
});

describe("A3/A7 — single-record sync attempt (retry seam)", () => {
  test("a queued draft PATCH sends once, with the record id as idempotency key", async () => {
    const draftPatch = record({
      id: "queue_draft_patch_1",
      type: "receivingDraft",
      method: "PATCH",
      path: "/receiving/drafts/draft_42",
      body: { customerDrNumber: "DR-5", productLines: [] }
    });
    const send = vi.fn(async () => ({ ok: true }));

    const outcome = await attemptQueueRecordSync(draftPatch, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("PATCH", "/receiving/drafts/draft_42", draftPatch.body, "queue_draft_patch_1");
    expect(outcome.status).toBe("Synced");
    expect(outcome.attempts).toBe(1);
    expect(outcome.lastError).toBeUndefined();
  });

  test("a failed attempt keeps the SAME idempotency key for the next retry", async () => {
    const failing = record({ id: "queue_retry_key", type: "payment", path: "/payments", attempts: 1 });
    const send = vi
      .fn<(method: string, path: string, body: unknown, key: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce({ ok: true });

    const first = await attemptQueueRecordSync(failing, send);
    expect(first.status).toBe("Failed");
    expect(first.lastError).toBe("Network request failed");
    expect(first.attempts).toBe(2);

    const second = await attemptQueueRecordSync(first, send);
    expect(second.status).toBe("Synced");
    expect(send.mock.calls.map((call) => call[3])).toEqual(["queue_retry_key", "queue_retry_key"]);
  });
});

describe("B4 — queued finalize and trip cargo labels", () => {
  test("receiving finalize shows its label and DR detail", () => {
    const view = queueItemView(
      record({ type: "receivingFinalize", path: "/receiving/drafts/draft_9/finalize", body: { customerDrNumber: "DR-77" } }),
      NOW
    );
    expect(view.label).toBe("Receiving finalize");
    expect(view.detail).toContain("DR-77");
  });

  test("trip load and unload show their labels with package and trip detail", () => {
    const body = { cargoPackageId: "pkg_1", packageNumber: "PKG-2026-11-000777", tripNumber: "TR-2026-11-000009" };
    const load = queueItemView(record({ type: "tripCargo", path: "/trips/trip_1/load", body }), NOW);
    expect(load.label).toBe("Trip cargo load");
    expect(load.detail).toContain("PKG-2026-11-000777");
    expect(load.detail).toContain("TR-2026-11-000009");

    const unload = queueItemView(record({ type: "tripCargo", path: "/trips/trip_1/unload", body }), NOW);
    expect(unload.label).toBe("Trip cargo unload");
  });

  test("a successful sync retains the server response on the record (finalize reads its minted record from it)", async () => {
    const finalize = record({ type: "receivingFinalize", path: "/receiving", body: { customerDrNumber: "DR-78" } });
    const send = vi.fn(async () => ({ id: "rr_1", recordNumber: "RR-2026-11-000001" }));

    const outcome = await attemptQueueRecordSync(finalize, send);

    expect(outcome.status).toBe("Synced");
    expect(outcome.result).toEqual({ id: "rr_1", recordNumber: "RR-2026-11-000001" });
    // The queue record id is still the idempotency key on the replay.
    expect(send.mock.calls[0]?.[3]).toBe(finalize.id);
  });
});

describe("A7 — pruning selection", () => {
  test("keeps pending/failed/syncing and bounds synced history to the newest 50", () => {
    const records: OfflineQueueRecord[] = [];
    for (let i = 0; i < 60; i += 1) {
      records.push(
        record({
          id: `synced_${i}`,
          status: "Synced",
          createdAt: new Date(Date.UTC(2026, 10, 12, 0, i)).toISOString()
        })
      );
    }
    records.push(record({ id: "keep_pending", status: "Pending", createdAt: "2026-11-01T00:00:00.000Z" }));
    records.push(record({ id: "keep_failed", status: "Failed", createdAt: "2026-11-01T00:00:00.000Z" }));
    records.push(record({ id: "keep_syncing", status: "Syncing", createdAt: "2026-11-01T00:00:00.000Z" }));

    const toPrune = selectSyncedQueueRecordsToPrune(records);
    expect(toPrune).toHaveLength(10);
    expect(toPrune).toContain("synced_0"); // oldest synced go first
    expect(toPrune).not.toContain("synced_59"); // newest kept
    expect(toPrune).not.toContain("keep_pending");
    expect(toPrune).not.toContain("keep_failed");
    expect(toPrune).not.toContain("keep_syncing");
  });

  test("nothing is pruned at or under the bound", () => {
    const records = [record({ status: "Synced" }), record({ status: "Synced" })];
    expect(selectSyncedQueueRecordsToPrune(records)).toEqual([]);
    expect(selectSyncedQueueRecordsToPrune(records, 1)).toHaveLength(1);
  });
});
