import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rolePresets } from "@mts-lbmp/permissions";
import { AuthGuard, IS_PUBLIC_ROUTE, REQUIRED_ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from "../../apps/api/src/modules/auth.guard";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { hashSecret, verifyAuthToken } from "../../apps/api/src/modules/security";
import type {
  CargoPackage,
  Customer,
  DeliveryRecord,
  PaymentRecord,
  StaffUserRecord
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 6 P6-2 — server-side customer balances + aging.
 *
 * What is being proven:
 * - balance math is cumulative per package (partial payments across
 *   several packages), fully-paid packages vanish from the owing rows,
 *   and the headline outstanding is the clamped per-package sum;
 * - due dates derive per package exactly like P6-1 invoice due dates
 *   (delivery anchor + the customer's structured term days), and aging
 *   buckets split on whole Manila calendar days past due — due today is
 *   "current", due yesterday is 1–30, and the 30/31/60/61/90/91 edges
 *   land in the right buckets;
 * - no structured term → the explicit "termsNotSet" bucket and no due
 *   date (never guessed); a term without a delivery → "notDelivered";
 * - branch scoping follows P5-3: figures cover caller-visible packages,
 *   a customer whose packages are all in another branch is hidden from
 *   the list and answers 404 on the detail exactly like a missing one;
 * - the balance endpoints' gate is the FIRST real enforcement of
 *   reports.view: it alone admits (Delivery Admin), customers.manage
 *   alone also admits (Receiving Staff, the any-of companion), and
 *   holding neither refuses (Delivery Staff, customer roles).
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  customers: Customer[];
  packages: CargoPackage[];
  payments: PaymentRecord[];
  deliveries: DeliveryRecord[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

/** 2026-11-12, 10:00 in Manila — "today" for every aging assertion. */
const NOW = new Date("2026-11-12T02:00:00.000Z");

const CUSTOMER_ID = "cust_p62";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    businessName: "P6-2 Fixture Customer",
    status: "Active",
    billingTerm: "Net 7",
    billingTermDays: 7,
    ...overrides
  };
}

let pkgCounter = 0;
function makePackage(overrides: Partial<CargoPackage> = {}): CargoPackage {
  pkgCounter += 1;
  const number = `PKG-2026-11-${String(pkgCounter).padStart(6, "0")}`;
  return {
    id: `pkg_p62_${pkgCounter}`,
    packageNumber: number,
    receivingRecordNumber: "RR-2026-11-000001",
    customerId: CUSTOMER_ID,
    customerName: "P6-2 Fixture Customer",
    productId: "prod_p62",
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
    id: `pay_p62_${payCounter}`,
    cargoPackageId,
    amountDue: 0,
    amountPaid,
    // The stored per-call balance is deliberately wrong-looking here
    // (it ignores other payments by design — see the P6-2 display fix);
    // the balance derivation must never read it.
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

describe("balance math", () => {
  test("partial payments across packages accumulate; fully-paid packages are not owing rows", () => {
    const service = seededService();
    const state = internals(service);
    const pkgA = makePackage({ price: 1000 });
    const pkgB = makePackage({ price: 500 });
    const pkgC = makePackage({ price: 2000 });
    const pkgUnpriced = makePackage({ price: null });
    const pkgOverpaid = makePackage({ price: 100 });
    state.packages.push(pkgA, pkgB, pkgC, pkgUnpriced, pkgOverpaid);
    for (const pkg of [pkgA, pkgB, pkgC, pkgOverpaid]) {
      state.deliveries.push(makeDelivery(pkg.id, "2026-11-10T02:00:00.000Z"));
    }
    state.payments.push(
      makePayment(pkgA.id, 400),
      makePayment(pkgA.id, 300),
      makePayment(pkgC.id, 2000),
      makePayment(pkgUnpriced.id, 100),
      makePayment(pkgOverpaid.id, 150)
    );

    const balance = service.getCustomerBalance(CUSTOMER_ID, undefined, NOW);

    // Due counts priced packages only; collected counts every payment on
    // the customer's packages (money collected is money collected, even
    // the 100 paid toward an unpriced package).
    expect(balance.totalDue).toBe(3600);
    expect(balance.totalCollected).toBe(2950);
    // Outstanding is the clamped per-package sum: 300 + 500. The
    // overpaid package contributes 0, NOT −50, so outstanding (800) is
    // deliberately not totalDue − totalCollected (650).
    expect(balance.outstanding).toBe(800);
    expect(balance.packages.map((row) => row.packageId).sort()).toEqual([pkgA.id, pkgB.id].sort());
    const rowA = balance.packages.find((row) => row.packageId === pkgA.id);
    expect(rowA?.amountPaid).toBe(700);
    expect(rowA?.outstanding).toBe(300);
    // Both owing rows delivered 2026-11-10 on Net 7 → due 2026-11-17.
    expect(balance.oldestDueDate).toBe("2026-11-17");
    expect(balance.aging.current).toEqual({ amount: 800, count: 2 });
  });

  test("a customer with no packages answers a zero balance", () => {
    const service = seededService();
    const balance = service.getCustomerBalance(CUSTOMER_ID, undefined, NOW);
    expect(balance.totalDue).toBe(0);
    expect(balance.totalCollected).toBe(0);
    expect(balance.outstanding).toBe(0);
    expect(balance.packages).toEqual([]);
    expect(balance.oldestDueDate).toBeUndefined();
  });

  test("rows are ordered oldest due date first", () => {
    const service = seededService(makeCustomer({ billingTermDays: 7 }));
    const state = internals(service);
    const newer = makePackage();
    const older = makePackage();
    state.packages.push(newer, older);
    state.deliveries.push(makeDelivery(newer.id, "2026-11-09T02:00:00.000Z"), makeDelivery(older.id, "2026-11-01T02:00:00.000Z"));
    const balance = service.getCustomerBalance(CUSTOMER_ID, undefined, NOW);
    expect(balance.packages.map((row) => row.packageId)).toEqual([older.id, newer.id]);
    expect(balance.oldestDueDate).toBe("2026-11-08");
  });
});

describe("aging buckets (Manila calendar, today = 2026-11-12)", () => {
  /** One owing package on Net 30, delivered on the given Manila date. */
  function balanceForDelivery(deliveredDateKey: string, termDays: number | null = 30) {
    const service = seededService(makeCustomer({ billingTermDays: termDays }));
    const state = internals(service);
    const pkg = makePackage();
    state.packages.push(pkg);
    // 02:00Z is 10:00 in Manila on the same calendar date.
    state.deliveries.push(makeDelivery(pkg.id, `${deliveredDateKey}T02:00:00.000Z`));
    return service.getCustomerBalance(CUSTOMER_ID, undefined, NOW);
  }

  test("due today is current; due yesterday is 1–30", () => {
    // Net 30: delivered 2026-10-13 → due 2026-11-12 (today).
    const dueToday = balanceForDelivery("2026-10-13");
    expect(dueToday.packages[0]?.dueDate).toBe("2026-11-12");
    expect(dueToday.packages[0]?.daysOverdue).toBe(0);
    expect(dueToday.packages[0]?.agingBucket).toBe("current");

    // Delivered 2026-10-12 → due 2026-11-11 (yesterday).
    const dueYesterday = balanceForDelivery("2026-10-12");
    expect(dueYesterday.packages[0]?.daysOverdue).toBe(1);
    expect(dueYesterday.packages[0]?.agingBucket).toBe("overdue1To30");
  });

  test("the 30/31/60/61/90/91 edges land in the right buckets", () => {
    const cases: Array<{ delivered: string; daysOverdue: number; bucket: string }> = [
      { delivered: "2026-09-13", daysOverdue: 30, bucket: "overdue1To30" },
      { delivered: "2026-09-12", daysOverdue: 31, bucket: "overdue31To60" },
      { delivered: "2026-08-14", daysOverdue: 60, bucket: "overdue31To60" },
      { delivered: "2026-08-13", daysOverdue: 61, bucket: "overdue61To90" },
      { delivered: "2026-07-15", daysOverdue: 90, bucket: "overdue61To90" },
      { delivered: "2026-07-14", daysOverdue: 91, bucket: "overdue90Plus" }
    ];
    for (const entry of cases) {
      const balance = balanceForDelivery(entry.delivered);
      expect(balance.packages[0]?.daysOverdue, `delivered ${entry.delivered}`).toBe(entry.daysOverdue);
      expect(balance.packages[0]?.agingBucket, `delivered ${entry.delivered}`).toBe(entry.bucket);
      expect(balance.aging[entry.bucket as keyof typeof balance.aging]).toEqual({ amount: 1000, count: 1 });
    }
  });

  test("the anchor is the Manila date, not the UTC date", () => {
    const service = seededService(makeCustomer({ billingTermDays: 0 }));
    const state = internals(service);
    const pkg = makePackage();
    state.packages.push(pkg);
    // 2026-11-11T16:30Z is 2026-11-12 00:30 in Manila — due on delivery
    // (term 0) must land on the Manila date and read as current today.
    state.deliveries.push(makeDelivery(pkg.id, "2026-11-11T16:30:00.000Z"));
    const balance = service.getCustomerBalance(CUSTOMER_ID, undefined, NOW);
    expect(balance.packages[0]?.deliveredDate).toBe("2026-11-12");
    expect(balance.packages[0]?.dueDate).toBe("2026-11-12");
    expect(balance.packages[0]?.agingBucket).toBe("current");
  });

  test("no structured term → termsNotSet bucket, no due date, never guessed into aging", () => {
    const balance = balanceForDelivery("2026-08-01", null);
    const row = balance.packages[0];
    expect(row?.agingBucket).toBe("termsNotSet");
    expect(row?.dueDate).toBeUndefined();
    expect(row?.daysOverdue).toBe(0);
    expect(balance.aging.termsNotSet).toEqual({ amount: 1000, count: 1 });
    expect(balance.oldestDueDate).toBeUndefined();
    expect(balance.billingTermDays).toBeNull();
  });

  test("a term without a delivery → notDelivered bucket, no due date", () => {
    const service = seededService(makeCustomer({ billingTermDays: 15 }));
    const state = internals(service);
    const inTransit = makePackage({ status: "In Transit" });
    const deliveredNoRecord = makePackage({ status: "Delivered" });
    state.packages.push(inTransit, deliveredNoRecord);
    const balance = service.getCustomerBalance(CUSTOMER_ID, undefined, NOW);
    expect(balance.packages.map((row) => row.agingBucket)).toEqual(["notDelivered", "notDelivered"]);
    expect(balance.aging.notDelivered).toEqual({ amount: 2000, count: 2 });
    expect(balance.oldestDueDate).toBeUndefined();
  });
});

describe("branch scoping", () => {
  const nagaCaller = { id: "user_p62_naga", role: "Naga Owner", branchAccess: "Naga" };

  function twoBranchService() {
    const service = seededService();
    const state = internals(service);
    const daetPkg = makePackage({ price: 1000 });
    const nagaPkg = makePackage({
      price: 2000,
      destination: "Naga",
      handlingBranchId: "naga",
      handlingBranchName: "Naga"
    });
    state.packages.push(daetPkg, nagaPkg);
    state.deliveries.push(makeDelivery(daetPkg.id, "2026-11-10T02:00:00.000Z"), makeDelivery(nagaPkg.id, "2026-11-10T02:00:00.000Z"));
    return { service, daetPkg, nagaPkg };
  }

  test("a scoped caller sees only their branches' slice of a mixed customer", () => {
    const { service, nagaPkg } = twoBranchService();
    const balance = service.getCustomerBalance(CUSTOMER_ID, nagaCaller, NOW);
    expect(balance.totalDue).toBe(2000);
    expect(balance.outstanding).toBe(2000);
    expect(balance.packages.map((row) => row.packageId)).toEqual([nagaPkg.id]);

    const unrestricted = service.getCustomerBalance(CUSTOMER_ID, undefined, NOW);
    expect(unrestricted.totalDue).toBe(3000);
    expect(unrestricted.outstanding).toBe(3000);
  });

  test("a customer whose packages are all in another branch is hidden: list excludes, detail 404s like missing", () => {
    const service = seededService();
    const other = makeCustomer({ id: "cust_p62_daet_only", businessName: "Daet Only Customer" });
    internals(service).customers.push(other);
    const pkg = makePackage({ customerId: other.id, customerName: other.businessName });
    internals(service).packages.push(pkg);
    internals(service).deliveries.push(makeDelivery(pkg.id, "2026-11-10T02:00:00.000Z"));

    const listed = service.listCustomerBalances(nagaCaller, NOW);
    expect(listed.map((entry) => entry.customerId)).toEqual([CUSTOMER_ID]);
    expect(() => service.getCustomerBalance(other.id, nagaCaller, NOW)).toThrow("Customer not found");
    expect(() => service.getCustomerBalance("cust_missing", nagaCaller, NOW)).toThrow("Customer not found");
    // The unrestricted caller still sees the hidden customer's balance.
    expect(service.getCustomerBalance(other.id, undefined, NOW).outstanding).toBe(1000);
  });

  test("list is collection order: biggest outstanding first", () => {
    const service = seededService();
    const small = makeCustomer({ id: "cust_p62_small", businessName: "Aardvark Trading" });
    internals(service).customers.push(small);
    const bigPkg = makePackage({ price: 5000 });
    const smallPkg = makePackage({ customerId: small.id, customerName: small.businessName, price: 100 });
    internals(service).packages.push(bigPkg, smallPkg);
    const listed = service.listCustomerBalances(undefined, NOW);
    expect(listed.map((entry) => entry.customerId)).toEqual([CUSTOMER_ID, small.id]);
  });
});

describe("reports.view enforcement (the balance gate)", () => {
  test("reports.view holders are exactly the owner/admin presets plus Delivery Admin", () => {
    for (const role of ["Administrator", "System Admin", "Daet Owner", "Naga Owner", "Delivery Admin"]) {
      expect(rolePresets[role], role).toContain("reports.view");
    }
    for (const role of ["Receiving Staff", "Delivery Staff", "Customer Owner"]) {
      expect(rolePresets[role], role).not.toContain("reports.view");
    }
  });

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
    const dir = mkdtempSync(join(tmpdir(), "mts-p6-2-"));
    tempRoots.push(dir);
    process.env.INIT_CWD = dir;
    const service = new LogisticsService();
    await service.onModuleInit();
    return service;
  }

  function guardFor(service: LogisticsService) {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === IS_PUBLIC_ROUTE ? false : key === REQUIRED_PERMISSIONS ? undefined : key === REQUIRED_ANY_PERMISSIONS ? ["reports.view", "customers.manage"] : undefined
    };
    const jwt = {
      verify: (token: string) => {
        const payload = verifyAuthToken(token);
        if (!payload) throw new Error("invalid token");
        return payload;
      }
    };
    return new AuthGuard(reflector as never, service, jwt as never);
  }

  function contextFor(token?: string) {
    const request: { headers: Record<string, string>; user?: unknown; path: string } = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      path: "/balances"
    };
    return {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request })
    };
  }

  test("reports.view alone admits, customers.manage alone admits, neither refuses", async () => {
    const service = await bootService();
    const state = internals(service);
    const addUser = (user: StaffUserRecord) => state.customUsers.push(user);
    addUser({ id: "user_p62_deladmin", name: "Fixture Delivery Admin", email: "deladmin.p62@mts.local", role: "Delivery Admin", status: "Active", passwordHash: hashSecret("deladmin-pw-1") });
    addUser({ id: "user_p62_receiving", name: "Fixture Receiving", email: "receiving.p62@mts.local", role: "Receiving Staff", status: "Active", passwordHash: hashSecret("receiving-pw-1") });
    addUser({ id: "user_p62_delivery", name: "Fixture Delivery", email: "delivery.p62@mts.local", role: "Delivery Staff", status: "Active", passwordHash: hashSecret("delivery-pw-1") });
    addUser({ id: "user_p62_customer", name: "Fixture Customer User", email: "customer.p62@mts.local", role: "Customer Owner", status: "Active", passwordHash: hashSecret("customer-pw-1") });

    const guard = guardFor(service);
    const tokenFor = (email: string, password: string): string => service.login({ email, password }).token;
    // Delivery Admin holds reports.view and NOT customers.manage: this
    // admission is reports.view's first real enforcement doing work.
    expect(rolePresets["Delivery Admin"]).not.toContain("customers.manage");
    expect(guard.canActivate(contextFor(tokenFor("deladmin.p62@mts.local", "deladmin-pw-1")) as never)).toBe(true);
    // Receiving Staff holds customers.manage and NOT reports.view.
    expect(rolePresets["Receiving Staff"]).not.toContain("reports.view");
    expect(guard.canActivate(contextFor(tokenFor("receiving.p62@mts.local", "receiving-pw-1")) as never)).toBe(true);
    // Neither permission → refused; no token → refused.
    expect(guard.canActivate(contextFor(tokenFor("delivery.p62@mts.local", "delivery-pw-1")) as never)).toBe(false);
    expect(guard.canActivate(contextFor(tokenFor("customer.p62@mts.local", "customer-pw-1")) as never)).toBe(false);
    expect(guard.canActivate(contextFor(undefined) as never)).toBe(false);

    await service.onModuleDestroy();
  });
});
