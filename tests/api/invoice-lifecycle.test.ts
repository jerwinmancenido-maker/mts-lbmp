import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type {
  BillingInvoice,
  CargoPackage,
  Customer,
  DeliveryRecord,
  PaymentRecord,
  ServiceAuditLog
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 6 P6-1 — invoice lifecycle core.
 *
 * What is being proven:
 * - the billable set is DEFINED (delivered + priced + not already on an
 *   open invoice, matched by customerId) instead of "everything";
 * - the double-billing guard refuses a package already on an open invoice
 *   and names that invoice; voiding frees the package for re-billing;
 * - due dates derive from the fixed-list term days anchored on the LATEST
 *   delivery date (Manila calendar), with the creation date as fallback
 *   and Due-on-delivery landing on the anchor itself;
 * - amounts/status are LIVE at read time through one derivation: partial
 *   payment → Partially Paid, full → Paid, unpaid past due → Overdue,
 *   while the stored record keeps its creation snapshots untouched;
 * - void is audited, terminal, and idempotent.
 */

type ServiceInternals = {
  customers: Customer[];
  packages: CargoPackage[];
  payments: PaymentRecord[];
  deliveries: DeliveryRecord[];
  billingInvoices: BillingInvoice[];
  auditLogs: ServiceAuditLog[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const CUSTOMER_ID = "cust_p61";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    businessName: "P6-1 Fixture Customer",
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
    id: `pkg_p61_${pkgCounter}`,
    packageNumber: number,
    receivingRecordNumber: "RR-2026-11-000001",
    customerId: CUSTOMER_ID,
    customerName: "P6-1 Fixture Customer",
    productId: "prod_p61",
    description: "Angle bar",
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
  return {
    id: `del_${cargoPackageId}`,
    cargoPackageId,
    status: "Delivered",
    deliveredTo: "Fixture Receiver",
    createdAt
  };
}

function seededService(customer: Customer = makeCustomer()) {
  const service = new LogisticsService();
  internals(service).customers.push(customer);
  return service;
}

function manilaDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateKey: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-phase6-p61-"));
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

describe("billable set + double-billing guard", () => {
  test("default set = delivered + priced + not on an open invoice, matched by customerId only", () => {
    const service = seededService();
    const state = internals(service);
    const billable = makePackage();
    const unpriced = makePackage({ price: null });
    const undelivered = makePackage({ status: "Received" });
    const otherCustomer = makePackage({ customerId: "cust_other", customerName: "P6-1 Fixture Customer" });
    const alreadyBilled = makePackage();
    state.packages.push(billable, unpriced, undelivered, otherCustomer, alreadyBilled);
    state.deliveries.push(
      makeDelivery(billable.id, "2026-11-10T02:00:00.000Z"),
      makeDelivery(alreadyBilled.id, "2026-11-10T02:00:00.000Z")
    );
    state.billingInvoices.push({
      id: "bill_existing",
      invoiceNumber: "BILL-2026-11-000099",
      customerId: CUSTOMER_ID,
      customerName: "P6-1 Fixture Customer",
      packageIds: [alreadyBilled.id],
      amountDue: 1000,
      amountPaid: 0,
      balance: 1000,
      dueRule: "Net 30",
      status: "Issued",
      createdAt: "2026-11-10T03:00:00.000Z",
      updatedAt: "2026-11-10T03:00:00.000Z"
    });

    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID });

    expect(invoice.packageIds).toEqual([billable.id]);
    expect(invoice.amountDue).toBe(1000);
    expect(invoice.status).toBe("Issued");
  });

  test("default set with nothing billable is a clear error, not an empty invoice", () => {
    const service = seededService();
    internals(service).packages.push(makePackage({ status: "Received" }));
    expect(() => service.createBillingInvoice({ customerId: CUSTOMER_ID })).toThrow(/No billable packages/);
  });

  test("explicit list refuses a package already on an open invoice and names that invoice", () => {
    const service = seededService();
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    internals(service).deliveries.push(makeDelivery(pkg.id, "2026-11-10T02:00:00.000Z"));

    const first = service.createBillingInvoice({ customerId: CUSTOMER_ID, packageIds: [pkg.id] });
    expect(() =>
      service.createBillingInvoice({ customerId: CUSTOMER_ID, packageIds: [pkg.id] })
    ).toThrow(new RegExp(`already on open invoice ${first.invoiceNumber}`));
  });

  test("explicit list refuses another customer's package", () => {
    const service = seededService();
    const pkg = makePackage({ customerId: "cust_other", customerName: "Other Customer" });
    internals(service).packages.push(pkg);
    expect(() =>
      service.createBillingInvoice({ customerId: CUSTOMER_ID, packageIds: [pkg.id] })
    ).toThrow(/belongs to Other Customer/);
  });

  test("voiding frees the package: the same package can be re-billed afterwards", () => {
    const service = seededService();
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    internals(service).deliveries.push(makeDelivery(pkg.id, "2026-11-10T02:00:00.000Z"));

    const first = service.createBillingInvoice({ customerId: CUSTOMER_ID, packageIds: [pkg.id] });
    service.voidBillingInvoice(first.id);
    const second = service.createBillingInvoice({ customerId: CUSTOMER_ID, packageIds: [pkg.id] });

    expect(second.packageIds).toEqual([pkg.id]);
    expect(second.id).not.toBe(first.id);
    // The default set also sees the package again once the OLD invoice is
    // the voided one and the new one is... still open — so a third default
    // invoice has nothing to bill.
    expect(() => service.createBillingInvoice({ customerId: CUSTOMER_ID })).toThrow(/No billable packages/);
  });
});

describe("due-date derivation", () => {
  test("Net 30 anchors on the delivery date (Manila) and adds 30 days", () => {
    const service = seededService(makeCustomer({ billingTermDays: 30 }));
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    // 2026-11-10T02:00Z is 10:00 in Manila on 2026-11-10.
    internals(service).deliveries.push(makeDelivery(pkg.id, "2026-11-10T02:00:00.000Z"));

    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID });
    expect(invoice.dueDate?.slice(0, 10)).toBe("2026-12-10");
    expect(invoice.dueRule).toBe("Net 30");
  });

  test("the anchor is the LATEST delivery among the invoiced packages", () => {
    const service = seededService(makeCustomer({ billingTermDays: 7 }));
    const early = makePackage();
    const late = makePackage();
    internals(service).packages.push(early, late);
    internals(service).deliveries.push(
      makeDelivery(early.id, "2026-11-08T02:00:00.000Z"),
      makeDelivery(late.id, "2026-11-12T02:00:00.000Z")
    );

    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID, packageIds: [early.id, late.id] });
    expect(invoice.dueDate?.slice(0, 10)).toBe("2026-11-19");
  });

  test("Due on delivery (0 days) lands exactly on the anchor date", () => {
    const service = seededService(makeCustomer({ billingTermDays: 0, billingTerm: "Due on delivery" }));
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    internals(service).deliveries.push(makeDelivery(pkg.id, "2026-11-10T02:00:00.000Z"));

    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID });
    expect(invoice.dueDate?.slice(0, 10)).toBe("2026-11-10");
  });

  test("no delivery record falls back to the creation date as anchor", () => {
    const service = seededService(makeCustomer({ billingTermDays: 15 }));
    const pkg = makePackage();
    internals(service).packages.push(pkg);

    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID, packageIds: [pkg.id] });
    expect(invoice.dueDate?.slice(0, 10)).toBe(addDays(manilaDateKey(new Date()), 15));
  });

  test("no structured term → no due date, and the invoice can never be Overdue", () => {
    const service = seededService(makeCustomer({ billingTermDays: null, billingTerm: "Custom" }));
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    internals(service).deliveries.push(makeDelivery(pkg.id, "2026-09-01T02:00:00.000Z"));

    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID });
    expect(invoice.dueDate).toBeUndefined();
    expect(service.getBillingInvoice(invoice.id).status).toBe("Issued");
  });

  test("an invoice-level term override beats the customer's term", () => {
    const service = seededService(makeCustomer({ billingTermDays: 30 }));
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    internals(service).deliveries.push(makeDelivery(pkg.id, "2026-11-10T02:00:00.000Z"));

    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID, billingTermDays: 0 });
    expect(invoice.dueDate?.slice(0, 10)).toBe("2026-11-10");
  });

  test("terms outside the fixed list are refused, never guessed", () => {
    const service = seededService();
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    expect(() => service.createBillingInvoice({ customerId: CUSTOMER_ID, billingTermDays: 45 })).toThrow(/fixed terms/);
    expect(() => service.updateCustomer(CUSTOMER_ID, { billingTermDays: 45 })).toThrow(/fixed terms/);
    const updated = service.updateCustomer(CUSTOMER_ID, { billingTermDays: 15 });
    expect(updated.billingTermDays).toBe(15);
    const cleared = service.updateCustomer(CUSTOMER_ID, { billingTermDays: null });
    expect(cleared.billingTermDays).toBeNull();
  });
});

describe("live derivation: lifecycle transitions", () => {
  function invoiceWithTwoPackages(termDays: number | null = 30, deliveredAt = "2026-11-10T02:00:00.000Z") {
    const service = seededService(makeCustomer({ billingTermDays: termDays }));
    const pkgA = makePackage();
    const pkgB = makePackage();
    internals(service).packages.push(pkgA, pkgB);
    internals(service).deliveries.push(makeDelivery(pkgA.id, deliveredAt), makeDelivery(pkgB.id, deliveredAt));
    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID });
    return { service, pkgA, pkgB, invoice };
  }

  test("create → partial payment → Partially Paid → full payment → Paid, identical in list and detail", () => {
    const { service, pkgA, pkgB, invoice } = invoiceWithTwoPackages();
    expect(invoice.status).toBe("Issued");
    expect(invoice.balance).toBe(2000);

    service.recordPayment({ cargoPackageId: pkgA.id, amountPaid: 500, method: "Cash", collectionPoint: "Delivery" });
    const partial = service.getBillingInvoice(invoice.id);
    expect(partial.status).toBe("Partially Paid");
    expect(partial.amountPaid).toBe(500);
    expect(partial.balance).toBe(1500);
    const listed = service.listBillingInvoices().find((entry) => entry.id === invoice.id);
    expect(listed).toEqual(partial);

    service.recordPayment({ cargoPackageId: pkgA.id, amountPaid: 500, method: "Cash", collectionPoint: "Delivery" });
    service.recordPayment({ cargoPackageId: pkgB.id, amountPaid: 1000, method: "Cash", collectionPoint: "Delivery" });
    const paid = service.getBillingInvoice(invoice.id);
    expect(paid.status).toBe("Paid");
    expect(paid.amountPaid).toBe(2000);
    expect(paid.balance).toBe(0);
  });

  test("the stored record keeps its creation snapshots while reads go live", () => {
    const { service, pkgA, invoice } = invoiceWithTwoPackages();
    service.recordPayment({ cargoPackageId: pkgA.id, amountPaid: 700, method: "Cash", collectionPoint: "Delivery" });

    const stored = internals(service).billingInvoices.find((entry) => entry.id === invoice.id);
    expect(stored?.amountPaid).toBe(0);
    expect(stored?.balance).toBe(2000);
    expect(service.getBillingInvoice(invoice.id).amountPaid).toBe(700);
  });

  test("unpaid past the due date derives Overdue; partially paid past due stays Overdue", () => {
    const { service, pkgA, invoice } = invoiceWithTwoPackages(7, "2026-10-01T02:00:00.000Z");
    expect(invoice.dueDate?.slice(0, 10)).toBe("2026-10-08");
    expect(service.getBillingInvoice(invoice.id).status).toBe("Overdue");

    service.recordPayment({ cargoPackageId: pkgA.id, amountPaid: 100, method: "Cash", collectionPoint: "Delivery" });
    const after = service.getBillingInvoice(invoice.id);
    expect(after.status).toBe("Overdue");
    expect(after.balance).toBe(1900);
  });

  test("an invoice whose due date is still ahead stays Issued", () => {
    const service = seededService(makeCustomer({ billingTermDays: 30 }));
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    internals(service).deliveries.push(makeDelivery(pkg.id, new Date().toISOString()));
    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID });
    expect(service.getBillingInvoice(invoice.id).status).toBe("Issued");
  });
});

describe("void + detail reads", () => {
  test("void is terminal, audited, and idempotent", () => {
    const service = seededService();
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    internals(service).deliveries.push(makeDelivery(pkg.id, "2026-11-10T02:00:00.000Z"));
    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID });

    const voided = service.voidBillingInvoice(invoice.id, undefined, { reason: "Wrong customer" });
    expect(voided.status).toBe("Void");
    expect(internals(service).auditLogs.some((log) => log.action === "billing.invoice.void" && log.entityId === invoice.id)).toBe(true);
    expect(service.voidBillingInvoice(invoice.id).status).toBe("Void");
    expect(service.listBillingInvoices().find((entry) => entry.id === invoice.id)?.status).toBe("Void");
  });

  test("detail read hides cross-branch invoices exactly like missing ones", () => {
    const service = seededService();
    const pkg = makePackage();
    internals(service).packages.push(pkg);
    internals(service).deliveries.push(makeDelivery(pkg.id, "2026-11-10T02:00:00.000Z"));
    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID });

    const nagaCaller = { id: "user_p61_naga", role: "Naga Owner", branchAccess: "Naga" };
    expect(() => service.getBillingInvoice(invoice.id, nagaCaller)).toThrow("Billing invoice not found");
    expect(() => service.getBillingInvoice("bill_missing", nagaCaller)).toThrow("Billing invoice not found");
    expect(service.getBillingInvoice(invoice.id).id).toBe(invoice.id);
  });

  test("the statement renders from the invoice's actual packages with live amounts", () => {
    const service = seededService();
    const pkgA = makePackage();
    const pkgB = makePackage();
    internals(service).packages.push(pkgA, pkgB);
    internals(service).deliveries.push(makeDelivery(pkgA.id, "2026-11-10T02:00:00.000Z"), makeDelivery(pkgB.id, "2026-11-10T02:00:00.000Z"));
    const invoice = service.createBillingInvoice({ customerId: CUSTOMER_ID });
    service.recordPayment({ cargoPackageId: pkgA.id, amountPaid: 400, method: "Cash", collectionPoint: "Delivery" });

    const rendered = service.renderBillingStatement(invoice.id);
    expect(rendered.print.documentType).toBe("Billing Statement");
    expect(rendered.print.documentNumber).toBe(invoice.invoiceNumber);
    expect(rendered.text).toContain(pkgA.packageNumber);
    expect(rendered.text).toContain(pkgB.packageNumber);
    expect(rendered.text).toContain("Amount Paid: PHP 400.00");
    expect(rendered.text).toContain("Balance: PHP 1600.00");
  });
});
