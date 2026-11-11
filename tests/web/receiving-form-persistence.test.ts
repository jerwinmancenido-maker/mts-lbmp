import { describe, expect, test } from "vitest";
import {
  clearReceivingFormSnapshot,
  loadReceivingFormSnapshot,
  parseReceivingFormSnapshot,
  receivingFormHasContent,
  receivingFormStorageKey,
  saveReceivingFormSnapshot,
  type ReceivingFormSnapshot,
  type ReceivingFormStore
} from "../../apps/web/src/app/ui/receiving-form-persistence";

/**
 * Phase 4 PR 3 — A3 receiving-form persistence.
 *
 * The persistence seam is injected, so these tests exercise the real
 * save/load/clear logic against an in-memory store: saving a snapshot and
 * loading it back through a fresh read is exactly the reload/reopen path
 * the receiving screen runs on mount (production injects the IndexedDB
 * cache-backed store).
 */

function memoryStore(): ReceivingFormStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    read: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    write: async <T>(key: string, value: T) => {
      data.set(key, value);
    },
    remove: async (key: string) => {
      data.delete(key);
    }
  };
}

const typedSnapshot: ReceivingFormSnapshot = {
  version: 1,
  savedAt: "2026-11-12T01:30:00.000Z",
  activeDraftId: "",
  activeDraftNumber: "",
  payload: {
    customerDrNumber: "DR-7781",
    destination: "Daet",
    formState: { customerDrNumber: "DR-7781", senderName: "Fixture Sender", quantity: "1", unit: "pcs" },
    productLines: [{ id: "line-1", description: "Rice sacks" }]
  }
};

describe("A3 — receiving form persistence round-trip", () => {
  test("a saved form survives a simulated reload (save → fresh load)", async () => {
    const store = memoryStore();
    await saveReceivingFormSnapshot(store, "user-1", typedSnapshot);

    // A reload re-reads through a brand-new load call; nothing is shared
    // with the save path except the store itself.
    const restored = await loadReceivingFormSnapshot(store, "user-1");
    expect(restored).toEqual(typedSnapshot);
    expect(restored?.payload.formState.senderName).toBe("Fixture Sender");
    expect(restored?.payload.productLines).toHaveLength(1);
  });

  test("snapshots are per-user", async () => {
    const store = memoryStore();
    await saveReceivingFormSnapshot(store, "user-1", typedSnapshot);
    expect(await loadReceivingFormSnapshot(store, "user-2")).toBeNull();
    expect(receivingFormStorageKey("user-1")).not.toBe(receivingFormStorageKey("user-2"));
  });

  test("nothing saved loads as null", async () => {
    const store = memoryStore();
    expect(await loadReceivingFormSnapshot(store, "user-1")).toBeNull();
  });

  test("a malformed stored value loads as null instead of crashing the form", async () => {
    const store = memoryStore();
    store.data.set(receivingFormStorageKey("user-1"), { version: 99, payload: "garbage" });
    expect(await loadReceivingFormSnapshot(store, "user-1")).toBeNull();
    store.data.set(receivingFormStorageKey("user-1"), "not an object");
    expect(await loadReceivingFormSnapshot(store, "user-1")).toBeNull();
  });

  test("an untouched (content-free) snapshot is not restored", async () => {
    const store = memoryStore();
    const empty: ReceivingFormSnapshot = {
      version: 1,
      savedAt: "2026-11-12T01:30:00.000Z",
      activeDraftId: "",
      activeDraftNumber: "",
      payload: { formState: { quantity: "1", unit: "pcs", destination: "Daet" }, productLines: [] }
    };
    await saveReceivingFormSnapshot(store, "user-1", empty);
    expect(await loadReceivingFormSnapshot(store, "user-1")).toBeNull();
  });

  test("clear removes the snapshot (discard / finalize path)", async () => {
    const store = memoryStore();
    await saveReceivingFormSnapshot(store, "user-1", typedSnapshot);
    await clearReceivingFormSnapshot(store, "user-1");
    expect(await loadReceivingFormSnapshot(store, "user-1")).toBeNull();
  });

  test("parse rejects snapshots from a different shape version", () => {
    expect(parseReceivingFormSnapshot({ ...typedSnapshot, version: 2 })).toBeNull();
    expect(parseReceivingFormSnapshot(null)).toBeNull();
    expect(parseReceivingFormSnapshot(typedSnapshot)).toEqual(typedSnapshot);
  });
});

describe("A3 — receivingFormHasContent", () => {
  test("product lines alone count as work", () => {
    expect(receivingFormHasContent({ formState: {}, productLines: [{ id: "x" }] })).toBe(true);
  });

  test("typed fields count as work", () => {
    expect(receivingFormHasContent({ formState: { senderName: "Ana" }, productLines: [] })).toBe(true);
    expect(receivingFormHasContent({ formState: { customerDrNumber: "DR-1" }, productLines: [] })).toBe(true);
    expect(receivingFormHasContent({ formState: { receivingAmountPaid: "500" }, productLines: [] })).toBe(true);
  });

  test("always-present defaults do not count as work", () => {
    expect(
      receivingFormHasContent({
        formState: { quantity: "1", unit: "pcs", destination: "Daet", condition: "Good", senderType: "Sales Agent" },
        productLines: []
      })
    ).toBe(false);
    expect(receivingFormHasContent({ formState: { senderName: "   " }, productLines: [] })).toBe(false);
  });
});
