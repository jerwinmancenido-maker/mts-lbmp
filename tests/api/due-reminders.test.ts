import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type {
  BillingInvoice,
  CargoPackage,
  Customer,
  PaymentRecord,
  ServiceAuditLog,
  ServiceNotification
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 6 P6-4 — in-app due reminders + the Due/Overdue worklist.
 *
 * What is being proven:
 * - the due scan's state machine: an invoice entering "due within 3
 *   days" fires ONE due-soon notification, entering "overdue" fires
 *   ONE overdue notification, and re-scans never duplicate either —
 *   the once-per-state guard is the marker on the invoice record,
 *   keyed to the due date (a moved due date re-arms the cycle);
 * - paid-before-due invoices never notify in either state; voided,
 *   draft and due-date-less invoices never notify; partially paid
 *   invoices notify with the LIVE remaining balance;
 * - markers persist across the Prisma mapping seam (state → rows →
 *   state), so a restarted service does not re-fire;
 * - the worklist is oldest-due first with live figures, excludes
 *   everything not due soon/overdue, and honours branch scoping;
 * - the manual reminder's amount is the SERVER balance (no caller
 *   figure is accepted anymore) and its response names the real
 *   channel (in-app — no SMS status fiction);
 * - reminder history reads manual + automatic entries back from the
 *   audit trail, newest first.
 */

type ServiceInternals = {
  customers: Customer[];
  packages: CargoPackage[];
  payments: PaymentRecord[];
  billingInvoices: BillingInvoice[];
  notifications: ServiceNotification[];
  auditLogs: ServiceAuditLog[];
  snapshotState: () => ServiceState;
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const CUSTOMER_ID = "cust_p64";

/** A moment at Manila midday of the given YYYY-MM-DD, so businessDateKey(now) is exactly that date. */
function manilaMidday(dateKey: string): Date {
  return new Date(`${dateKey}T04:00:00.000Z`);
}

function dueDateIso(dateKey: string): string {
  return `${dateKey}T00:00:00.000+08:00`;
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    businessName: "P6-4 Fixture Customer",
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
    id: `pkg_p64_${pkgCounter}`,
    packageNumber: number,
    receivingRecordNumber: "RR-2026-11-000001",
    customerId: CUSTOMER_ID,
    customerName: "P6-4 Fixture Customer",
    productId: "prod_p64",
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

let payCounter = 0;
function makePayment(cargoPackageId: string, amountPaid: number): PaymentRecord {
  payCounter += 1;
  return {
    id: `pay_p64_${payCounter}`,
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

let invoiceCounter = 0;
function makeInvoice(overrides: Partial<BillingInvoice> = {}): BillingInvoice {
  invoiceCounter += 1;
  return {
    id: `bill_p64_${invoiceCounter}`,
    invoiceNumber: `BILL-2026-11-${String(invoiceCounter).padStart(6, "0")}`,
    customerId: CUSTOMER_ID,
    customerName: "P6-4 Fixture Customer",
    packageIds: [],
    amountDue: 1000,
    amountPaid: 0,
    balance: 1000,
    dueRule: "Net 30",
    status: "Issued",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides
  };
}

/** A service holding the fixture customer plus one priced package on one issued invoice with the given due date. */
function seededServiceWithInvoice(dueKey: string | undefined, invoiceOverrides: Partial<BillingInvoice> = {}) {
  const service = new LogisticsService();
  const state = internals(service);
  state.customers.push(makeCustomer());
  const pkg = makePackage();
  state.packages.push(pkg);
  const invoice = makeInvoice({ packageIds: [pkg.id], dueDate: dueKey ? dueDateIso(dueKey) : undefined, ...invoiceOverrides });
  state.billingInvoices.push(invoice);
  return { service, state, pkg, invoice };
}

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-phase6-p64-"));
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

describe("due scan state machine", () => {
  test("due in 3 days fires due-soon exactly once; a re-scan is a no-op", () => {
    const { service, state, invoice } = seededServiceWithInvoice("2026-11-15");

    const first = service.runDueReminderScan(manilaMidday("2026-11-12"));
    expect(first.dueSoonNotified).toEqual([invoice.id]);
    expect(first.overdueNotified).toEqual([]);
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.title).toBe("Invoice due soon");
    expect(state.notifications[0]?.message).toContain("PHP 1,000");
    expect(state.notifications[0]?.message).toContain("in 3 days");
    expect(invoice.dueSoonReminderForDate).toBe("2026-11-15");
    expect(state.auditLogs.filter((log) => log.action === "billing.reminder.dueSoon")).toHaveLength(1);

    const second = service.runDueReminderScan(manilaMidday("2026-11-12"));
    expect(second.dueSoonNotified).toEqual([]);
    expect(second.overdueNotified).toEqual([]);
    expect(state.notifications).toHaveLength(1);
    expect(state.auditLogs.filter((log) => log.action.startsWith("billing.reminder"))).toHaveLength(1);
  });

  test("due today fires due-soon; due in 4 days does not fire and is not on the worklist", () => {
    const service = new LogisticsService();
    const state = internals(service);
    state.customers.push(makeCustomer());
    const pkgToday = makePackage();
    const pkgLater = makePackage();
    state.packages.push(pkgToday, pkgLater);
    const dueToday = makeInvoice({ packageIds: [pkgToday.id], dueDate: dueDateIso("2026-11-12") });
    const dueLater = makeInvoice({ packageIds: [pkgLater.id], dueDate: dueDateIso("2026-11-16") });
    state.billingInvoices.push(dueToday, dueLater);

    const result = service.runDueReminderScan(manilaMidday("2026-11-12"));
    expect(result.dueSoonNotified).toEqual([dueToday.id]);
    expect(state.notifications[0]?.message).toContain("(today)");

    const worklist = service.listDueWorklist(undefined, manilaMidday("2026-11-12"));
    expect(worklist.map((row) => row.invoiceId)).toEqual([dueToday.id]);
  });

  test("an invoice that fired due-soon fires overdue once when the due date passes", () => {
    const { service, state, invoice } = seededServiceWithInvoice("2026-11-15");

    service.runDueReminderScan(manilaMidday("2026-11-14"));
    expect(state.notifications).toHaveLength(1);

    const crossed = service.runDueReminderScan(manilaMidday("2026-11-16"));
    expect(crossed.overdueNotified).toEqual([invoice.id]);
    expect(state.notifications).toHaveLength(2);
    expect(state.notifications[1]?.title).toBe("Invoice overdue");
    expect(state.notifications[1]?.message).toContain("1 day overdue");
    expect(invoice.dueSoonReminderForDate).toBe("2026-11-15");
    expect(invoice.overdueReminderForDate).toBe("2026-11-15");

    const again = service.runDueReminderScan(manilaMidday("2026-11-20"));
    expect(again.overdueNotified).toEqual([]);
    expect(state.notifications).toHaveLength(2);
  });

  test("an invoice first seen after its due date fires overdue only, never due-soon", () => {
    const { service, state, invoice } = seededServiceWithInvoice("2026-11-10");
    const result = service.runDueReminderScan(manilaMidday("2026-11-12"));
    expect(result.dueSoonNotified).toEqual([]);
    expect(result.overdueNotified).toEqual([invoice.id]);
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.title).toBe("Invoice overdue");
  });

  test("paid before the due date is never notified in either state", () => {
    const { service, state, pkg } = seededServiceWithInvoice("2026-11-15");
    state.payments.push(makePayment(pkg.id, 1000));

    const before = service.runDueReminderScan(manilaMidday("2026-11-14"));
    const after = service.runDueReminderScan(manilaMidday("2026-11-20"));
    expect(before.dueSoonNotified).toEqual([]);
    expect(after.overdueNotified).toEqual([]);
    expect(state.notifications).toHaveLength(0);
    expect(service.listDueWorklist(undefined, manilaMidday("2026-11-20"))).toEqual([]);
  });

  test("partially paid past due notifies with the live remaining balance", () => {
    const { service, state, pkg } = seededServiceWithInvoice("2026-11-10");
    state.payments.push(makePayment(pkg.id, 400));

    service.runDueReminderScan(manilaMidday("2026-11-12"));
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.message).toContain("PHP 600");
    expect(state.notifications[0]?.message).not.toContain("PHP 1,000");
  });

  test("voided, draft and due-date-less invoices never notify", () => {
    const service = new LogisticsService();
    const state = internals(service);
    state.customers.push(makeCustomer());
    const pkgVoid = makePackage();
    const pkgDraft = makePackage();
    const pkgNoDate = makePackage();
    state.packages.push(pkgVoid, pkgDraft, pkgNoDate);
    state.billingInvoices.push(
      makeInvoice({ packageIds: [pkgVoid.id], dueDate: dueDateIso("2026-11-10"), status: "Void" }),
      makeInvoice({ packageIds: [pkgDraft.id], dueDate: dueDateIso("2026-11-10"), status: "Draft" }),
      makeInvoice({ packageIds: [pkgNoDate.id], dueDate: undefined })
    );

    const result = service.runDueReminderScan(manilaMidday("2026-11-12"));
    expect(result.scannedInvoices).toBe(1);
    expect(result.dueSoonNotified).toEqual([]);
    expect(result.overdueNotified).toEqual([]);
    expect(state.notifications).toHaveLength(0);
  });

  test("a moved due date re-arms the cycle for the new date", () => {
    const { service, state, invoice } = seededServiceWithInvoice("2026-11-15");
    service.runDueReminderScan(manilaMidday("2026-11-12"));
    expect(state.notifications).toHaveLength(1);

    // The stored due date moves later (e.g. terms were renegotiated);
    // the reminder sent for the old date must not suppress the new one.
    invoice.dueDate = dueDateIso("2026-11-25");
    const rearmed = service.runDueReminderScan(manilaMidday("2026-11-23"));
    expect(rearmed.dueSoonNotified).toEqual([invoice.id]);
    expect(invoice.dueSoonReminderForDate).toBe("2026-11-25");
    expect(state.notifications).toHaveLength(2);

    const again = service.runDueReminderScan(manilaMidday("2026-11-23"));
    expect(again.dueSoonNotified).toEqual([]);
    expect(state.notifications).toHaveLength(2);
  });
});

describe("marker persistence across the Prisma mapping seam", () => {
  test("markers round-trip through stateToRows/rowsToState and a rebooted service does not re-fire", () => {
    const { service, state, invoice } = seededServiceWithInvoice("2026-11-15");
    service.runDueReminderScan(manilaMidday("2026-11-12"));
    expect(state.notifications).toHaveLength(1);

    const rows = stateToRows(state.snapshotState());
    expect(rows.billingInvoices[0]?.dueSoonReminderForDate).toBe("2026-11-15");
    expect(rows.billingInvoices[0]?.overdueReminderForDate).toBeNull();

    // Restart simulation: a fresh service whose state comes back
    // through the Prisma-shaped rows.
    const rebooted = new LogisticsService();
    const rebootedState = internals(rebooted);
    const restored = rowsToState(rows);
    rebootedState.customers = restored.customers ?? [];
    rebootedState.packages = restored.packages ?? [];
    rebootedState.payments = restored.payments ?? [];
    rebootedState.billingInvoices = restored.billingInvoices ?? [];
    rebootedState.notifications = restored.notifications ?? [];
    rebootedState.auditLogs = restored.auditLogs ?? [];

    const restoredInvoice = rebootedState.billingInvoices.find((entry) => entry.id === invoice.id);
    expect(restoredInvoice?.dueSoonReminderForDate).toBe("2026-11-15");

    const rescan = rebooted.runDueReminderScan(manilaMidday("2026-11-12"));
    expect(rescan.dueSoonNotified).toEqual([]);
    expect(rebootedState.notifications).toHaveLength(1);

    // …and the rebooted service still fires the NEXT state exactly once.
    const crossed = rebooted.runDueReminderScan(manilaMidday("2026-11-16"));
    expect(crossed.overdueNotified).toEqual([invoice.id]);
    expect(rebootedState.notifications).toHaveLength(2);
  });
});

describe("due worklist", () => {
  test("oldest due first, due-soon after overdue, with live figures and exclusions", () => {
    const service = new LogisticsService();
    const state = internals(service);
    state.customers.push(makeCustomer());
    const mk = (dueKey: string | undefined, paid = 0) => {
      const pkg = makePackage();
      state.packages.push(pkg);
      if (paid > 0) state.payments.push(makePayment(pkg.id, paid));
      const invoice = makeInvoice({ packageIds: [pkg.id], dueDate: dueKey ? dueDateIso(dueKey) : undefined });
      state.billingInvoices.push(invoice);
      return invoice;
    };
    const overdue10 = mk("2026-11-02");
    const overdue2 = mk("2026-11-10", 250);
    const dueToday = mk("2026-11-12");
    const dueIn2 = mk("2026-11-14");
    mk("2026-11-21"); // due in 9 days — outside the window
    mk("2026-11-05", 1000); // fully paid — excluded
    mk(undefined); // no due date — excluded

    const rows = service.listDueWorklist(undefined, manilaMidday("2026-11-12"));
    expect(rows.map((row) => row.invoiceId)).toEqual([overdue10.id, overdue2.id, dueToday.id, dueIn2.id]);
    expect(rows.map((row) => row.state)).toEqual(["Overdue", "Overdue", "DueSoon", "DueSoon"]);
    expect(rows.map((row) => row.daysOverdue)).toEqual([10, 2, 0, 0]);
    expect(rows.map((row) => row.daysUntilDue)).toEqual([0, 0, 0, 2]);
    expect(rows[1]?.balance).toBe(750);
    expect(rows[1]?.status).toBe("Overdue");
    expect(rows[0]?.dueDate).toBe("2026-11-02");
  });

  test("branch scoping hides other-branch invoices from the worklist", () => {
    const service = new LogisticsService();
    const state = internals(service);
    state.customers.push(makeCustomer());
    const nagaPkg = makePackage({ destination: "Naga", handlingBranchId: "naga", handlingBranchName: "Naga" });
    state.packages.push(nagaPkg);
    const nagaInvoice = makeInvoice({ packageIds: [nagaPkg.id], dueDate: dueDateIso("2026-11-10") });
    state.billingInvoices.push(nagaInvoice);

    const daetUser = { id: "user_daet", role: "Daet Owner", branchAccess: "Daet" };
    expect(service.listDueWorklist(daetUser, manilaMidday("2026-11-12"))).toEqual([]);
    const allRows = service.listDueWorklist(undefined, manilaMidday("2026-11-12"));
    expect(allRows.map((row) => row.invoiceId)).toEqual([nagaInvoice.id]);
    expect(allRows[0]?.branchName).toBe("Naga");
  });
});

describe("manual reminder + reminder history", () => {
  test("the manual reminder's amount is the server balance and the channel is honestly in-app", () => {
    const { service, state, pkg } = seededServiceWithInvoice("2026-11-15");
    state.payments.push(makePayment(pkg.id, 250));

    const response = service.createCustomerBillingReminder(CUSTOMER_ID, { branchName: "Daet" });
    expect(response.balance).toBe(750);
    expect(response.channel).toBe("in-app");
    expect(response).not.toHaveProperty("smsStatus");
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.message).toContain("PHP 750");
    expect(state.auditLogs.some((log) => log.action === "billing.reminder" && log.entityId === CUSTOMER_ID)).toBe(true);
  });

  test("history combines manual + automatic entries with invoice numbers, newest first", () => {
    const { service, state, invoice } = seededServiceWithInvoice("2026-11-15");
    service.createCustomerBillingReminder(CUSTOMER_ID, { branchName: "Daet" });
    service.runDueReminderScan(manilaMidday("2026-11-12"));
    service.runDueReminderScan(manilaMidday("2026-11-16"));

    // Give the three audit entries distinct, spaced timestamps so the
    // newest-first order is asserted on data, not on wall-clock luck.
    const reminderLogs = state.auditLogs.filter((log) => log.action.startsWith("billing.reminder"));
    expect(reminderLogs).toHaveLength(3);
    reminderLogs.forEach((log, index) => {
      log.createdAt = `2026-11-12T0${index + 1}:00:00.000Z`;
    });

    const history = service.getCustomerReminderHistory(CUSTOMER_ID);
    expect(history.map((entry) => entry.kind)).toEqual(["overdue", "dueSoon", "manual"]);
    expect(history[0]?.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(history[1]?.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(history[2]?.invoiceNumber).toBeUndefined();
    expect(history.every((entry) => entry.reason?.includes("PHP"))).toBe(true);
  });

  test("history answers 404 for a customer hidden from the caller, like the balance read", () => {
    const service = new LogisticsService();
    const state = internals(service);
    state.customers.push(makeCustomer());
    const nagaPkg = makePackage({ destination: "Naga", handlingBranchId: "naga", handlingBranchName: "Naga" });
    state.packages.push(nagaPkg);

    const daetUser = { id: "user_daet", role: "Daet Owner", branchAccess: "Daet" };
    expect(() => service.getCustomerReminderHistory(CUSTOMER_ID, daetUser)).toThrowError(/Customer not found/);
    expect(service.getCustomerReminderHistory(CUSTOMER_ID)).toEqual([]);
  });
});
