import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AuthGuard } from "../../apps/api/src/modules/auth.guard";
import { LogisticsController } from "../../apps/api/src/modules/logistics.controller";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { hashSecret, verifyAuthToken } from "../../apps/api/src/modules/security";
import type {
  BillingInvoice,
  CargoPackage,
  Customer,
  DeliveryRecord,
  PaymentRecord,
  StaffUserRecord
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 6 P6-3 — statement export (CSV).
 *
 * What is being proven:
 * - the invoice CSV's exact bytes against fixture state: BOM, CRLF,
 *   the header block (invoice number / customer / issued + due dates /
 *   DERIVED status / terms), RFC 4180 escaping of a description with
 *   commas, quotes and an embedded newline, and a TOTAL row that is
 *   exactly the column sums (an overpaid line shows its credit instead
 *   of being clamped away);
 * - the customer CSV is the /balance payload in file form: same rows,
 *   same due dates, same aging, same outstanding — because both are
 *   produced from getCustomerBalance, and this test compares them
 *   field by field so a future second implementation would fail here;
 * - branch scoping is existence-hiding on both endpoints, exactly like
 *   the reads they mirror (other branch → the same 404 as missing);
 * - the permission split: the invoice CSV is documents.print (the
 *   printed statement's gate — Delivery Staff passes it), the customer
 *   CSV is the balance any-of pair (reports.view OR customers.manage —
 *   Delivery Staff, holding neither, is refused).
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  customers: Customer[];
  packages: CargoPackage[];
  payments: PaymentRecord[];
  deliveries: DeliveryRecord[];
  billingInvoices: BillingInvoice[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

/** 2026-11-12, 10:00 in Manila — "today" for the balance/aging assertions. */
const NOW = new Date("2026-11-12T02:00:00.000Z");

const CUSTOMER_ID = "cust_p63";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    businessName: "P6-3 Fixture, Inc.",
    status: "Active",
    billingTerm: "Net 30",
    billingTermDays: 30,
    ...overrides
  };
}

let pkgCounter = 0;
function makePackage(overrides: Partial<CargoPackage> = {}): CargoPackage {
  pkgCounter += 1;
  const number = `PKG-2026-11-${String(pkgCounter).padStart(6, "0")}`;
  return {
    id: `pkg_p63_${pkgCounter}`,
    packageNumber: number,
    receivingRecordNumber: "RR-2026-11-000001",
    customerId: CUSTOMER_ID,
    customerName: "P6-3 Fixture, Inc.",
    productId: "prod_p63",
    description: "Rebar",
    quantity: 1,
    unit: "pcs",
    destination: "Daet",
    handlingBranchId: "daet",
    handlingBranchName: "Daet",
    deliveryType: "Deliver to consignee",
    condition: "Good",
    status: "Delivered",
    price: 1000,
    qrValue: `MTS:PKG:${number}`,
    photoUrls: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides
  };
}

function makeDelivery(cargoPackageId: string, createdAt: string): DeliveryRecord {
  return { id: `del_${cargoPackageId}`, cargoPackageId, status: "Delivered", deliveredTo: "Fixture Receiver", createdAt };
}

let payCounter = 0;
function makePayment(cargoPackageId: string, amountPaid: number): PaymentRecord {
  payCounter += 1;
  return {
    id: `pay_p63_${payCounter}`,
    cargoPackageId,
    amountDue: 0,
    amountPaid,
    balance: 999999,
    method: "Cash",
    collectionPoint: "Delivery",
    status: "Partially Paid",
    createdAt: "2026-11-11T00:00:00.000Z"
  };
}

function seededService(customer: Customer = makeCustomer()) {
  const service = new LogisticsService();
  internals(service).customers.push(customer);
  return service;
}

/**
 * One invoice over three packages, seeded as a stored record (so its
 * number/dates are deterministic) with deliberately stale creation
 * snapshots — the CSV must show the LIVE derivation, never the 1s.
 * Lines: A due 1000 paid 700 (partial), B due 500 paid 0, C due 200
 * paid 250 (overpaid — a credit line).
 */
function invoiceFixture() {
  const service = seededService();
  const state = internals(service);
  const pkgA = makePackage({ description: "Steel pipe, 2\" dia\nGrade A", consigneeName: "Juan Dela Cruz", price: 1000 });
  const pkgB = makePackage({ description: "Cement bags", price: 500 });
  const pkgC = makePackage({ description: "Sand", price: 200 });
  state.packages.push(pkgA, pkgB, pkgC);
  state.deliveries.push(makeDelivery(pkgA.id, "2026-11-04T02:00:00.000Z"), makeDelivery(pkgB.id, "2026-11-06T02:00:00.000Z"));
  state.payments.push(makePayment(pkgA.id, 400), makePayment(pkgA.id, 300), makePayment(pkgC.id, 250));
  const invoice: BillingInvoice = {
    id: "bill_p63",
    invoiceNumber: "BILL-2026-11-000123",
    customerId: CUSTOMER_ID,
    customerName: "P6-3 Fixture, Inc.",
    packageIds: [pkgA.id, pkgB.id, pkgC.id],
    amountDue: 1,
    amountPaid: 1,
    balance: 1,
    dueRule: "Net 30",
    status: "Issued",
    dueDate: "2026-12-04T00:00:00.000+08:00",
    createdAt: "2026-11-05T02:00:00.000Z",
    updatedAt: "2026-11-05T02:00:00.000Z"
  };
  state.billingInvoices.push(invoice);
  return { service, invoice, pkgA, pkgB, pkgC };
}

describe("invoice statement CSV", () => {
  test("exact bytes: BOM, header block, escaping, live amounts, footing totals", () => {
    const { service, pkgA, pkgB, pkgC } = invoiceFixture();
    const { filename, csv } = service.getBillingInvoiceStatementCsv("bill_p63", undefined);

    expect(filename).toBe("invoice-BILL-2026-11-000123.csv");
    const expected =
      "\uFEFF" +
      [
        "Invoice Number,BILL-2026-11-000123",
        'Customer,"P6-3 Fixture, Inc."',
        "Issued Date,2026-11-05",
        "Due Date,2026-12-04",
        // Derived live: due 1700, paid 950, balance 750, due date in the
        // future → Partially Paid. The stored snapshots (1/1/1) and the
        // stored "Issued" never reach the file.
        "Status,Partially Paid",
        "Terms,Net 30",
        "",
        "Package Number,Description,Consignee / Destination,Delivery Date,Amount Due,Amount Paid,Balance",
        `${pkgA.packageNumber},"Steel pipe, 2"" dia\nGrade A",Juan Dela Cruz / Daet,2026-11-04,1000.00,700.00,300.00`,
        `${pkgB.packageNumber},Cement bags,Daet,2026-11-06,500.00,0.00,500.00`,
        // No delivery record → no delivery date; overpaid → credit line.
        `${pkgC.packageNumber},Sand,Daet,,200.00,250.00,-50.00`,
        "TOTAL,,,,1700.00,950.00,750.00"
      ].join("\r\n") +
      "\r\n";
    expect(csv).toBe(expected);
  });

  test("the TOTAL row is exactly the column sums of the lines above it", () => {
    const { service } = invoiceFixture();
    const { csv } = service.getBillingInvoiceStatementCsv("bill_p63", undefined);
    // Split on CRLF rows; the one quoted field with a bare \n stays
    // inside its row. Money columns are the last three of each line.
    const rows = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    const headerIndex = rows.findIndex((row) => row.startsWith("Package Number,"));
    const totalRow = rows[rows.length - 1].split(",");
    const lineRows = rows.slice(headerIndex + 1, rows.length - 1).map((row) => {
      // No money cell contains a comma (plain numbers), so the last
      // three comma-separated cells are due/paid/balance even when an
      // earlier quoted field does.
      const cells = row.split(",");
      return cells.slice(-3).map(Number);
    });
    const sums = [0, 1, 2].map((col) => Math.round(lineRows.reduce((sum, row) => sum + row[col], 0) * 100) / 100);
    expect(totalRow[0]).toBe("TOTAL");
    expect(totalRow.slice(-3).map(Number)).toEqual(sums);
    expect(sums).toEqual([1700, 950, 750]);
  });

  test("other-branch caller and missing invoice answer the same 404", () => {
    const { service } = invoiceFixture();
    const nagaCaller = { id: "user_p63_naga", role: "Naga Owner", branchAccess: "Naga" };
    expect(() => service.getBillingInvoiceStatementCsv("bill_p63", nagaCaller)).toThrow("Billing invoice not found");
    expect(() => service.getBillingInvoiceStatementCsv("bill_missing", undefined)).toThrow("Billing invoice not found");
    // The unrestricted caller still gets the file.
    expect(service.getBillingInvoiceStatementCsv("bill_p63", undefined).csv).toContain("BILL-2026-11-000123");
  });
});

/** Balance fixture shared by the payload-parity tests (Net 7 terms). */
function balanceFixture() {
  const service = seededService(makeCustomer({ businessName: "P6-3 Balance Customer", billingTermDays: 7, billingTerm: "Net 7" }));
  const state = internals(service);
  const owingCurrent = makePackage({ customerName: "P6-3 Balance Customer", description: "Rebar, 10mm", price: 1000 });
  const owingOld = makePackage({ customerName: "P6-3 Balance Customer", description: "Cement", price: 500 });
  const paidInFull = makePackage({ customerName: "P6-3 Balance Customer", description: "Gravel", price: 2000 });
  state.packages.push(owingCurrent, owingOld, paidInFull);
  state.deliveries.push(
    makeDelivery(owingCurrent.id, "2026-11-10T02:00:00.000Z"),
    makeDelivery(owingOld.id, "2026-10-01T02:00:00.000Z"),
    makeDelivery(paidInFull.id, "2026-11-01T02:00:00.000Z")
  );
  state.payments.push(makePayment(owingCurrent.id, 700), makePayment(paidInFull.id, 2000));
  return { service, owingCurrent, owingOld, paidInFull };
}

describe("customer statement CSV", () => {
  test("rows match the /balance payload for the same fixture, field by field", () => {
    const { service, owingCurrent, owingOld, paidInFull } = balanceFixture();
    const payload = service.getCustomerBalance(CUSTOMER_ID, undefined, NOW);
    const { csv } = service.getCustomerStatementCsv(CUSTOMER_ID, undefined, NOW);

    expect(payload.totalDue).toBe(3500);
    expect(payload.totalCollected).toBe(2700);
    expect(payload.outstanding).toBe(800);
    expect(payload.packages.map((row) => row.packageId)).toEqual([owingOld.id, owingCurrent.id]);

    // Header block carries the payload's headline figures.
    expect(csv).toContain("Customer,P6-3 Balance Customer");
    expect(csv).toContain("Statement Date,2026-11-12");
    expect(csv).toContain("Billing Terms,Net 7");
    expect(csv).toContain("Total Due,3500.00");
    expect(csv).toContain("Total Collected,2700.00");
    expect(csv).toContain("Total Outstanding,800.00");

    // Every payload row appears as a CSV line with the same numbers —
    // the shared-derivation proof: if the CSV ever recomputed money on
    // its own, this parity check is where it breaks.
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    for (const row of payload.packages) {
      const line = lines.find((entry) => entry.startsWith(`${row.packageNumber},`));
      expect(line, row.packageNumber).toBeDefined();
      const cells = line!.split(",");
      // Trailing six cells: Due Date, Days Overdue, Aging, Due, Paid, Outstanding
      // (the quoted description may contain a comma, so read from the end).
      expect(cells[cells.length - 6]).toBe(row.dueDate ?? "");
      expect(Number(cells[cells.length - 5])).toBe(row.daysOverdue);
      expect(cells[cells.length - 3]).toBe(row.price.toFixed(2));
      expect(cells[cells.length - 2]).toBe(row.amountPaid.toFixed(2));
      expect(cells[cells.length - 1]).toBe(row.outstanding.toFixed(2));
    }
    // Fully-paid packages are not owing rows — in neither surface.
    expect(csv).not.toContain(paidInFull.packageNumber);

    // The owing-table TOTAL foots to the payload: outstanding matches
    // exactly; due/paid are the owing-subset sums.
    const totalLine = lines.find((entry) => entry.startsWith("TOTAL (owing packages)"));
    expect(totalLine).toBeDefined();
    const totalCells = totalLine!.split(",");
    expect(totalCells[totalCells.length - 3]).toBe("1500.00");
    expect(totalCells[totalCells.length - 2]).toBe("700.00");
    expect(totalCells[totalCells.length - 1]).toBe(payload.outstanding.toFixed(2));

    // Aging summary echoes the payload's buckets.
    expect(csv).toContain("Current,1,300.00");
    expect(csv).toContain("31-60 days overdue,1,500.00");
    expect(owingCurrent).toBeDefined();
    expect(owingOld).toBeDefined();
  });

  test("other-branch customer is hidden exactly like a missing one", () => {
    const { service } = balanceFixture();
    const nagaCaller = { id: "user_p63_naga", role: "Naga Owner", branchAccess: "Naga" };
    expect(() => service.getCustomerStatementCsv(CUSTOMER_ID, nagaCaller, NOW)).toThrow("Customer not found");
    expect(() => service.getCustomerStatementCsv("cust_missing", undefined, NOW)).toThrow("Customer not found");
  });

  test("the filename is sanitized: no quotes, commas or spaces survive", () => {
    const service = seededService(makeCustomer({ businessName: 'Acmé "Trading", Inc.', billingTermDays: null }));
    const { filename } = service.getCustomerStatementCsv(CUSTOMER_ID, undefined, NOW);
    expect(filename).toBe("statement-Acm-Trading-Inc-2026-11-12.csv");
  });
});

describe("statement CSV permission gates", () => {
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

  async function bootService() {
    const dir = mkdtempSync(join(tmpdir(), "mts-p6-3-"));
    tempRoots.push(dir);
    process.env.INIT_CWD = dir;
    const service = new LogisticsService();
    await service.onModuleInit();
    return service;
  }

  function guardFor(service: LogisticsService) {
    const jwt = {
      verify: (token: string) => {
        const payload = verifyAuthToken(token);
        if (!payload) throw new Error("invalid token");
        return payload;
      }
    };
    // The REAL Reflector + REAL controller handlers: the test proves
    // the decorators on the actual endpoints, not a paraphrase of them.
    return new AuthGuard(new Reflector(), service, jwt as never);
  }

  function contextFor(handler: () => void, token?: string) {
    const request: { headers: Record<string, string>; user?: unknown; path: string } = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      path: "/statement.csv"
    };
    return {
      getHandler: () => handler,
      getClass: () => LogisticsController,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader: () => undefined }) })
    };
  }

  test("invoice CSV is documents.print; customer CSV is the reports.view/customers.manage pair", async () => {
    const service = await bootService();
    const state = internals(service);
    const addUser = (user: StaffUserRecord) => state.customUsers.push(user);
    addUser({ id: "user_p63_deladmin", name: "Fixture Delivery Admin", email: "deladmin.p63@mts.local", role: "Delivery Admin", status: "Active", passwordHash: hashSecret("deladmin-pw-1") });
    addUser({ id: "user_p63_receiving", name: "Fixture Receiving", email: "receiving.p63@mts.local", role: "Receiving Staff", status: "Active", passwordHash: hashSecret("receiving-pw-1") });
    addUser({ id: "user_p63_delivery", name: "Fixture Delivery", email: "delivery.p63@mts.local", role: "Delivery Staff", status: "Active", passwordHash: hashSecret("delivery-pw-1") });
    addUser({ id: "user_p63_customer", name: "Fixture Customer User", email: "customer.p63@mts.local", role: "Customer Owner", status: "Active", passwordHash: hashSecret("customer-pw-1") });

    const guard = guardFor(service);
    const tokenFor = (email: string, password: string): string => service.login({ email, password }).token;
    const invoiceCsvHandler = LogisticsController.prototype.billingStatementCsv as () => void;
    const customerCsvHandler = LogisticsController.prototype.customerStatementCsv as () => void;

    // Invoice CSV (documents.print): Delivery Staff HOLDS documents.print
    // (it is the print gate, deliberately wider than billing reads) —
    // admitted. A customer role holds nothing — refused. No token — refused.
    expect(guard.canActivate(contextFor(invoiceCsvHandler, tokenFor("delivery.p63@mts.local", "delivery-pw-1")) as never)).toBe(true);
    expect(guard.canActivate(contextFor(invoiceCsvHandler, tokenFor("deladmin.p63@mts.local", "deladmin-pw-1")) as never)).toBe(true);
    expect(guard.canActivate(contextFor(invoiceCsvHandler, tokenFor("customer.p63@mts.local", "customer-pw-1")) as never)).toBe(false);
    expect(guard.canActivate(contextFor(invoiceCsvHandler, undefined) as never)).toBe(false);

    // Customer CSV (reports.view OR customers.manage): Delivery Admin
    // passes on reports.view alone, Receiving Staff on customers.manage
    // alone; Delivery Staff holds NEITHER (despite passing the invoice
    // CSV above) — refused, as is every customer role and no token.
    expect(guard.canActivate(contextFor(customerCsvHandler, tokenFor("deladmin.p63@mts.local", "deladmin-pw-1")) as never)).toBe(true);
    expect(guard.canActivate(contextFor(customerCsvHandler, tokenFor("receiving.p63@mts.local", "receiving-pw-1")) as never)).toBe(true);
    expect(guard.canActivate(contextFor(customerCsvHandler, tokenFor("delivery.p63@mts.local", "delivery-pw-1")) as never)).toBe(false);
    expect(guard.canActivate(contextFor(customerCsvHandler, tokenFor("customer.p63@mts.local", "customer-pw-1")) as never)).toBe(false);
    expect(guard.canActivate(contextFor(customerCsvHandler, undefined) as never)).toBe(false);

    await service.onModuleDestroy();
  });
});
