import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type {
  CargoPackage,
  HardwareTestRecord,
  PrintLog,
  ReceivingRecord,
  ServiceAuditLog,
  StaffUserRecord
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 3 PR 2 (G4/G5): PrintLog rows are written at print HAND-OFF time by
 * recordPrintHandoff — never at render time — and carry the real user, the
 * client-reported outcome, and copy numbers counted over hand-offs. The
 * printer diagnostic persists a HardwareTestRecord whose printer result is
 * derived from measured checks.
 *
 * Each test builds a fresh LogisticsService against a throwaway INIT_CWD so
 * the JSON state store writes into a temp dir, not the repo's dev data.
 */

const cargo: CargoPackage = {
  id: "pkg_1",
  packageNumber: "PKG-2026-11-000001",
  receivingRecordNumber: "RR-2026-11-000001",
  customerId: "cust_1",
  customerName: "Fixture Customer",
  description: "Angle bar",
  quantity: 2,
  unit: "bundle",
  destination: "Daet",
  handlingBranchId: "daet",
  handlingBranchName: "Daet",
  deliveryType: "Deliver to consignee",
  consigneeName: "Fixture Receiver",
  condition: "Good",
  status: "Waiting for Loading",
  unitPrice: 1800,
  price: 3600,
  qrValue: "MTS:PKG:PKG-2026-11-000001",
  photoUrls: [],
  createdAt: "2026-11-11T00:00:00.000Z"
};

const receiving: ReceivingRecord = {
  id: "rr_1",
  recordNumber: "RR-2026-11-000001",
  customerId: "cust_1",
  customerName: "Fixture Customer",
  customerDrNumber: "DR-FIXTURE-1",
  destination: "Daet",
  packages: [cargo],
  createdAt: "2026-11-11T00:00:00.000Z"
};

type ServiceInternals = {
  packages: CargoPackage[];
  receivingRecords: ReceivingRecord[];
  printLogs: PrintLog[];
  auditLogs: ServiceAuditLog[];
  hardwareTests: HardwareTestRecord[];
  customUsers: StaffUserRecord[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

function seededService() {
  const service = new LogisticsService();
  internals(service).packages.push(cargo);
  internals(service).receivingRecords.push(receiving);
  // Phase 5 P5-2: the hand-off's printedByName resolves from the user
  // store. This fixture used to lean on the hard-coded "Daet Owner Demo"
  // account; that account is deleted, so the test seeds the equivalent
  // real user record itself.
  internals(service).customUsers.push({
    id: "user_daet_owner",
    name: "Daet Owner Demo",
    email: "daet.owner@example.test",
    role: "Daet Owner",
    branchAccess: "Daet",
    status: "Active"
  });
  return service;
}

const ownerUser = { id: "user_daet_owner", role: "Daet Owner", branchAccess: "Daet" };

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-print-handoff-"));
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

describe("print hand-off logging (G4)", () => {
  test("rendering a document writes NO PrintLog row and no print audit entry", () => {
    const service = seededService();

    const slip = service.renderReceivingSlip(cargo.id);
    const label = service.renderQrLabel(cargo.id);
    const document = service.renderReceivingDocument(receiving.id);

    expect(slip.text).toContain("RECEIVING SLIP");
    expect(slip.print).toEqual({
      documentType: "Receiving Slip",
      documentNumber: cargo.packageNumber,
      relatedEntityType: "CargoPackage",
      relatedEntityId: cargo.id,
      layout: "80mm"
    });
    expect(label.print.documentType).toBe("QR Label");
    expect(document.print).toEqual({
      documentType: "Receiving Document",
      documentNumber: receiving.recordNumber,
      relatedEntityType: "ReceivingRecord",
      relatedEntityId: receiving.id,
      layout: "80mm"
    });
    // The copy line printed on the document anticipates copy 1 without
    // persisting anything.
    expect(slip.text).toContain("Printed ");
    expect(internals(service).printLogs).toHaveLength(0);
    expect(
      internals(service).auditLogs.filter((entry) => entry.action.startsWith("document.print"))
    ).toHaveLength(0);
  });

  test("hand-off records the real user, device, layout and outcome; first hand-off is Printed copy 1, the next is Reprinted copy 2", () => {
    const service = seededService();
    const rendered = service.renderReceivingSlip(cargo.id);

    const first = service.recordPrintHandoff(
      { ...rendered.print, layout: "80mm", deviceName: "NB80 Android POS - Receiving 1", outcome: "HandedOff" },
      ownerUser
    );

    expect(first.printedByName).toBe("Daet Owner Demo");
    expect(first.action).toBe("Printed");
    expect(first.copyNumber).toBe(1);
    expect(first.outcome).toBe("HandedOff");
    expect(first.deviceName).toBe("NB80 Android POS - Receiving 1");
    expect(first.layout).toBe("80mm");
    expect(first.reason).toBeUndefined();

    const second = service.recordPrintHandoff(
      { ...rendered.print, layout: "58mm", outcome: "HandedOff" },
      ownerUser
    );

    expect(second.action).toBe("Reprinted");
    expect(second.copyNumber).toBe(2);
    expect(second.deviceName).toBeUndefined();
    expect(internals(service).printLogs).toHaveLength(2);

    // Re-rendering now anticipates copy 3 on the printed copy line.
    const rerendered = service.renderReceivingSlip(cargo.id);
    expect(rerendered.text).toContain("Reprinted ");

    const auditActions = internals(service)
      .auditLogs.filter((entry) => entry.action.startsWith("document."))
      .map((entry) => entry.action);
    expect(auditActions).toEqual(["document.printed", "document.reprinted"]);
  });

  test("a failed hand-off is recorded with its outcome and the client error text", () => {
    const service = seededService();
    const rendered = service.renderQrLabel(cargo.id);

    const failed = service.recordPrintHandoff(
      {
        ...rendered.print,
        layout: "80mm",
        outcome: "Failed",
        error: "NB80 printer gateway is not available."
      },
      ownerUser
    );

    expect(failed.outcome).toBe("Failed");
    expect(failed.reason).toBe("NB80 printer gateway is not available.");
    expect(failed.printedByName).toBe("Daet Owner Demo");
    expect(internals(service).printLogs).toHaveLength(1);
    const audit = internals(service).auditLogs.find((entry) => entry.action === "document.printFailed");
    expect(audit?.reason).toBe("NB80 printer gateway is not available.");
  });

  test("a hand-off for an unknown entity is rejected instead of logging garbage", () => {
    const service = seededService();

    expect(() =>
      service.recordPrintHandoff(
        {
          documentType: "QR Label",
          documentNumber: "PKG-UNKNOWN",
          relatedEntityType: "CargoPackage",
          relatedEntityId: "pkg_missing",
          layout: "80mm",
          outcome: "HandedOff"
        },
        ownerUser
      )
    ).toThrow();
    expect(internals(service).printLogs).toHaveLength(0);
  });

  test("PrintLog outcome survives the Prisma state mapping round-trip", () => {
    const log: PrintLog = {
      id: "prt_1",
      documentType: "QR Label",
      documentNumber: cargo.packageNumber,
      relatedEntityType: "CargoPackage",
      relatedEntityId: cargo.id,
      action: "Printed",
      reason: "NB80 printer gateway is not available.",
      outcome: "Failed",
      printedByName: "Daet Owner Demo",
      deviceName: "NB80 Android POS - Receiving 1",
      layout: "80mm",
      copyNumber: 1,
      createdAt: "2026-11-11T04:00:00.000Z"
    };
    const state = {
      sequences: [],
      customers: [],
      receivingRecords: [],
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
      printLogs: [log],
      customUsers: [],
      idempotencyRecords: [],
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

    expect(restored.printLogs).toHaveLength(1);
    expect(restored.printLogs[0]?.outcome).toBe("Failed");
    expect(restored.printLogs[0]?.reason).toBe("NB80 printer gateway is not available.");
    expect(restored.printLogs[0]?.printedByName).toBe("Daet Owner Demo");
  });
});

describe("printer diagnostic persistence (G5)", () => {
  test("an all-pass diagnostic persists a Pass record with the check breakdown in notes", () => {
    const service = seededService();

    const record = service.recordPrinterDiagnostic({
      deviceName: "NB80 Android POS - Receiving 1",
      checks: [
        { name: "Native printer plugin", status: "Pass", detail: "Plugin responded" },
        { name: "NB80 gateway route", status: "Pass", detail: "Gateway activity resolved" },
        { name: "Test payload hand-off", status: "Pass", detail: "Gateway intent launched" }
      ]
    });

    expect(record.printerResult).toBe("Pass");
    expect(record.deviceName).toBe("NB80 Android POS - Receiving 1");
    expect(record.notes).toContain("Native printer plugin: Pass — Plugin responded");
    expect(record.notes).toContain("Test payload hand-off: Pass");
    expect(record.scannerResult).toBe("Not Tested");
    expect(service.listHardwareTests()).toHaveLength(1);
    expect(service.listHardwareTests()[0]?.id).toBe(record.id);
  });

  test("a diagnostic with a failed check persists Fail with the error in the breakdown", () => {
    const service = seededService();

    const record = service.recordPrinterDiagnostic({
      deviceName: "NB80 Android POS - Receiving 1",
      checks: [
        {
          name: "Native printer plugin",
          status: "Fail",
          detail: "Browser/PWA context — the NyxPrinter plugin exists only inside the Android APK"
        },
        { name: "NB80 gateway route", status: "Fail", detail: "Not checked — no native platform" },
        { name: "Test payload hand-off", status: "Fail", detail: "Not attempted — no native platform" }
      ]
    });

    expect(record.printerResult).toBe("Fail");
    expect(record.notes).toContain("Native printer plugin: Fail — Browser/PWA context");
    expect(service.listHardwareTests()).toHaveLength(1);
  });
});
