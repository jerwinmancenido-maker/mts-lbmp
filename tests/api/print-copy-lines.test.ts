import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { LogisticsService, formatManilaPrintTimestamp } from "../../apps/api/src/modules/logistics.service";
import type {
  BillingInvoice,
  CargoPackage,
  PrintLog,
  ReceivingRecord,
  StaffUserRecord,
  Trip
} from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 follow-up — print/copy audit lines (L4-F4 / R13) and the
 * statement CSV's scoped totals (L4-F5 covers the CSV in
 * statement-export.test.ts; this file covers the paper).
 *
 * L4-F4: the document family's audit lines embedded raw UTC ISO
 * timestamps (the billing statement's line ran to 47 chars, the
 * manifest's to 48 — past the 42-column render width — and on Manila
 * paper the time read ~8 hours behind), while the receiving document
 * used a different format entirely ("1 / 11/21/2026, 22:14:38"). Now
 * every document composes its audit lines through ONE shared path —
 * peekPrintCopy + formatManilaPrintTimestamp — and renders the same
 * two lines:
 *
 *   Print: Printed 11/22/2026, 06:14:39
 *   Copy: 1
 *
 * The frozen instant below is L4's own evidence instant:
 * 2026-11-21T22:14:39.237Z is 06:14:39 in Manila the next day — the
 * run the layer filed as "prints as 22:14 UTC the previous day".
 */

const L4_INSTANT = "2026-11-21T22:14:39.237Z";
const L4_INSTANT_MANILA = "11/22/2026, 06:14:39";

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

const trip: Trip = {
  id: "trip_1",
  tripNumber: "TR-2026-11-000001",
  origin: "Daet",
  destination: "Naga",
  status: "Loading",
  isMixedTrip: false,
  vehicleDescription: "Isuzu Elf",
  driverName: "Fixture Driver",
  cargoPackageIds: [cargo.id],
  createdAt: "2026-11-11T00:00:00.000Z"
};

const invoice: BillingInvoice = {
  id: "bill_1",
  invoiceNumber: "BILL-2026-11-000001",
  customerId: "cust_1",
  customerName: "Fixture Customer",
  packageIds: [cargo.id],
  amountDue: 3600,
  amountPaid: 0,
  balance: 3600,
  dueRule: "Net 30",
  status: "Issued",
  createdAt: "2026-11-11T03:00:00.000Z",
  updatedAt: "2026-11-11T03:00:00.000Z"
};

type ServiceInternals = {
  packages: CargoPackage[];
  receivingRecords: ReceivingRecord[];
  trips: Trip[];
  billingInvoices: BillingInvoice[];
  printLogs: PrintLog[];
  customUsers: StaffUserRecord[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

function seededService() {
  const service = new LogisticsService();
  const state = internals(service);
  state.packages.push(cargo);
  state.receivingRecords.push(receiving);
  state.trips.push(trip);
  state.billingInvoices.push(invoice);
  state.customUsers.push({
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
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-print-copy-lines-"));
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(L4_INSTANT));
});

afterEach(() => {
  vi.useRealTimers();
});

function expectSharedAuditLines(text: string, action: "Printed" | "Reprinted", copyNumber: number) {
  expect(text).toContain(`Print: ${action} ${L4_INSTANT_MANILA}`);
  expect(text).toContain(`Copy: ${copyNumber}`);
  // No raw ISO timestamp anywhere on the paper, and no line runs past
  // the 42-column render width (the F4 overflow).
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  for (const line of text.split("\n")) {
    expect(line.length, `line exceeds 42 cols: ${JSON.stringify(line)}`).toBeLessThanOrEqual(42);
  }
}

describe("formatManilaPrintTimestamp — the one shared print-timestamp format", () => {
  test("renders a known UTC instant as the Manila wall-clock time", () => {
    // L4's evidence instant: filed as printing "22:14 UTC the previous
    // day" for a 06:14 PHT print. It now renders as the Manila time.
    expect(formatManilaPrintTimestamp(L4_INSTANT)).toBe(L4_INSTANT_MANILA);
    expect(formatManilaPrintTimestamp(new Date(L4_INSTANT))).toBe(L4_INSTANT_MANILA);
    expect(formatManilaPrintTimestamp("2026-11-12T01:02:03.456Z")).toBe("11/12/2026, 09:02:03");
  });

  test("midnight in Manila renders hour 00, never 24", () => {
    expect(formatManilaPrintTimestamp("2026-11-21T16:00:00.000Z")).toBe("11/22/2026, 00:00:00");
    expect(formatManilaPrintTimestamp("2026-11-21T04:00:00.000Z")).toBe("11/21/2026, 12:00:00");
  });
});

describe("print/copy audit lines — one shape across the document family (L4-F4)", () => {
  test("receiving slip", () => {
    const service = seededService();
    expectSharedAuditLines(service.renderReceivingSlip(cargo.id).text, "Printed", 1);
  });

  test("receiving document — the member that used to format differently", () => {
    const service = seededService();
    const text = service.renderReceivingDocument(receiving.id).text;
    expectSharedAuditLines(text, "Printed", 1);
    // The old shape ("Copy: 1 / 11/21/2026, 22:14:38") is gone.
    expect(text).not.toContain("Copy: 1 /");
  });

  test("loading manifest — the member whose audit line ran to 48 chars", () => {
    const service = seededService();
    expectSharedAuditLines(service.renderTripManifest(trip.id).text, "Printed", 1);
  });

  test("billing statement", () => {
    const service = seededService();
    expectSharedAuditLines(service.renderBillingStatement(invoice.id).text, "Printed", 1);
  });

  test("after a recorded hand-off, the re-render anticipates Reprinted / Copy 2 in the same format", () => {
    const service = seededService();
    const rendered = service.renderReceivingSlip(cargo.id);
    service.recordPrintHandoff({ ...rendered.print, layout: "80mm", outcome: "HandedOff" }, ownerUser);
    expectSharedAuditLines(service.renderReceivingSlip(cargo.id).text, "Reprinted", 2);
  });
});
