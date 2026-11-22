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
  ServiceAuditLog,
  StaffUserRecord
} from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 fix loop PR-6 — audit content (canonical finding C-M7; filed
 * as L18-F1).
 *
 * Before this fix an audit entry was {id, action, entityType, entityId,
 * reason?, createdAt} — no who, no what-changed. The L18 verifier's
 * headline evidence: a ₱350 → ₱375 price change produced a
 * pricing.update entry whose only detail was the free-text reason, and
 * a payment entry carried no amount and no actor. The audit log could
 * not answer "who changed this price, from what to what?"
 *
 * What is proven here:
 * - A price change writes actor id/role/name + before/after prices.
 * - A payment writes the recording actor + the amount and package.
 * - A user creation writes the acting admin + the created role/branch;
 *   a user edit writes the role delta as before/after.
 * - A system-triggered audited action (the due-reminder scan with no
 *   caller) carries the clearly-marked SYSTEM actor, a manual scan
 *   carries the admin who ran it, and a public wall-QR intake carries
 *   the ANONYMOUS marker — never a fabricated user.
 * - Pre-existing entries without the new fields still load through the
 *   JSON store and are returned unchanged.
 * - The Prisma mapping persists actor (as the AuditLog.actorId FK,
 *   only for persisted users) and before/after (the Json columns), and
 *   reads them back; the system marker is not written as an FK.
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  customers: Customer[];
  packages: CargoPackage[];
  billingInvoices: BillingInvoice[];
  auditLogs: ServiceAuditLog[];
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
  const dir = mkdtempSync(join(tmpdir(), "mts-audit-content-"));
  tempRoots.push(dir);
  return bootServiceAt(dir);
}

/** Boots (or reboots) a service against an existing state dir. */
async function bootServiceAt(dir: string) {
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

function seedAdmin(service: LogisticsService): StaffUserRecord {
  const admin: StaffUserRecord = {
    id: "user_audit_admin",
    name: "Audit Admin",
    email: "audit.admin@example.test",
    role: "System Admin",
    branchAccess: "All branches",
    status: "Active",
    sessionVersion: 0,
    createdAt: "2026-11-12T00:00:00.000Z"
  };
  internals(service).customUsers.push(admin);
  return admin;
}

function seedStaff(service: LogisticsService): StaffUserRecord {
  const staff: StaffUserRecord = {
    id: "user_audit_receiver",
    name: "Audit Receiver",
    email: "audit.receiver@example.test",
    role: "Receiving Staff",
    branchAccess: "Daet",
    status: "Active",
    sessionVersion: 0,
    createdAt: "2026-11-12T00:00:00.000Z"
  };
  internals(service).customUsers.push(staff);
  return staff;
}

function makePackage(overrides: Partial<CargoPackage> = {}): CargoPackage {
  return {
    id: "pkg_audit_pr6",
    packageNumber: "PKG-2026-11-000375",
    receivingRecordNumber: "RR-2026-11-000375",
    customerId: "cust_audit_pr6",
    customerName: "Audit Fixture Customer",
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
    qrValue: "MTS:PKG:PKG-2026-11-000375",
    photoUrls: [],
    createdAt: "2026-11-12T00:00:00.000Z",
    ...overrides
  };
}

function auditEntry(service: LogisticsService, action: string, entityId?: string) {
  return internals(service).auditLogs.find(
    (entry) => entry.action === action && (entityId === undefined || entry.entityId === entityId)
  );
}

describe("C-M7 — sensitive mutations record actor + before/after", () => {
  test("a price change writes the actor and the from/to prices (the L18 headline case)", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const cargo = makePackage();
    internals(service).packages.push(cargo);

    service.updatePackagePrice(cargo.id, { price: 375, reason: "Owner approved increase" }, admin.id);

    const entry = auditEntry(service, "pricing.update", cargo.id);
    expect(entry).toBeDefined();
    expect(entry?.actor).toEqual({ id: admin.id, role: "System Admin", name: "Audit Admin" });
    expect(entry?.before).toEqual({ price: 350, status: "Waiting for Loading" });
    expect(entry?.after).toEqual({ price: 375, status: "Waiting for Loading" });
  });

  test("a payment writes the recording actor, the amount and the package", async () => {
    const service = await bootService();
    const staff = seedStaff(service);
    const cargo = makePackage({ status: "Out for Delivery" });
    internals(service).packages.push(cargo);

    service.recordPayment(
      { cargoPackageId: cargo.id, amountPaid: 200, method: "Cash", collectionPoint: "Delivery" },
      staff.id
    );

    const entry = auditEntry(service, "payments.record");
    expect(entry).toBeDefined();
    expect(entry?.actor).toEqual({ id: staff.id, role: "Receiving Staff", name: "Audit Receiver" });
    expect(entry?.after).toMatchObject({
      amountPaid: 200,
      amountDue: 350,
      cargoPackageId: cargo.id,
      packageNumber: cargo.packageNumber,
      method: "Cash"
    });
  });

  test("a user creation writes the acting admin and the created role/branch", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);

    const created = service.createStaffUser(
      { name: "New Receiver", role: "Receiving Staff", branchAccess: "Daet", password: "initial-pw-123" },
      admin.id
    );

    const entry = auditEntry(service, "settings.user.create", created.id);
    expect(entry).toBeDefined();
    expect(entry?.actor).toEqual({ id: admin.id, role: "System Admin", name: "Audit Admin" });
    expect(entry?.after).toMatchObject({ name: "New Receiver", role: "Receiving Staff", branchAccess: "Daet" });
  });

  test("a user edit writes the role change as before/after", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const created = service.createStaffUser(
      { name: "Promoted Receiver", role: "Receiving Staff", branchAccess: "Daet", password: "initial-pw-123" },
      admin.id
    );

    service.updateStaffUser(created.id, { role: "Delivery Staff" }, admin.id);

    const entry = auditEntry(service, "settings.user.update", created.id);
    expect(entry).toBeDefined();
    expect(entry?.actor?.id).toBe(admin.id);
    expect(entry?.before).toEqual({ role: "Receiving Staff" });
    expect(entry?.after).toEqual({ role: "Delivery Staff" });
  });

  test("an expense approval writes the approver and the status delta", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const staff = seedStaff(service);
    const expense = service.createExpense({ category: "Office Supplies", amount: 1500, description: "Bond paper" }, staff.id);

    service.approveExpense(expense.id, admin.id);

    const entry = auditEntry(service, "expenses.approve", expense.id);
    expect(entry).toBeDefined();
    expect(entry?.actor?.id).toBe(admin.id);
    expect(entry?.before).toEqual({ status: "Submitted" });
    expect(entry?.after).toMatchObject({ status: "Approved", amount: 1500 });
  });
});

describe("C-M7 — system and public actions carry marked non-user actors", () => {
  function seedOverdueInvoice(service: LogisticsService, suffix: string, dueDateKey: string) {
    const customer: Customer = {
      id: `cust_audit_${suffix}`,
      businessName: `Audit Scan Customer ${suffix}`,
      status: "Active",
      billingTerm: "Net 30",
      billingTermDays: 30
    };
    const cargo = makePackage({
      id: `pkg_audit_${suffix}`,
      packageNumber: `PKG-2026-11-000${suffix}`,
      customerId: customer.id,
      customerName: customer.businessName,
      status: "Delivered",
      price: 1000
    });
    const invoice: BillingInvoice = {
      id: `bill_audit_${suffix}`,
      invoiceNumber: `BILL-2026-11-000${suffix}`,
      customerId: customer.id,
      customerName: customer.businessName,
      packageIds: [cargo.id],
      amountDue: 1000,
      amountPaid: 0,
      balance: 1000,
      dueRule: "Net 30",
      status: "Issued",
      dueDate: `${dueDateKey}T00:00:00.000+08:00`,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z"
    };
    internals(service).customers.push(customer);
    internals(service).packages.push(cargo);
    internals(service).billingInvoices.push(invoice);
    return invoice;
  }

  test("a scheduler-style due scan records the SYSTEM actor; a manual scan records the admin", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const first = seedOverdueInvoice(service, "101", "2026-11-10");
    // Manila midday of 2026-11-20, so the business date is 2026-11-20.
    const now = new Date("2026-11-20T04:00:00.000Z");

    service.runDueReminderScan(now);
    const systemEntry = auditEntry(service, "billing.reminder.overdue", first.id);
    expect(systemEntry).toBeDefined();
    expect(systemEntry?.actor).toEqual({ id: "system", role: "System", name: "System" });
    expect(systemEntry?.after).toMatchObject({ balance: 1000 });

    const second = seedOverdueInvoice(service, "102", "2026-11-12");
    service.runDueReminderScan(now, admin.id);
    const manualEntry = auditEntry(service, "billing.reminder.overdue", second.id);
    expect(manualEntry).toBeDefined();
    expect(manualEntry?.actor).toEqual({ id: admin.id, role: "System Admin", name: "Audit Admin" });
  });

  test("a public wall-QR intake records the ANONYMOUS actor, never a fabricated user", async () => {
    const service = await bootService();

    const result = service.createReceivingIntakeTask({ warehouseCode: "daet", customerName: "Walk-in Customer" });

    const entry = auditEntry(service, "receiving.intake_created", result.task.id);
    expect(entry).toBeDefined();
    expect(entry?.actor).toEqual({ id: "anonymous", role: "Unauthenticated", name: "Unauthenticated" });
  });
});

describe("C-M7 — pre-existing entries survive unchanged", () => {
  test("a legacy entry without actor/before/after loads through the JSON store and returns unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mts-audit-legacy-"));
    tempRoots.push(dir);
    const legacy: ServiceAuditLog = {
      id: "aud_legacy_pr6",
      action: "pricing.update",
      entityType: "CargoPackage",
      entityId: "pkg_legacy",
      reason: "legacy free-text reason",
      createdAt: "2026-11-01T00:00:00.000Z"
    };

    const first = await bootServiceAt(dir);
    internals(first).auditLogs.push(legacy);
    // Any audited write persists the whole state, legacy entry included.
    first.updatePaymentMethods({ methods: ["Cash"] });

    const rebooted = await bootServiceAt(dir);
    const returned = rebooted.listAuditLogs({}).find((entry) => entry.id === "aud_legacy_pr6");
    expect(returned).toBeDefined();
    expect(returned?.action).toBe("pricing.update");
    expect(returned?.reason).toBe("legacy free-text reason");
    expect(returned?.createdAt).toBe("2026-11-01T00:00:00.000Z");
    expect(returned?.actor).toBeUndefined();
    expect(returned?.before).toBeUndefined();
    expect(returned?.after).toBeUndefined();
  });
});

describe("C-M7 — the Prisma mapping persists actor + before/after", () => {
  function fixtureState(auditLogs: ServiceAuditLog[]): ServiceState {
    return {
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
      auditLogs,
      descriptionBarcodes: [],
      messages: [],
      operationChatThreads: [],
      hardwareTests: [],
      printLogs: [],
      customUsers: [
        {
          id: "user_1",
          name: "Fixture Receiver Staff",
          email: "receiving.fixture@mts.local",
          role: "Receiving Staff",
          branchAccess: "Daet",
          status: "Active",
          createdAt: "2026-11-11T00:00:00.000Z"
        }
      ],
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
    };
  }

  test("a persisted user's actor becomes the FK and before/after the Json columns, and all read back", () => {
    const state = fixtureState([
      {
        id: "aud_pr6_user",
        action: "pricing.update",
        entityType: "CargoPackage",
        entityId: "pkg_1",
        actor: { id: "user_1", role: "Receiving Staff", name: "Fixture Receiver Staff" },
        before: { price: 350 },
        after: { price: 375 },
        createdAt: "2026-11-12T00:00:00.000Z"
      },
      {
        id: "aud_pr6_system",
        action: "billing.reminder.overdue",
        entityType: "BillingInvoice",
        entityId: "bill_1",
        actor: { id: "system", role: "System", name: "System" },
        after: { balance: 1000 },
        createdAt: "2026-11-12T01:00:00.000Z"
      }
    ]);

    const rows = stateToRows(state);
    expect(rows.auditLogs[0]).toMatchObject({
      actorId: "user_1",
      beforeJson: { price: 350 },
      afterJson: { price: 375 }
    });
    // The SYSTEM marker is not a user row: the FK stays null while the
    // before/after values still persist.
    expect(rows.auditLogs[1]).toMatchObject({ actorId: null, afterJson: { balance: 1000 } });

    const roundTripped = rowsToState(rows);
    const userEntry = roundTripped.auditLogs?.find((entry) => entry.id === "aud_pr6_user");
    expect(userEntry?.actor).toEqual({ id: "user_1", role: "Receiving Staff", name: "Fixture Receiver Staff" });
    expect(userEntry?.before).toEqual({ price: 350 });
    expect(userEntry?.after).toEqual({ price: 375 });
    const systemEntry = roundTripped.auditLogs?.find((entry) => entry.id === "aud_pr6_system");
    expect(systemEntry?.actor).toBeUndefined();
    expect(systemEntry?.after).toEqual({ balance: 1000 });
  });
});
