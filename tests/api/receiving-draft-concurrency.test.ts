import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type { ReceivingDraft, ServiceAuditLog } from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 fix loop PR-7c — receiving-draft optimistic concurrency
 * (filed as L21-F2, MEDIUM; the last piece of the finding).
 *
 * PR-7 (C-M8) guarded price edits and PR-7b guarded receiving-record
 * edits, but the draft PATCH path L21 actually interleaved —
 * PATCH /receiving/drafts/:id → updateReceivingDraft — still let the
 * later of two sessions silently win. The draft now carries
 * editVersion and the update accepts baseEditVersion (the editVersion
 * the editor loaded; absent on pre-PR-7c drafts = 0). A stale save is
 * refused 409 + the current version, applying nothing; the shipped
 * web shell's draft save always sends the base.
 *
 * The draft path is the queueable one, so the design point under test
 * is the interplay with idempotency replay (Phase 4 B1): the base
 * check lives inside updateReceivingDraftOnce, which runIdempotent
 * invokes ONLY for a genuinely new request. A replayed queued save
 * (same key) is answered from the stored result before the Once runs,
 * so a retry after a lost response returns its original result —
 * never a fresh 409 against the version its own first attempt
 * created. And because runIdempotent records only successes, a
 * refused save does not burn its key: reload, correct the base, and
 * retry under the same key lands.
 *
 * A save naming NO base keeps the pre-PR-7c behaviour (older clients
 * and already-queued offline entries send none), exactly the compat
 * ruling PR-7/PR-7b took. Every actual change bumps the version; a
 * no-change re-save does not, so an autosave echo cannot invalidate
 * another editor's base.
 */

type ServiceInternals = {
  auditLogs: ServiceAuditLog[];
  receivingDrafts: ReceivingDraft[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

function draftUpdatedAudits(service: LogisticsService): number {
  return internals(service).auditLogs.filter((log) => log.action === "receiving.draft_updated").length;
}

function storedDraft(service: LogisticsService, draftId: string): ReceivingDraft {
  const draft = internals(service).receivingDrafts.find((entry) => entry.id === draftId);
  if (!draft) throw new Error(`draft ${draftId} not stored`);
  return draft;
}

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-pr7c-"));
  previousInitCwd = process.env.INIT_CWD;
  previousRepository = process.env.MTS_REPOSITORY;
  process.env.INIT_CWD = tempRoot;
  delete process.env.MTS_REPOSITORY;
});

afterAll(() => {
  if (previousInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = previousInitCwd;
  if (previousRepository === undefined) delete process.env.MTS_REPOSITORY;
  else process.env.MTS_REPOSITORY = previousRepository;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("L21-F2 — interleaved draft edits", () => {
  test("the later session's stale save is refused 409 and applies nothing; a fresh-base retry lands", () => {
    const service = new LogisticsService();
    const draft = service.createReceivingDraft({ formState: { senderName: "Counter A" }, productLines: [] });
    // Both sessions loaded the draft at its initial version (absent = 0).
    const loadedBase = draft.editVersion ?? 0;
    expect(loadedBase).toBe(0);

    // Session B saves first: destination Daet -> Naga, version moves.
    const bSave = service.updateReceivingDraft(draft.id, { destination: "Naga", baseEditVersion: loadedBase });
    expect(bSave.editVersion).toBe(1);
    expect(bSave.destination).toBe("Naga");
    const afterB = JSON.stringify(storedDraft(service, draft.id));

    // Session A saves from its stale read (the L21 case): refused,
    // with the current version named, and the draft is byte-identical.
    let thrown: unknown;
    try {
      service.updateReceivingDraft(draft.id, { destination: "Daet", baseEditVersion: loadedBase });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConflictException);
    const conflict = thrown as ConflictException;
    expect(conflict.getStatus()).toBe(409);
    const body = conflict.getResponse() as { message: string; currentEditVersion: number };
    expect(body.currentEditVersion).toBe(1);
    expect(body.message).toContain("Reload the draft");
    expect(JSON.stringify(storedDraft(service, draft.id))).toBe(afterB);
    expect(storedDraft(service, draft.id).destination).toBe("Naga");

    // A reloads (base is now 1) and re-applies: lands, version moves.
    const retry = service.updateReceivingDraft(draft.id, { destination: "Daet", baseEditVersion: body.currentEditVersion });
    expect(retry.editVersion).toBe(2);
    expect(retry.destination).toBe("Daet");
  });

  test("a save naming no base keeps last-writer-wins (compat for older clients and queued entries)", () => {
    const service = new LogisticsService();
    const draft = service.createReceivingDraft({ formState: {}, productLines: [] });

    service.updateReceivingDraft(draft.id, { destination: "Naga" });
    const second = service.updateReceivingDraft(draft.id, { destination: "Daet" });

    expect(second.destination).toBe("Daet");
    expect(second.editVersion).toBe(2); // the version still moves on every actual change
    expect(draftUpdatedAudits(service)).toBe(2);
  });

  test("a no-change re-save does not bump the version, so it cannot invalidate another editor's base", () => {
    const service = new LogisticsService();
    const draft = service.createReceivingDraft({
      destination: "Daet",
      formState: { senderName: "Same" },
      productLines: [{ id: "line-1" }]
    });

    const echo = service.updateReceivingDraft(draft.id, {
      destination: "Daet",
      formState: { senderName: "Same" },
      productLines: [{ id: "line-1" }],
      baseEditVersion: 0
    });
    expect(echo.editVersion ?? 0).toBe(0);

    // The same base is still good for a second identical save and for
    // the first real change that follows it.
    const again = service.updateReceivingDraft(draft.id, { destination: "Daet", baseEditVersion: 0 });
    expect(again.editVersion ?? 0).toBe(0);
    const change = service.updateReceivingDraft(draft.id, { destination: "Naga", baseEditVersion: 0 });
    expect(change.editVersion).toBe(1);
  });
});

describe("L21-F2 — the guard inside the idempotency boundary", () => {
  test("replay pin: the same key retried after success returns the original result, never a 409 from its own first attempt", () => {
    const service = new LogisticsService();
    const draft = service.createReceivingDraft({ formState: {}, productLines: [] });

    const update = { destination: "Naga", baseEditVersion: 0, idempotencyKey: "queue_draft_save_1" };
    const first = service.updateReceivingDraft(draft.id, update);
    expect(first.editVersion).toBe(1);

    // The response was lost; the queue replays the identical request.
    // Its base (0) is now stale BY ITS OWN HAND — the stored result
    // must answer, not a conflict.
    const replay = service.updateReceivingDraft(draft.id, { ...update });
    expect(replay).toEqual(first);
    expect(replay).not.toBe(first); // stored result is a copy, like B1
    expect(draftUpdatedAudits(service)).toBe(1); // applied exactly once
    expect(storedDraft(service, draft.id).editVersion).toBe(1);
  });

  test("replaying an old key after another writer moved the draft returns the original result and leaves the draft untouched", () => {
    const service = new LogisticsService();
    const draft = service.createReceivingDraft({ formState: {}, productLines: [] });

    const first = service.updateReceivingDraft(draft.id, { destination: "Daet", baseEditVersion: 0, idempotencyKey: "queue_key_old" });
    // The service returns the live record, which the next writer's
    // save will mutate — snapshot the first result as it was returned.
    const firstAsReturned = JSON.parse(JSON.stringify(first)) as ReceivingDraft;
    service.updateReceivingDraft(draft.id, { destination: "Naga", baseEditVersion: 1, idempotencyKey: "queue_key_newer" });
    expect(storedDraft(service, draft.id).editVersion).toBe(2);

    const replay = service.updateReceivingDraft(draft.id, { destination: "Daet", baseEditVersion: 0, idempotencyKey: "queue_key_old" });
    expect(replay).toEqual(firstAsReturned);
    expect(replay.destination).toBe("Daet");
    expect(replay.editVersion).toBe(1);
    expect(storedDraft(service, draft.id).destination).toBe("Naga");
    expect(storedDraft(service, draft.id).editVersion).toBe(2);
    expect(draftUpdatedAudits(service)).toBe(2);
  });

  test("a refused save does not burn its key: reload and retry under the same key lands", () => {
    const service = new LogisticsService();
    const draft = service.createReceivingDraft({ formState: {}, productLines: [] });
    service.updateReceivingDraft(draft.id, { destination: "Naga", baseEditVersion: 0 });

    expect(() =>
      service.updateReceivingDraft(draft.id, { destination: "Daet", baseEditVersion: 0, idempotencyKey: "queue_key_retry" })
    ).toThrow(ConflictException);

    const retry = service.updateReceivingDraft(draft.id, { destination: "Daet", baseEditVersion: 1, idempotencyKey: "queue_key_retry" });
    expect(retry.destination).toBe("Daet");
    expect(retry.editVersion).toBe(2);
  });
});

describe("L21-F2 — the Prisma mapping carries the draft editVersion both ways", () => {
  function makeDraft(overrides: Partial<ReceivingDraft> = {}): ReceivingDraft {
    return {
      id: "draft_pr7c",
      draftNumber: "DRAFT-2026-11-000001",
      status: "Draft",
      customerId: "cust_1",
      customerNameSnapshot: "Fixture Customer",
      customerStatusSnapshot: "Active",
      customerDrNumber: "DR-1",
      destination: "Daet",
      formState: { senderName: "Fixture" },
      productLines: [{ id: "line-1" }],
      createdBy: "user_1",
      updatedBy: "user_1",
      createdAt: "2026-11-11T03:00:00.000Z",
      updatedAt: "2026-11-11T03:30:00.000Z",
      ...overrides
    };
  }

  function fixtureState(receivingDrafts: ReceivingDraft[]): ServiceState {
    return {
      sequences: [],
      customers: [],
      receivingRecords: [],
      receivingDrafts,
      receivingIntakeTasks: [],
      packages: [],
      productMasters: [],
      trucks: [],
      trips: [],
      deliveries: [],
      payments: [],
      expenses: [],
      returnRecords: [],
      billingInvoices: [],
      notifications: [],
      auditLogs: [],
      descriptionBarcodes: [],
      messages: [],
      operationChatThreads: [],
      hardwareTests: [],
      printLogs: [],
      customUsers: [],
      companyProfile: {
        companyName: "Mancenido Trucking Services",
        address: "Fixture address",
        phone: "0917 000 0000",
        email: "ops@example.test"
      },
      branches: [],
      paymentMethods: ["Cash"],
      expenseCategories: ["Fuel"],
      idempotencyRecords: []
    } as ServiceState;
  }

  test("a moved version round-trips; a legacy draft gains no version field", () => {
    const moved = makeDraft({ editVersion: 3 });
    const legacy = makeDraft({ id: "draft_pr7c_legacy", draftNumber: "DRAFT-2026-11-000002" });
    expect(legacy.editVersion).toBeUndefined();

    const rows = stateToRows(fixtureState([moved, legacy]));
    expect(rows.receivingDrafts.find((entry) => entry.id === "draft_pr7c")?.editVersion).toBe(3);
    expect(rows.receivingDrafts.find((entry) => entry.id === "draft_pr7c_legacy")?.editVersion).toBe(0);

    const roundTripped = rowsToState(rows);
    expect(roundTripped.receivingDrafts?.find((entry) => entry.id === "draft_pr7c")?.editVersion).toBe(3);
    expect(roundTripped.receivingDrafts?.find((entry) => entry.id === "draft_pr7c_legacy")?.editVersion).toBeUndefined();
  });
});
