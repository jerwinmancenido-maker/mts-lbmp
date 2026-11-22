import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type {
  CargoPackage,
  DeliveryRecord,
  PaymentRecord,
  PrintLog,
  ReceivingRecord,
  StaffUserRecord
} from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 PR-8 — print document correctness (C-M9, C-M10).
 *
 * C-M9: the delivery receipt's rendered text used to carry a hardcoded
 * "DR-PREVIEW-…" document number while the print metadata — the value
 * recordPrintHandoff writes into the PrintLog — carried the real
 * "DR-…". The signed paper could never be matched back to the log.
 * These tests pin the whole chain: rendered text number === print
 * metadata number === the PrintLog row registered for that print.
 *
 * C-M10: the receiving document rounded item prices to whole pesos
 * (2750.50 printed as "P2751"), so its lines did not sum to its own
 * printed total. Pinned here through the service render as well as in
 * tests/printing/renderers.test.ts at the renderer level.
 *
 * Seeding follows tests/api/print-handoff.test.ts: a fresh
 * LogisticsService against a throwaway INIT_CWD, records pushed into
 * the service internals.
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
  status: "Delivered",
  unitPrice: 1800,
  price: 3600,
  qrValue: "MTS:PKG:PKG-2026-11-000001",
  photoUrls: [],
  createdAt: "2026-11-11T00:00:00.000Z"
};

const delivery: DeliveryRecord = {
  id: "del_1",
  cargoPackageId: cargo.id,
  status: "Delivered",
  deliveredTo: "Fixture Receiver",
  createdAt: "2026-11-11T01:00:00.000Z"
};

const payment: PaymentRecord = {
  id: "pay_1",
  cargoPackageId: cargo.id,
  amountDue: 3600,
  amountPaid: 3600,
  balance: 0,
  method: "Cash",
  collectionPoint: "Delivery",
  status: "Paid",
  createdAt: "2026-11-11T01:00:00.000Z"
};

const centavoCargoA: CargoPackage = {
  ...cargo,
  id: "pkg_2",
  packageNumber: "PKG-2026-11-000002",
  description: "L4 Alpha sewing machines",
  quantity: 2,
  unit: "box",
  price: 1500,
  qrValue: "MTS:PKG:PKG-2026-11-000002"
};

const centavoCargoB: CargoPackage = {
  ...cargo,
  id: "pkg_3",
  packageNumber: "PKG-2026-11-000003",
  description: "L4 Bravo textile rolls",
  quantity: 3,
  unit: "roll",
  price: 2750.5,
  qrValue: "MTS:PKG:PKG-2026-11-000003"
};

const receiving: ReceivingRecord = {
  id: "rr_1",
  recordNumber: "RR-2026-11-000001",
  customerId: "cust_1",
  customerName: "Fixture Customer",
  customerDrNumber: "DR-FIXTURE-1",
  destination: "Daet",
  packages: [centavoCargoA, centavoCargoB],
  createdAt: "2026-11-11T00:00:00.000Z"
};

type ServiceInternals = {
  packages: CargoPackage[];
  deliveries: DeliveryRecord[];
  payments: PaymentRecord[];
  receivingRecords: ReceivingRecord[];
  printLogs: PrintLog[];
  customUsers: StaffUserRecord[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

function seededService() {
  const service = new LogisticsService();
  internals(service).packages.push(cargo, centavoCargoA, centavoCargoB);
  internals(service).deliveries.push(delivery);
  internals(service).payments.push(payment);
  internals(service).receivingRecords.push(receiving);
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
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-print-correctness-"));
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

describe("delivery receipt document number (C-M9)", () => {
  test("the number printed on the receipt equals the number the print log registers for the same print", () => {
    const service = seededService();

    const rendered = service.renderDeliveryReceipt(cargo.id);

    // The print metadata is what recordPrintHandoff registers.
    expect(rendered.print.documentType).toBe("Delivery Receipt");
    expect(rendered.print.documentNumber).toBe("DR-PKG-2026-11-000001");
    // The paper itself: the receipt's number line (third line) is that
    // same registered number — no PREVIEW placeholder anywhere.
    expect(rendered.text.split("\n")[2]).toBe(rendered.print.documentNumber);
    expect(rendered.text).not.toContain("PREVIEW");

    const log = service.recordPrintHandoff(
      { ...rendered.print, layout: "80mm", outcome: "HandedOff" },
      ownerUser
    );

    expect(log.documentNumber).toBe("DR-PKG-2026-11-000001");
    expect(rendered.text.split("\n")[2]).toBe(log.documentNumber);
    expect(internals(service).printLogs).toHaveLength(1);
    expect(internals(service).printLogs[0]?.documentNumber).toBe(log.documentNumber);
  });
});

describe("receiving document prices (C-M10)", () => {
  test("item prices render to the centavo and sum to the document total", () => {
    const service = seededService();

    const rendered = service.renderReceivingDocument(receiving.id);

    expect(rendered.text).toContain("/ P1500");
    expect(rendered.text).toContain("/ P2750.50");
    expect(rendered.text).not.toContain("P2751");
    expect(rendered.text).toContain("Total: PHP 4250.50");
  });
});
