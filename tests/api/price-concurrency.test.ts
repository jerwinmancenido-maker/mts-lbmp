import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type {
  CargoPackage,
  OperationChatThread,
  ReceivingRecord,
  StaffUserRecord
} from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 fix loop PR-7 — price-edit optimistic concurrency (canonical
 * finding C-M8; filed as L21-F1, HIGH).
 *
 * Before this fix, updatePackagePrice took no version precondition:
 * session A read a package priced ₱350, session B set ₱400 (200), and
 * A's stale save of ₱375 then landed (200) — B's edit was silently
 * destroyed and neither saver was told. The endpoint now accepts
 * basePriceVersion (the priceVersion the editor loaded; absent on
 * pre-PR-7 records = 0) and refuses a stale save with 409 + the
 * current price/version, applying nothing. Every actual price change
 * bumps the version, whichever writer made it (price endpoint, chat
 * price approval, receiving-record edit), so the guard cannot be
 * bypassed by changing the price through a different door.
 *
 * Deliberate scope, pinned by tests below:
 * - The version guards the PRICE field only. A change to a different
 *   field (measurements) between read and save does not block a price
 *   save — the price editor never held those fields, and a record-wide
 *   version would false-conflict on routine cargo activity.
 * - A save naming NO base keeps the pre-PR-7 behaviour. The repo's own
 *   smoke script and already-deployed clients send none; the shipped
 *   web shell always sends the base, so the staff flow is guarded.
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  packages: CargoPackage[];
  receivingRecords: ReceivingRecord[];
  operationChatThreads: OperationChatThread[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const ENV_KEYS = ["INIT_CWD", "MTS_REPOSITORY", "ALLOW_DEMO_AUTH", "NODE_ENV"];
const savedEnv: Record<string, string | undefined> = {};
const tempRoots: string[] = [];

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.MTS_REPOSITORY;
  delete process.env.ALLOW_DEMO_AUTH;
  if (process.env.NODE_ENV === "production") delete process.env.NODE_ENV;
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

/** Boots a service against a fresh throwaway state dir. */
async function bootService() {
  const dir = mkdtempSync(join(tmpdir(), "mts-price-concurrency-"));
  tempRoots.push(dir);
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

function seedAdmin(service: LogisticsService): StaffUserRecord {
  const admin: StaffUserRecord = {
    id: "user_pr7_admin",
    name: "Price Admin",
    email: "price.admin@example.test",
    role: "System Admin",
    branchAccess: "All branches",
    status: "Active",
    sessionVersion: 0,
    createdAt: "2026-11-12T00:00:00.000Z"
  };
  internals(service).customUsers.push(admin);
  return admin;
}

function makePackage(overrides: Partial<CargoPackage> = {}): CargoPackage {
  return {
    id: "pkg_pr7",
    packageNumber: "PKG-2026-11-000777",
    receivingRecordNumber: "RR-2026-11-000777",
    customerId: "cust_pr7",
    customerName: "Concurrency Fixture Customer",
    productId: "",
    description: "Rice sacks",
    quantity: 2,
    unit: "sack",
    destination: "Daet",
    handlingBranchId: "daet",
    handlingBranchName: "Daet",
    deliveryType: "Deliver to consignee",
    condition: "Good",
    status: "Waiting for Loading",
    price: 350,
    qrValue: "MTS:PKG:PKG-2026-11-000777",
    photoUrls: [],
    createdAt: "2026-11-12T00:00:00.000Z",
    ...overrides
  };
}

describe("C-M8 — interleaved price edits can no longer silently overwrite", () => {
  test("the round's exact interleave: A's stale ₱375 save is refused 409 and B's ₱400 survives", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    // The package as both sessions read it: priced ₱350, no
    // priceVersion field (the pre-PR-7 record shape) — base 0.
    const cargo = makePackage();
    internals(service).packages.push(cargo);
    const baseSeenByBoth = cargo.priceVersion ?? 0;
    expect(baseSeenByBoth).toBe(0);

    // Session B saves first, from the same base: lands.
    const bResult = service.updatePackagePrice(
      cargo.id,
      { price: 400, reason: "B corrects the price", basePriceVersion: baseSeenByBoth },
      admin.id
    );
    expect(bResult.price).toBe(400);
    expect(bResult.priceVersion).toBe(1);

    // Session A saves from its stale read: refused, nothing applied.
    let thrown: unknown;
    try {
      service.updatePackagePrice(
        cargo.id,
        { price: 375, reason: "A's stale save", basePriceVersion: baseSeenByBoth },
        admin.id
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConflictException);
    const conflict = thrown as ConflictException;
    expect(conflict.getStatus()).toBe(409);
    // The refusal names the conflict and carries the current values so
    // the caller can reconcile instead of guessing.
    const body = conflict.getResponse() as { message: string; currentPrice: number; currentPriceVersion: number };
    expect(body.message).toContain("changed by someone else");
    expect(body.currentPrice).toBe(400);
    expect(body.currentPriceVersion).toBe(1);

    const after = internals(service).packages.find((pkg) => pkg.id === cargo.id);
    expect(after?.price).toBe(400);
    expect(after?.priceVersion).toBe(1);
  });

  test("a save carrying the fresh base after the interleave lands normally", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const cargo = makePackage();
    internals(service).packages.push(cargo);

    service.updatePackagePrice(cargo.id, { price: 400, reason: "First save", basePriceVersion: 0 }, admin.id);
    // A reloads, sees version 1 / ₱400, and deliberately reprices.
    const result = service.updatePackagePrice(
      cargo.id,
      { price: 375, reason: "Repriced after reload", basePriceVersion: 1 },
      admin.id
    );
    expect(result.price).toBe(375);
    expect(result.priceVersion).toBe(2);
  });

  test("a save naming no base keeps the pre-PR-7 behaviour (older clients, the repo smoke script)", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const cargo = makePackage();
    internals(service).packages.push(cargo);

    const result = service.updatePackagePrice(cargo.id, { price: 500, reason: "No base supplied" }, admin.id);
    expect(result.price).toBe(500);
    // The change still bumps the version, so a guarded client reading
    // the record afterwards gets the true base.
    expect(result.priceVersion).toBe(1);
  });

  test("re-saving the same price does not bump the version (no false conflicts for other editors)", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const cargo = makePackage();
    internals(service).packages.push(cargo);

    const result = service.updatePackagePrice(
      cargo.id,
      { price: 350, reason: "Confirming the same price", basePriceVersion: 0 },
      admin.id
    );
    expect(result.price).toBe(350);
    expect(result.priceVersion ?? 0).toBe(0);
  });

  test("a different-field change between read and save does not block the price save (price-scoped guard)", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const cargo = makePackage();
    internals(service).packages.push(cargo);

    // A colleague corrects the weight while the price editor is open.
    service.updatePackageMeasurements(cargo.id, { weight: 42, reason: "Reweighed at the counter" }, admin.id);

    const result = service.updatePackagePrice(
      cargo.id,
      { price: 375, reason: "Price correction", basePriceVersion: 0 },
      admin.id
    );
    expect(result.price).toBe(375);
    expect(result.priceVersion).toBe(1);
  });

  test("a chat price approval bumps the version — a price save based on the pre-approval read then refuses", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const cargo = makePackage();
    internals(service).packages.push(cargo);
    const thread: OperationChatThread = {
      id: "thread_pr7",
      scope: "Package",
      title: "Price approval for PKG-2026-11-000777",
      cargoPackageId: cargo.id,
      packageNumber: cargo.packageNumber,
      status: "Needs Approval",
      actionType: "PriceApproval",
      proposedPrice: 500,
      createdAt: "2026-11-12T00:00:00.000Z",
      updatedAt: "2026-11-12T00:00:00.000Z",
      messages: []
    };
    internals(service).operationChatThreads.push(thread);

    service.decidePriceApproval(
      thread.id,
      { decision: "Approved" },
      { id: admin.id, role: admin.role, branchAccess: admin.branchAccess }
    );
    const approved = internals(service).packages.find((pkg) => pkg.id === cargo.id);
    expect(approved?.price).toBe(500);
    expect(approved?.priceVersion).toBe(1);

    expect(() =>
      service.updatePackagePrice(cargo.id, { price: 375, reason: "Stale editor save", basePriceVersion: 0 }, admin.id)
    ).toThrow(ConflictException);
    expect(internals(service).packages.find((pkg) => pkg.id === cargo.id)?.price).toBe(500);
  });

  test("a receiving-record edit that changes the price bumps the version — a stale price save then refuses", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const cargo = makePackage();
    internals(service).packages.push(cargo);
    const record: ReceivingRecord = {
      id: "rr_pr7",
      recordNumber: cargo.receivingRecordNumber,
      customerId: cargo.customerId,
      customerName: cargo.customerName,
      destination: "Daet",
      packages: [cargo],
      createdAt: "2026-11-12T00:00:00.000Z"
    };
    internals(service).receivingRecords.push(record);

    service.updateReceivingRecord(
      record.id,
      { reason: "Encode correction", packages: [{ id: cargo.id, price: 600 }] },
      admin.id
    );
    const edited = internals(service).packages.find((pkg) => pkg.id === cargo.id);
    expect(edited?.price).toBe(600);
    expect(edited?.priceVersion).toBe(1);

    expect(() =>
      service.updatePackagePrice(cargo.id, { price: 375, reason: "Stale editor save", basePriceVersion: 0 }, admin.id)
    ).toThrow(ConflictException);
    expect(internals(service).packages.find((pkg) => pkg.id === cargo.id)?.price).toBe(600);
  });
});

describe("C-M8 — the Prisma mapping carries priceVersion both ways", () => {
  function fixtureState(packages: CargoPackage[]): ServiceState {
    return {
      sequences: [],
      customers: [],
      receivingRecords: [],
      receivingDrafts: [],
      receivingIntakeTasks: [],
      packages,
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

  test("a moved version round-trips; a legacy record gains no version field", () => {
    const rows = stateToRows(fixtureState([makePackage({ priceVersion: 3 }), makePackage({ id: "pkg_pr7_legacy", packageNumber: "PKG-2026-11-000778", qrValue: "MTS:PKG:PKG-2026-11-000778" })]));
    expect(rows.cargoPackages.find((row) => row.id === "pkg_pr7")?.priceVersion).toBe(3);
    expect(rows.cargoPackages.find((row) => row.id === "pkg_pr7_legacy")?.priceVersion).toBe(0);

    const roundTripped = rowsToState(rows);
    expect(roundTripped.packages?.find((pkg) => pkg.id === "pkg_pr7")?.priceVersion).toBe(3);
    expect(roundTripped.packages?.find((pkg) => pkg.id === "pkg_pr7_legacy")?.priceVersion).toBeUndefined();
  });
});
