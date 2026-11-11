import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type {
  CargoPackage,
  Customer,
  ReceivingIntakeTask,
  ReceivingRecord
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 4 PR 1 — three live data-correctness fixes from the Phase 4 audit:
 *  A6: a `local-photo://…` placeholder (a photo still queued on a device)
 *      must never be persisted into a server record. Save paths reject it,
 *      the wall-QR intake submits the bare local id as a pending reference
 *      (drPhotoLocalId), and resolveReceivingIntakeQueuedPhoto attaches the
 *      real URL when the queued photo finishes uploading — the call the web
 *      clients make from their queued-photo drains.
 *  B5a: the intake duplicateKey window is the Asia/Manila business day, not
 *      the UTC date (which flipped at 08:00 PHT).
 *  B5b: a merged duplicate intake submission is preserved in full on the
 *      surviving task's duplicateNotes and fills fields the original lacked;
 *      it never overwrites non-empty original fields.
 *
 * Each test builds a fresh LogisticsService against a throwaway INIT_CWD so
 * the JSON state store writes into a temp dir, not the repo's dev data.
 */

type ServiceInternals = {
  customers: Customer[];
  packages: CargoPackage[];
  receivingRecords: ReceivingRecord[];
  receivingIntakeTasks: ReceivingIntakeTask[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const customer: Customer = {
  id: "cust_phase4",
  businessName: "Phase4 Fixture Customer",
  status: "Active",
  billingTerm: "Custom",
  contacts: []
};

const cargo: CargoPackage = {
  id: "pkg_phase4",
  packageNumber: "PKG-2026-11-000101",
  receivingRecordNumber: "RR-2026-11-000101",
  customerId: "cust_phase4",
  customerName: "Phase4 Fixture Customer",
  description: "Rice sacks",
  quantity: 2,
  unit: "sack",
  destination: "Daet",
  handlingBranchId: "daet",
  handlingBranchName: "Daet",
  deliveryType: "Customer pickup at branch",
  condition: "Good",
  status: "Ready for Delivery",
  price: 1000,
  qrValue: "MTS:PKG:PKG-2026-11-000101",
  photoUrls: [],
  createdAt: "2026-11-11T00:00:00.000Z"
};

const receiving: ReceivingRecord = {
  id: "rr_phase4",
  recordNumber: "RR-2026-11-000101",
  customerId: "cust_phase4",
  customerName: "Phase4 Fixture Customer",
  customerDrNumber: "DR-PHASE4-1",
  destination: "Daet",
  packages: [cargo],
  createdAt: "2026-11-11T00:00:00.000Z"
};

function seededService() {
  const service = new LogisticsService();
  internals(service).customers.push(customer);
  internals(service).packages.push(cargo);
  internals(service).receivingRecords.push(receiving);
  return service;
}

const intakeInput = {
  warehouseCode: "origin",
  customerName: "Phase4 Intake Co",
  customerDrNumber: "DR-INTAKE-1",
  destinationBranch: "Daet"
};

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-phase4-"));
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

afterEach(() => {
  vi.useRealTimers();
});

describe("A6 — local-photo:// is rejected at save paths", () => {
  test("public intake rejects a local-photo:// DR photo URL and creates nothing", () => {
    const service = seededService();

    expect(() =>
      service.createReceivingIntakeTask({ ...intakeInput, drPhotoUrl: "local-photo://local-photo-1" })
    ).toThrow(/local-photo/);
    expect(
      internals(service).receivingIntakeTasks.filter((task) => task.customerNameTyped === intakeInput.customerName)
    ).toHaveLength(0);
  });

  test("receiving create rejects a local-photo:// DR photo and package photo", () => {
    const service = seededService();
    const base = {
      customerId: customer.id,
      destination: "Daet",
      packages: [{ description: "Rice sacks", deliveryType: "Customer pickup at branch" as const }]
    };

    expect(() => service.createReceiving({ ...base, drPhotoUrl: "local-photo://local-photo-2" })).toThrow(/local-photo/);
    expect(() =>
      service.createReceiving({ ...base, packages: [{ ...base.packages[0], photoUrls: ["local-photo://local-photo-3"] }] })
    ).toThrow(/local-photo/);
    expect(internals(service).receivingRecords.filter((record) => record.id !== receiving.id)).toHaveLength(0);
  });

  test("DR photo attach, draft create, delivery completion and expense receipt reject local-photo:// values", () => {
    const service = seededService();

    expect(() => service.attachReceivingDrPhoto(receiving.id, { drPhotoUrl: "local-photo://local-photo-4" })).toThrow(
      /local-photo/
    );
    expect(internals(service).receivingRecords.find((record) => record.id === receiving.id)?.drPhotoUrl).toBeUndefined();

    expect(() =>
      service.createReceivingDraft({ formState: {}, productLines: [], drPhotoUrl: "local-photo://local-photo-5" })
    ).toThrow(/local-photo/);

    expect(() =>
      service.completeDelivery({
        cargoPackageId: cargo.id,
        deliveredTo: "Fixture Receiver",
        deliveryPhotoUrl: "local-photo://local-photo-6"
      })
    ).toThrow(/local-photo/);

    expect(() =>
      service.createExpense({ category: "Fuel", amount: 500, receiptUrl: "local-photo://local-photo-7" })
    ).toThrow(/local-photo/);
  });
});

describe("A6 — queued photo resolution attaches the real URL to the record", () => {
  test("intake created with a pending local reference gets the server URL on resolve, exactly once", () => {
    const service = seededService();

    const created = service.createReceivingIntakeTask({ ...intakeInput, drPhotoLocalId: "local-photo-111" });
    expect(created.duplicate).toBe(false);
    expect(created.task.drPhotoUrl).toBeUndefined();
    expect(created.task.drPhotoLocalId).toBe("local-photo-111");

    // This is the call the web queued-photo drains make after the upload
    // finishes (queue → upload → record updated).
    const resolved = service.resolveReceivingIntakeQueuedPhoto({
      localPhotoId: "local-photo-111",
      fileUrl: "/uploads/dr-111.jpg"
    });
    expect(resolved.resolvedCount).toBe(1);
    expect(created.task.drPhotoUrl).toBe("/uploads/dr-111.jpg");
    expect(created.task.drPhotoLocalId).toBeUndefined();

    const again = service.resolveReceivingIntakeQueuedPhoto({
      localPhotoId: "local-photo-111",
      fileUrl: "/uploads/dr-111.jpg"
    });
    expect(again.resolvedCount).toBe(0);
  });

  test("resolve accepts the full local-photo:// form of the id and rejects a local-photo:// file URL", () => {
    const service = seededService();
    const created = service.createReceivingIntakeTask({ ...intakeInput, drPhotoLocalId: "local-photo-222" });

    expect(() =>
      service.resolveReceivingIntakeQueuedPhoto({ localPhotoId: "local-photo-222", fileUrl: "local-photo://local-photo-222" })
    ).toThrow(/local-photo/);
    expect(created.task.drPhotoUrl).toBeUndefined();

    const resolved = service.resolveReceivingIntakeQueuedPhoto({
      localPhotoId: "local-photo://local-photo-222",
      fileUrl: "/uploads/dr-222.jpg"
    });
    expect(resolved.resolvedCount).toBe(1);
    expect(created.task.drPhotoUrl).toBe("/uploads/dr-222.jpg");
  });

  test("a duplicate submission's queued photo resolves onto its duplicate note and the task's extra photos", () => {
    const service = seededService();
    const created = service.createReceivingIntakeTask({ ...intakeInput, drPhotoUrl: "/uploads/first.jpg" });

    const duplicate = service.createReceivingIntakeTask({ ...intakeInput, drPhotoLocalId: "local-photo-333" });
    expect(duplicate.duplicate).toBe(true);
    expect(created.task.extraPhotoUrls).toEqual([]); // primary photo is drPhotoUrl, not an extra
    expect(created.task.duplicateNotes).toHaveLength(1);
    expect(created.task.duplicateNotes[0]?.photoLocalId).toBe("local-photo-333");
    expect(created.task.duplicateNotes[0]?.photoUrl).toBeUndefined();

    const resolved = service.resolveReceivingIntakeQueuedPhoto({
      localPhotoId: "local-photo-333",
      fileUrl: "/uploads/duplicate.jpg"
    });
    expect(resolved.resolvedCount).toBe(1);
    expect(created.task.duplicateNotes[0]?.photoUrl).toBe("/uploads/duplicate.jpg");
    expect(created.task.duplicateNotes[0]?.photoLocalId).toBeUndefined();
    expect(created.task.extraPhotoUrls).toContain("/uploads/duplicate.jpg");
    expect(created.task.drPhotoUrl).toBe("/uploads/first.jpg");
  });

  test("resolution flows through to the receiving record when the task was already converted", () => {
    const service = seededService();
    const created = service.createReceivingIntakeTask({ ...intakeInput, drPhotoLocalId: "local-photo-444" });
    service.markReceivingIntakeConverted(created.task.id, { receivingId: receiving.id });
    expect(receiving.drPhotoUrl).toBeUndefined();

    const resolved = service.resolveReceivingIntakeQueuedPhoto({
      localPhotoId: "local-photo-444",
      fileUrl: "/uploads/late.jpg"
    });
    expect(resolved.resolvedCount).toBe(1);
    expect(created.task.drPhotoUrl).toBe("/uploads/late.jpg");
    expect(receiving.drPhotoUrl).toBe("/uploads/late.jpg");
  });
});

describe("B5a — intake duplicateKey follows the Asia/Manila business day", () => {
  test("07:30 and 08:30 PHT on the same Manila day share one key (the UTC date flips between them)", () => {
    vi.useFakeTimers();
    const service = seededService();

    // 2026-11-11T23:30:00Z is 07:30 PHT on 2026-11-12; the UTC date is 11-11.
    vi.setSystemTime(new Date("2026-11-11T23:30:00.000Z"));
    const first = service.createReceivingIntakeTask({ ...intakeInput });
    expect(first.duplicate).toBe(false);
    expect(first.task.duplicateKey.endsWith("2026-11-12")).toBe(true);

    // 2026-11-12T00:30:00Z is 08:30 PHT on 2026-11-12 — same Manila day,
    // different UTC date. With the old UTC key this created a second task.
    vi.setSystemTime(new Date("2026-11-12T00:30:00.000Z"));
    const second = service.createReceivingIntakeTask({ ...intakeInput });
    expect(second.duplicate).toBe(true);
    expect(second.task.id).toBe(first.task.id);
    expect(second.task.duplicateCount).toBe(2);
  });

  test("submissions either side of Manila midnight are not duplicates", () => {
    vi.useFakeTimers();
    const service = seededService();

    // 2026-11-11T15:59:59Z is 23:59:59 PHT on 2026-11-11.
    vi.setSystemTime(new Date("2026-11-11T15:59:59.000Z"));
    const first = service.createReceivingIntakeTask({ ...intakeInput });
    expect(first.task.duplicateKey.endsWith("2026-11-11")).toBe(true);

    // 2026-11-11T16:00:01Z is 00:00:01 PHT on 2026-11-12 — a new business day.
    vi.setSystemTime(new Date("2026-11-11T16:00:01.000Z"));
    const second = service.createReceivingIntakeTask({ ...intakeInput });
    expect(second.duplicate).toBe(false);
    expect(second.task.duplicateKey.endsWith("2026-11-12")).toBe(true);
    expect(
      internals(service).receivingIntakeTasks.filter((task) => task.customerNameTyped === intakeInput.customerName)
    ).toHaveLength(2);
  });
});

describe("B5b — merged duplicates preserve the incoming submission", () => {
  test("a duplicate fills fields the original lacked and preserves its quantity in the duplicate note", () => {
    const service = seededService();
    const first = service.createReceivingIntakeTask({ ...intakeInput, quantity: 2 });
    expect(first.task.consigneeName).toBeUndefined();
    expect(first.task.itemDescription).toBeUndefined();
    expect(first.task.quantity).toBe(2);

    const duplicate = service.createReceivingIntakeTask({
      ...intakeInput,
      consigneeName: "Maria Receiver",
      itemDescription: "Rice sacks",
      quantity: 5,
      dropOffPhone: "09171234567"
    });

    expect(duplicate.duplicate).toBe(true);
    expect(first.task.consigneeName).toBe("Maria Receiver");
    expect(first.task.itemDescription).toBe("Rice sacks");
    expect(first.task.dropOffPhone).toBe("09171234567");
    // The original quantity stands; the duplicate's quantity is preserved in
    // the structured submission instead of being silently dropped.
    expect(first.task.quantity).toBe(2);
    expect(first.task.duplicateNotes).toHaveLength(1);
    expect(first.task.duplicateNotes[0]?.submission?.quantity).toBe(5);
    expect(first.task.duplicateNotes[0]?.submission?.consigneeName).toBe("Maria Receiver");
    expect(first.task.duplicateNotes[0]?.submission?.itemDescription).toBe("Rice sacks");
  });

  test("a conflicting duplicate never overwrites non-empty original fields", () => {
    const service = seededService();
    const first = service.createReceivingIntakeTask({
      ...intakeInput,
      consigneeName: "Original Receiver",
      itemDescription: "Original Item",
      deliveryArea: "Original Area"
    });

    const duplicate = service.createReceivingIntakeTask({
      ...intakeInput,
      consigneeName: "Other Person",
      itemDescription: "Other Item",
      deliveryArea: "Other Area"
    });

    expect(duplicate.duplicate).toBe(true);
    expect(first.task.consigneeName).toBe("Original Receiver");
    expect(first.task.itemDescription).toBe("Original Item");
    expect(first.task.deliveryArea).toBe("Original Area");
    // The conflicting values are still on record in the duplicate note.
    expect(first.task.duplicateNotes[0]?.submission?.consigneeName).toBe("Other Person");
    expect(first.task.duplicateNotes[0]?.submission?.itemDescription).toBe("Other Item");
  });

  test("even a bare re-submission records a structured duplicate note", () => {
    const service = seededService();
    const first = service.createReceivingIntakeTask({ ...intakeInput });

    const duplicate = service.createReceivingIntakeTask({ ...intakeInput });

    expect(duplicate.duplicate).toBe(true);
    expect(first.task.duplicateCount).toBe(2);
    expect(first.task.duplicateNotes).toHaveLength(1);
    expect(first.task.duplicateNotes[0]?.submission?.customerName).toBe(intakeInput.customerName);
    expect(first.task.duplicateNotes[0]?.submission?.customerDrNumber).toBe(intakeInput.customerDrNumber);
  });
});

describe("Prisma state mapping round-trip", () => {
  test("drPhotoLocalId and structured duplicate notes survive state → rows → state", () => {
    const task: ReceivingIntakeTask = {
      id: "intake_phase4",
      intakeNumber: "INTAKE-2026-11-000001",
      status: "Pending Review",
      source: "Wall QR",
      warehouseCode: "origin",
      duplicateKey: "origin|phase4 intake co|dr-intake-1|daet|2026-11-12",
      duplicateCount: 2,
      customerNameTyped: "Phase4 Intake Co",
      customerMatched: false,
      customerDrNumber: "DR-INTAKE-1",
      consigneeName: "Maria Receiver",
      receiverMatched: false,
      destinationBranch: "Daet",
      productMatched: false,
      quantity: 2,
      unit: "pcs",
      drPhotoLocalId: "local-photo-999",
      extraPhotoUrls: [],
      duplicateNotes: [
        {
          id: "intake_note_phase4",
          photoLocalId: "local-photo-998",
          submission: { customerName: "Phase4 Intake Co", consigneeName: "Maria Receiver", quantity: 5 },
          createdAt: "2026-11-12T00:30:00.000Z"
        }
      ],
      createdAt: "2026-11-12T00:00:00.000Z",
      updatedAt: "2026-11-12T00:30:00.000Z"
    };
    const state = {
      sequences: [],
      customers: [],
      receivingRecords: [],
      receivingDrafts: [],
      receivingIntakeTasks: [task],
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
        address: "Configured by owner",
        phone: "Configured by owner",
        email: "Configured by owner"
      },
      branches: [],
      paymentMethods: [],
      expenseCategories: [],
      userBranchAccessOverrides: {}
    } as unknown as ServiceState;

    const restored = rowsToState(stateToRows(state));

    expect(restored.receivingIntakeTasks).toHaveLength(1);
    expect(restored.receivingIntakeTasks[0]?.drPhotoLocalId).toBe("local-photo-999");
    expect(restored.receivingIntakeTasks[0]?.duplicateNotes[0]?.photoLocalId).toBe("local-photo-998");
    expect(restored.receivingIntakeTasks[0]?.duplicateNotes[0]?.submission?.quantity).toBe(5);
    expect(restored.receivingIntakeTasks[0]?.duplicateNotes[0]?.submission?.consigneeName).toBe("Maria Receiver");
  });
});
