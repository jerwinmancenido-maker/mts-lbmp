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
 * Round 1 fix loop PR-7b — receiving-record optimistic concurrency
 * (filed as L21-F2, MEDIUM; the follow-up PR #41 explicitly flagged).
 *
 * PR-7 (C-M8) closed the silent overwrite for price edits with
 * priceVersion, but two staff interleaving RECEIVING-record edits
 * still overwrote each other silently: updateReceivingRecord took no
 * version precondition. The record now carries editVersion and the
 * edit accepts baseEditVersion (the editVersion the editor loaded;
 * absent on pre-PR-7b records = 0). A stale save is refused 409 +
 * the current version, applying nothing; the shipped web shell's
 * receiving-edit save always sends the base.
 *
 * Bump discipline, pinned by tests below — every actual change to
 * the record moves the version, whichever writer made it:
 * - the receiving edit itself (a no-change re-save does NOT bump);
 * - a DR photo attach, and a queued intake photo resolving onto the
 *   record (both write the record's DR photo fields);
 * - a price change through the price endpoint or a chat approval,
 *   and a condition change through arrival verification — the package
 *   fields the receiving editor writes, changed through another door.
 * Writers of fields the editor never writes (package status flows,
 * measurements) deliberately do not bump: routine cargo activity
 * must not false-conflict an open receiving editor.
 *
 * A save naming NO base keeps the pre-PR-7b behaviour (older clients
 * send none), exactly the compat ruling PR-7 took for price saves.
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
  const dir = mkdtempSync(join(tmpdir(), "mts-receiving-concurrency-"));
  tempRoots.push(dir);
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

function seedAdmin(service: LogisticsService): StaffUserRecord {
  const admin: StaffUserRecord = {
    id: "user_pr7b_admin",
    name: "Receiving Admin",
    email: "receiving.admin@example.test",
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
    id: "pkg_pr7b",
    packageNumber: "PKG-2026-11-000888",
    receivingRecordNumber: "RR-2026-11-000888",
    customerId: "cust_pr7b",
    customerName: "Receiving Concurrency Fixture",
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
    qrValue: "MTS:PKG:PKG-2026-11-000888",
    photoUrls: [],
    createdAt: "2026-11-12T00:00:00.000Z",
    ...overrides
  };
}

function makeRecord(cargo: CargoPackage, overrides: Partial<ReceivingRecord> = {}): ReceivingRecord {
  return {
    id: "rr_pr7b",
    recordNumber: cargo.receivingRecordNumber,
    customerId: cargo.customerId,
    customerName: cargo.customerName,
    destination: "Daet",
    packages: [cargo],
    createdAt: "2026-11-12T00:00:00.000Z",
    ...overrides
  };
}

function seedRecord(service: LogisticsService, cargoOverrides: Partial<CargoPackage> = {}) {
  const cargo = makePackage(cargoOverrides);
  internals(service).packages.push(cargo);
  const record = makeRecord(cargo);
  internals(service).receivingRecords.push(record);
  return { cargo, record };
}

function storedRecord(service: LogisticsService, id: string): ReceivingRecord {
  const record = internals(service).receivingRecords.find((entry) => entry.id === id);
  if (!record) throw new Error(`record ${id} missing from internals`);
  return record;
}

describe("L21-F2 — interleaved receiving-record edits can no longer silently overwrite", () => {
  test("the interleave: B's save lands and bumps; A's stale save is refused 409 and the record is byte-identical", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const { cargo, record } = seedRecord(service);
    // Both sessions read the record as it was created: no editVersion
    // field (the pre-PR-7b record shape) — base 0.
    const baseSeenByBoth = record.editVersion ?? 0;
    expect(baseSeenByBoth).toBe(0);

    // Session B saves first, from the same base: lands, version moves.
    const bResult = service.updateReceivingRecord(
      record.id,
      { reason: "B corrects the destination", destination: "Naga", baseEditVersion: baseSeenByBoth },
      admin.id
    );
    expect(bResult.destination).toBe("Naga");
    expect(bResult.editVersion).toBe(1);

    const snapshotAfterB = JSON.stringify(storedRecord(service, record.id));
    const cargoSnapshotAfterB = JSON.stringify(internals(service).packages.find((pkg) => pkg.id === cargo.id));

    // Session A saves from its stale read — a header change AND a
    // package price change: refused, and nothing at all is applied.
    let thrown: unknown;
    try {
      service.updateReceivingRecord(
        record.id,
        {
          reason: "A's stale save",
          sender: "A Sender",
          packages: [{ id: cargo.id, price: 999 }],
          baseEditVersion: baseSeenByBoth
        },
        admin.id
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConflictException);
    const conflict = thrown as ConflictException;
    expect(conflict.getStatus()).toBe(409);
    const body = conflict.getResponse() as { message: string; currentEditVersion: number };
    expect(body.message).toContain("changed by someone else");
    expect(body.message).toContain("Reload the record and re-apply your changes");
    expect(body.currentEditVersion).toBe(1);

    expect(JSON.stringify(storedRecord(service, record.id))).toBe(snapshotAfterB);
    expect(JSON.stringify(internals(service).packages.find((pkg) => pkg.id === cargo.id))).toBe(cargoSnapshotAfterB);
    expect(storedRecord(service, record.id).destination).toBe("Naga");
  });

  test("A reloads and retries with the fresh base: the save lands and B's edit survives", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const { record } = seedRecord(service);

    service.updateReceivingRecord(
      record.id,
      { reason: "B corrects the destination", destination: "Naga", baseEditVersion: 0 },
      admin.id
    );
    // A reloads, sees version 1 / destination Naga, and applies its
    // own correction on top.
    const result = service.updateReceivingRecord(
      record.id,
      { reason: "A adds the sender after reload", sender: "A Sender", baseEditVersion: 1 },
      admin.id
    );
    expect(result.editVersion).toBe(2);
    expect(result.sender).toBe("A Sender");
    expect(result.destination).toBe("Naga");
  });

  test("a save naming no base keeps the pre-PR-7b behaviour (older clients)", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const { record } = seedRecord(service);

    service.updateReceivingRecord(
      record.id,
      { reason: "First edit", destination: "Naga", baseEditVersion: 0 },
      admin.id
    );
    // No base named: last-writer-wins, as before PR-7b — but the
    // change still bumps the version, so a guarded client reading
    // the record afterwards gets the true base.
    const result = service.updateReceivingRecord(
      record.id,
      { reason: "Unguarded client save", consignee: "Unguarded Consignee" },
      admin.id
    );
    expect(result.consignee).toBe("Unguarded Consignee");
    expect(result.editVersion).toBe(2);
  });

  test("a no-change re-save does not bump the version (no false conflicts for other editors)", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const { record } = seedRecord(service);

    const result = service.updateReceivingRecord(
      record.id,
      { reason: "Re-saving what is already there", destination: "Daet", baseEditVersion: 0 },
      admin.id
    );
    expect(result.destination).toBe("Daet");
    expect(result.editVersion ?? 0).toBe(0);
  });
});

describe("L21-F2 — neighbouring writers move the record's edit version", () => {
  test("a price-endpoint change bumps the record version — a stale receiving save then refuses and the price survives", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const { cargo, record } = seedRecord(service);

    service.updatePackagePrice(cargo.id, { price: 400, reason: "Counter repricing", basePriceVersion: 0 }, admin.id);
    expect(storedRecord(service, record.id).editVersion).toBe(1);

    // The receiving editor still holds base 0 and its stale ₱350:
    // refused, and the counter's ₱400 is not silently restored away.
    expect(() =>
      service.updateReceivingRecord(
        record.id,
        { reason: "Stale editor save", packages: [{ id: cargo.id, price: 350 }], baseEditVersion: 0 },
        admin.id
      )
    ).toThrow(ConflictException);
    expect(internals(service).packages.find((pkg) => pkg.id === cargo.id)?.price).toBe(400);
  });

  test("a chat price approval bumps the record version — a stale receiving save then refuses", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const { cargo, record } = seedRecord(service);
    const thread: OperationChatThread = {
      id: "thread_pr7b",
      scope: "Package",
      title: "Price approval for PKG-2026-11-000888",
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
    expect(internals(service).packages.find((pkg) => pkg.id === cargo.id)?.price).toBe(500);
    expect(storedRecord(service, record.id).editVersion).toBe(1);

    expect(() =>
      service.updateReceivingRecord(
        record.id,
        { reason: "Stale editor save", packages: [{ id: cargo.id, price: 350 }], baseEditVersion: 0 },
        admin.id
      )
    ).toThrow(ConflictException);
    expect(internals(service).packages.find((pkg) => pkg.id === cargo.id)?.price).toBe(500);
  });

  test("attaching a DR photo bumps the record version", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const { record } = seedRecord(service);

    const result = service.attachReceivingDrPhoto(
      record.id,
      { drPhotoUrl: "https://example.test/dr-photo.jpg", reason: "Late DR attachment" },
      admin.id
    );
    expect(result.drPhotoUrl).toBe("https://example.test/dr-photo.jpg");
    expect(result.editVersion).toBe(1);
  });

  test("arrival verification bumps the record version only when the condition actually changes", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const { cargo, record } = seedRecord(service, { status: "Arrived" });

    // A condition correction at arrival verification is a change to
    // a field the receiving editor writes: the version moves.
    service.verifyArrivedCargo(cargo.id, { condition: "Damaged" }, admin.id);
    expect(internals(service).packages.find((pkg) => pkg.id === cargo.id)?.condition).toBe("Damaged");
    expect(storedRecord(service, record.id).editVersion).toBe(1);

    // A status-only verification writes no editor field: no bump, so
    // routine arrival work does not false-conflict a receiving editor.
    service.verifyArrivedCargo(cargo.id, {}, admin.id);
    expect(storedRecord(service, record.id).editVersion).toBe(1);
  });
});

describe("L21-F2 — the Prisma mapping carries editVersion both ways", () => {
  function fixtureState(receivingRecords: ReceivingRecord[]): ServiceState {
    return {
      sequences: [],
      customers: [],
      receivingRecords,
      receivingDrafts: [],
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

  test("a moved version round-trips; a legacy record gains no version field", () => {
    const moved = makeRecord(makePackage(), { editVersion: 3 });
    const legacyCargo = makePackage({
      id: "pkg_pr7b_legacy",
      packageNumber: "PKG-2026-11-000889",
      receivingRecordNumber: "RR-2026-11-000889",
      qrValue: "MTS:PKG:PKG-2026-11-000889"
    });
    const legacy = makeRecord(legacyCargo, { id: "rr_pr7b_legacy", packages: [] });
    const movedWithNoPackages = { ...moved, packages: [] as CargoPackage[] };

    const rows = stateToRows(fixtureState([movedWithNoPackages, legacy]));
    expect(rows.receivingRecords.find((row) => row.id === "rr_pr7b")?.editVersion).toBe(3);
    expect(rows.receivingRecords.find((row) => row.id === "rr_pr7b_legacy")?.editVersion).toBe(0);

    const roundTripped = rowsToState(rows);
    expect(roundTripped.receivingRecords?.find((entry) => entry.id === "rr_pr7b")?.editVersion).toBe(3);
    expect(roundTripped.receivingRecords?.find((entry) => entry.id === "rr_pr7b_legacy")?.editVersion).toBeUndefined();
  });
});
