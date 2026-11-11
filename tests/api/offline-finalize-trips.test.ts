import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type {
  CargoPackage,
  Customer,
  PaymentRecord,
  ReceivingDraftRecord,
  ReceivingRecord,
  ServiceAuditLog,
  Trip
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 4 PR 4 — B4: offline receiving finalize + offline trip loading.
 *
 * Both flows ride the Phase 4 machinery: the client queues the intent
 * with an idempotency key (B1) and the server applies it on replay.
 * Document numbers are minted server-side at apply time, so the proofs
 * here are the replay properties:
 *  (a) a queued finalize replayed twice applies once — same receiving
 *      record, same numbers, no duplicate packages — and the counter
 *      payment carried inside the finalize is collected exactly once;
 *  (b) a queued trip load replays cleanly when nothing changed;
 *  (c) a queued load replaying after another client loaded the package
 *      onto a different trip fails with a clear conflict reason and the
 *      package stays on the first trip;
 *  (d) a finalize replaying after the draft was already finalized online
 *      (same key, different key, or unkeyed) never mints a second
 *      receiving record.
 */

type ServiceInternals = {
  customers: Customer[];
  packages: CargoPackage[];
  receivingRecords: ReceivingRecord[];
  receivingDrafts: ReceivingDraftRecord[];
  payments: PaymentRecord[];
  trips: Trip[];
  auditLogs: ServiceAuditLog[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

function auditCount(service: LogisticsService, action: string): number {
  return internals(service).auditLogs.filter((log) => log.action === action).length;
}

const customer: Customer = {
  id: "cust_b4",
  businessName: "B4 Fixture Customer",
  status: "Active",
  billingTerm: "Custom",
  contacts: []
};

function seededService() {
  const service = new LogisticsService();
  internals(service).customers.push({ ...customer });
  return service;
}

/** A valid finalize payload: two priced packages, pickup at branch. */
function finalizeInput(extra: Record<string, unknown> = {}) {
  return {
    customerId: customer.id,
    customerDrNumber: "DR-B4-1",
    destination: "Daet",
    packages: [
      { description: "Rice sacks", deliveryType: "Customer pickup at branch" as const, price: 600, quantity: 1 },
      { description: "Feed bags", deliveryType: "Customer pickup at branch" as const, price: 400, quantity: 1 }
    ],
    ...extra
  };
}

function makeDraft(service: LogisticsService) {
  return service.createReceivingDraft({ formState: { senderName: "B4" }, productLines: [] });
}

/** Creates a priced, loadable package through the real receiving path. */
function makeLoadablePackage(service: LogisticsService) {
  const receiving = service.createReceiving({
    customerId: customer.id,
    destination: "Daet",
    packages: [{ description: "Loadable crate", deliveryType: "Customer pickup at branch" as const, price: 500, quantity: 1 }]
  });
  const pkg = receiving.packages[0];
  if (!pkg) throw new Error("fixture package missing");
  return pkg;
}

let tripSeq = 0;
function makeTrip(service: LogisticsService) {
  tripSeq += 1;
  // One active trip per truck per day is enforced, so each fixture trip
  // gets its own plate.
  return service.createTrip({ origin: "Naga", destination: "Daet", plateNumber: `B4-TRUCK-${tripSeq}` });
}

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-phase4-pr4-"));
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

describe("B4 (a) — queued finalize replay applies once, numbers minted once", () => {
  test("same key twice returns the same record and creates no duplicates", () => {
    const service = seededService();
    const draft = makeDraft(service);
    const input = finalizeInput({ idempotencyKey: "queue_finalize_a" });

    const first = service.finalizeReceivingDraft(draft.id, input);
    const second = service.finalizeReceivingDraft(draft.id, input);

    expect(second).toEqual(first);
    expect(second).not.toBe(first); // stored result is a copy, like B1
    expect(second.receiving.recordNumber).toBe(first.receiving.recordNumber);
    expect(internals(service).receivingRecords).toHaveLength(1);
    expect(internals(service).packages).toHaveLength(2);
    expect(auditCount(service, "receiving.create")).toBe(1);
    expect(auditCount(service, "receiving.draft_finalized")).toBe(1);
    expect(internals(service).receivingDrafts.find((entry) => entry.id === draft.id)?.status).toBe("Finalized");
  });

  test("direct (no-draft) keyed finalize also applies once", () => {
    const service = seededService();
    const input = finalizeInput({ idempotencyKey: "queue_finalize_direct" });

    const first = service.createReceiving(input);
    const second = service.createReceiving(input);

    expect(second.id).toBe(first.id);
    expect(second.recordNumber).toBe(first.recordNumber);
    expect(internals(service).receivingRecords).toHaveLength(1);
    expect(internals(service).packages).toHaveLength(2);
  });

  test("the counter payment rides inside the finalize and is collected exactly once", () => {
    const service = seededService();
    const draft = makeDraft(service);
    const input = finalizeInput({
      idempotencyKey: "queue_finalize_paid",
      collectPayment: { totalPaid: 1000, paymentStatus: "Paid", method: "Cash", reference: "REF-B4" }
    });

    const { receiving } = service.finalizeReceivingDraft(draft.id, input);
    service.finalizeReceivingDraft(draft.id, input); // replay

    const payments = internals(service).payments.filter((payment) =>
      receiving.packages.some((pkg) => pkg.id === payment.cargoPackageId)
    );
    expect(payments).toHaveLength(2);
    expect(payments.reduce((sum, payment) => sum + payment.amountPaid, 0)).toBe(1000);
    const byPackage = new Map(payments.map((payment) => [payment.cargoPackageId, payment.amountPaid]));
    expect(byPackage.get(receiving.packages[0]?.id ?? "")).toBe(600);
    expect(byPackage.get(receiving.packages[1]?.id ?? "")).toBe(400);
    expect(payments.every((payment) => payment.collectionPoint === "Receiving")).toBe(true);
    expect(payments[0]?.notes).toContain("Reference: REF-B4");
  });

  test("advance payment excess lands on the first package, mirroring the client distribution", () => {
    const service = seededService();
    const input = finalizeInput({
      collectPayment: { totalPaid: 1500, paymentStatus: "Advance Payment", method: "GCash" }
    });

    const receiving = service.createReceiving(input);
    const payments = internals(service).payments.filter((payment) =>
      receiving.packages.some((pkg) => pkg.id === payment.cargoPackageId)
    );

    expect(payments).toHaveLength(2);
    const byPackage = new Map(payments.map((payment) => [payment.cargoPackageId, payment.amountPaid]));
    // Total due is 1000; the 500 excess rides on package 1 (600 + 500).
    expect(byPackage.get(receiving.packages[0]?.id ?? "")).toBe(1100);
    expect(byPackage.get(receiving.packages[1]?.id ?? "")).toBe(400);
    expect(payments.reduce((sum, payment) => sum + payment.amountPaid, 0)).toBe(1500);
  });

  test("unpaid finalize records no payments", () => {
    const service = seededService();
    service.createReceiving(finalizeInput({ collectPayment: { totalPaid: 0, paymentStatus: "Unpaid" } }));
    expect(internals(service).payments).toHaveLength(0);
  });
});

describe("B4 (d) — finalize replay after the draft was finalized online", () => {
  test("different key and unkeyed replays return the existing record, never a duplicate", () => {
    const service = seededService();
    const draft = makeDraft(service);

    const online = service.finalizeReceivingDraft(draft.id, finalizeInput());
    const differentKey = service.finalizeReceivingDraft(draft.id, finalizeInput({ idempotencyKey: "queue_finalize_late" }));
    const unkeyed = service.finalizeReceivingDraft(draft.id, finalizeInput());

    expect(differentKey.receiving.id).toBe(online.receiving.id);
    expect(differentKey.receiving.recordNumber).toBe(online.receiving.recordNumber);
    expect(unkeyed.receiving.id).toBe(online.receiving.id);
    expect(internals(service).receivingRecords).toHaveLength(1);
    expect(internals(service).packages).toHaveLength(2);
    expect(auditCount(service, "receiving.create")).toBe(1);
  });

  test("the idempotency scope is per-draft: the same key on a different draft is a different intent", () => {
    const service = seededService();
    const draftA = makeDraft(service);
    const draftB = makeDraft(service);

    const a = service.finalizeReceivingDraft(draftA.id, finalizeInput({ idempotencyKey: "shared_key" }));
    const b = service.finalizeReceivingDraft(draftB.id, finalizeInput({ idempotencyKey: "shared_key" }));

    expect(b.receiving.id).not.toBe(a.receiving.id);
    expect(internals(service).receivingRecords).toHaveLength(2);
    expect(internals(service).receivingDrafts.find((entry) => entry.id === draftB.id)?.status).toBe("Finalized");
  });

  test("a cancelled draft still cannot be finalized", () => {
    const service = seededService();
    const draft = makeDraft(service);
    service.cancelReceivingDraft(draft.id);

    expect(() => service.finalizeReceivingDraft(draft.id, finalizeInput())).toThrow(/Only draft records can be finalized/);
    expect(internals(service).receivingRecords).toHaveLength(0);
  });
});

describe("B4 (b/c) — queued trip load replay and conflicts", () => {
  test("(b) keyed load replays cleanly: same outcome, cargo loaded once, one audit", () => {
    const service = seededService();
    const trip = makeTrip(service);
    const pkg = makeLoadablePackage(service);
    const input = { cargoPackageId: pkg.id, idempotencyKey: "queue_load_b" };

    const first = service.loadCargo(trip.id, input);
    const second = service.loadCargo(trip.id, input);

    expect(second.trip.cargoPackageIds).toEqual([pkg.id]);
    expect(first.trip.cargoPackageIds).toEqual([pkg.id]);
    expect(auditCount(service, "loading.scan")).toBe(1);
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("Loaded");
  });

  test("unkeyed double-load onto the same trip is also a no-op success", () => {
    const service = seededService();
    const trip = makeTrip(service);
    const pkg = makeLoadablePackage(service);

    service.loadCargo(trip.id, { cargoPackageId: pkg.id });
    const again = service.loadCargo(trip.id, { cargoPackageId: pkg.id });

    expect(again.trip.cargoPackageIds).toEqual([pkg.id]);
    expect(auditCount(service, "loading.scan")).toBe(1);
  });

  test("(c) load replaying after the package was loaded onto another trip fails visibly and moves nothing", () => {
    const service = seededService();
    const tripA = makeTrip(service);
    const tripB = makeTrip(service);
    const pkg = makeLoadablePackage(service);

    // Another client loaded the package onto trip A while this one was offline.
    service.loadCargo(tripA.id, { cargoPackageId: pkg.id });

    const attempt = () => service.loadCargo(tripB.id, { cargoPackageId: pkg.id, idempotencyKey: "queue_load_c" });
    expect(attempt).toThrow(new RegExp(`already loaded on trip ${tripA.tripNumber}`));
    // Failures are not recorded under the key: a retry fails the same way.
    expect(attempt).toThrow(/already loaded on trip/);

    const state = internals(service);
    expect(state.trips.find((entry) => entry.id === tripA.id)?.cargoPackageIds).toEqual([pkg.id]);
    expect(state.trips.find((entry) => entry.id === tripB.id)?.cargoPackageIds).toEqual([]);
    expect(state.packages.find((entry) => entry.id === pkg.id)?.status).toBe("Loaded");
  });

  test("delivered and cancelled cargo cannot be loaded", () => {
    const service = seededService();
    const trip = makeTrip(service);
    const pkg = makeLoadablePackage(service);
    const stored = internals(service).packages.find((entry) => entry.id === pkg.id);
    if (!stored) throw new Error("fixture package missing from state");

    stored.status = "Delivered";
    expect(() => service.loadCargo(trip.id, { cargoPackageId: pkg.id })).toThrow(/Delivered cargo cannot be loaded/);

    stored.status = "Cancelled";
    expect(() => service.loadCargo(trip.id, { cargoPackageId: pkg.id })).toThrow(/Cancelled cargo cannot be loaded/);
  });

  test("keyed unload replays once; unloading cargo that is not on the trip still fails", () => {
    const service = seededService();
    const trip = makeTrip(service);
    const pkg = makeLoadablePackage(service);
    service.loadCargo(trip.id, { cargoPackageId: pkg.id });

    const input = { cargoPackageId: pkg.id, reason: "Removed before departure by operator confirmation", idempotencyKey: "queue_unload_1" };
    const first = service.unloadCargo(trip.id, input);
    const second = service.unloadCargo(trip.id, input);

    expect(second).toEqual(first);
    expect(internals(service).trips.find((entry) => entry.id === trip.id)?.cargoPackageIds).toEqual([]);
    expect(auditCount(service, "loading.remove")).toBe(1);
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("Waiting for Loading");

    expect(() => service.unloadCargo(trip.id, { cargoPackageId: pkg.id, reason: "again" })).toThrow(/not loaded on this trip/);
  });
});
