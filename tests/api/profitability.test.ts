import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rolePresets } from "@mts-lbmp/permissions";
import { AuthGuard } from "../../apps/api/src/modules/auth.guard";
import { LogisticsController } from "../../apps/api/src/modules/logistics.controller";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { hashSecret, verifyAuthToken } from "../../apps/api/src/modules/security";
import type {
  CargoPackage,
  Customer,
  DeliveryRecord,
  ExpenseRecord,
  PaymentRecord,
  StaffUserRecord,
  Trip
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 6 P6-5 — profitability reports + expense trip discipline.
 *
 * What is being proven:
 * - rollup math per groupBy (trip / route / customer / branch) over one
 *   fixture spanning two routes, two customers, four trips and a
 *   trip-less delivery: billed anchors on the DELIVERY date, collected
 *   on the PAYMENT date (a November payment for an October delivery
 *   counts as collected, not billed), outstanding is today's remaining
 *   balance of the period's delivered cohort;
 * - margin = billed − APPROVED expenses linked to the group's trips,
 *   broken down by category; on the customer view no margin is shown
 *   (expenses are never recorded against a customer);
 * - approved expenses with no trip link land in an explicit unallocated
 *   bucket in every view — never spread, never dropped; submitted /
 *   rejected / out-of-period expenses count nowhere;
 * - period boundaries are Manila calendar edges: delivered 23:59 Manila
 *   on Nov 30 is in November, 00:01 Manila on Dec 1 is not;
 * - expense discipline: Fuel / Toll / Truck Rental require a real trip
 *   (400 without one, 400 for a missing trip, case-insensitive match);
 *   other categories are unchanged;
 * - the dashboard's profitThisMonth is month-scoped (P6-6 removed the
 *   deprecated all-time estimatedProfit after its one release — the
 *   dashboard test below now pins its ABSENCE);
 * - branch scoping follows P5-3 per fact, and the endpoint's gate is
 *   reports.view ALONE (customers.manage does not admit — the documented
 *   difference from the balances endpoints).
 */

const NOW = new Date("2026-11-12T02:00:00.000Z"); // 10:00 Manila, Nov 12
const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  customers: Customer[];
  packages: CargoPackage[];
  payments: PaymentRecord[];
  deliveries: DeliveryRecord[];
  expenses: ExpenseRecord[];
  trips: Trip[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const CUST_A = "cust_p65_alpha";
const CUST_B = "cust_p65_beta";

function makeCustomer(id: string, businessName: string): Customer {
  return { id, businessName, status: "Active", billingTerm: "Net 7", billingTermDays: 7 };
}

function makeTrip(id: string, tripNumber: string, origin: string, destination: string, cargoPackageIds: string[]): Trip {
  return {
    id,
    tripNumber,
    origin,
    destination,
    status: "Completed",
    isMixedTrip: false,
    cargoPackageIds,
    createdAt: "2026-11-01T00:00:00.000Z"
  };
}

let pkgCounter = 0;
function makePackage(overrides: Partial<CargoPackage> = {}): CargoPackage {
  pkgCounter += 1;
  const number = `PKG-P65-${String(pkgCounter).padStart(4, "0")}`;
  return {
    id: `pkg_p65_${pkgCounter}`,
    packageNumber: number,
    receivingRecordNumber: "RR-P65-0001",
    customerId: CUST_A,
    customerName: "Alpha Traders",
    productId: "prod_p65",
    description: "Rebar",
    quantity: 1,
    unit: "pcs",
    destination: "Naga",
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
function makePayment(cargoPackageId: string, amountPaid: number, createdAt: string): PaymentRecord {
  payCounter += 1;
  return {
    id: `pay_p65_${payCounter}`,
    cargoPackageId,
    amountDue: 0,
    amountPaid,
    balance: 0,
    method: "Cash",
    collectionPoint: "Delivery",
    status: "Partially Paid",
    createdAt
  };
}

function makeExpense(overrides: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id: `exp_p65_${Math.random().toString(36).slice(2, 9)}`,
    category: "Fuel",
    amount: 100,
    status: "Approved",
    createdAt: "2026-11-06T02:00:00.000Z",
    ...overrides
  };
}

/**
 * The shared fixture (all dates Manila):
 * - trip1 TR-001 Daet→Naga carries A1 (Alpha, 1000, delivered Nov 5,
 *   paid 400 in Nov + 200 in Oct) and B1 (Beta, 2000, delivered Nov 5,
 *   paid in full Nov 7).
 * - trip2 TR-002 Naga→Daet carries A2 (Alpha, 500, delivered Manila
 *   Nov 1 00:30) and Old (Alpha, 700, delivered Oct 15, paid Nov 3).
 * - trip4 TR-004 Daet→Naga carries the month-edge pair: EdgeIn (900,
 *   delivered Nov 30 23:59 Manila) and EdgeOut (950, Dec 1 00:01).
 * - tripNaga TR-005 Naga→Naga carries Naga1 (Beta, 4000, Nov 5).
 * - NoTrip (Beta, 300, Daet handling, delivered Nov 8) rides no trip.
 * - Expenses: approved Fuel 300 + Toll 100 on trip1, Fuel 250 on trip2,
 *   Fuel 600 on tripNaga; a Submitted and a Rejected on trip1 and an
 *   October approved Fuel on trip1 count nowhere; unlinked approved
 *   Fuel 500 + Branch Expense 150 and a dangling-trip Fuel 777 are the
 *   unallocated bucket (1427 across 3 records).
 */
function fixtureService() {
  const service = new LogisticsService();
  const state = internals(service);
  state.customers.push(makeCustomer(CUST_A, "Alpha Traders"), makeCustomer(CUST_B, "Beta Builders"));

  const a1 = makePackage({ customerId: CUST_A, customerName: "Alpha Traders", price: 1000 });
  const b1 = makePackage({ customerId: CUST_B, customerName: "Beta Builders", price: 2000 });
  const a2 = makePackage({ customerId: CUST_A, customerName: "Alpha Traders", price: 500, handlingBranchId: "naga", handlingBranchName: "Naga", destination: "Daet" });
  const old = makePackage({ customerId: CUST_A, customerName: "Alpha Traders", price: 700, handlingBranchId: "naga", handlingBranchName: "Naga", destination: "Daet" });
  const edgeIn = makePackage({ customerId: CUST_A, customerName: "Alpha Traders", price: 900 });
  const edgeOut = makePackage({ customerId: CUST_A, customerName: "Alpha Traders", price: 950 });
  const naga1 = makePackage({ customerId: CUST_B, customerName: "Beta Builders", price: 4000, handlingBranchId: "naga", handlingBranchName: "Naga", destination: "Naga" });
  const noTrip = makePackage({ customerId: CUST_B, customerName: "Beta Builders", price: 300, destination: "Daet" });
  const unpriced = makePackage({ customerId: CUST_A, customerName: "Alpha Traders", price: null, destination: "Daet" });
  state.packages.push(a1, b1, a2, old, edgeIn, edgeOut, naga1, noTrip, unpriced);

  state.deliveries.push(
    makeDelivery(a1.id, "2026-11-05T02:00:00.000Z"),
    makeDelivery(b1.id, "2026-11-05T03:00:00.000Z"),
    makeDelivery(a2.id, "2026-10-31T16:30:00.000Z"), // Manila Nov 1, 00:30
    makeDelivery(old.id, "2026-10-15T02:00:00.000Z"),
    makeDelivery(edgeIn.id, "2026-11-30T15:59:00.000Z"), // Manila Nov 30, 23:59
    makeDelivery(edgeOut.id, "2026-11-30T16:01:00.000Z"), // Manila Dec 1, 00:01
    makeDelivery(naga1.id, "2026-11-05T04:00:00.000Z"),
    makeDelivery(noTrip.id, "2026-11-08T02:00:00.000Z"),
    makeDelivery(unpriced.id, "2026-11-06T02:00:00.000Z")
  );

  state.payments.push(
    makePayment(a1.id, 400, "2026-11-06T02:00:00.000Z"),
    makePayment(a1.id, 200, "2026-10-20T02:00:00.000Z"),
    makePayment(b1.id, 2000, "2026-11-07T02:00:00.000Z"),
    makePayment(old.id, 700, "2026-11-03T02:00:00.000Z")
  );

  state.trips.push(
    makeTrip("trip_p65_1", "TR-001", "Daet", "Naga", [a1.id, b1.id]),
    makeTrip("trip_p65_2", "TR-002", "Naga", "Daet", [a2.id, old.id]),
    makeTrip("trip_p65_4", "TR-004", "Daet", "Naga", [edgeIn.id, edgeOut.id]),
    makeTrip("trip_p65_naga", "TR-005", "Naga", "Naga", [naga1.id])
  );

  state.expenses.push(
    makeExpense({ tripId: "trip_p65_1", category: "Fuel", amount: 300 }),
    makeExpense({ tripId: "trip_p65_1", category: "Toll", amount: 100, createdAt: "2026-11-06T03:00:00.000Z" }),
    makeExpense({ tripId: "trip_p65_2", category: "Fuel", amount: 250, createdAt: "2026-11-02T02:00:00.000Z" }),
    makeExpense({ tripId: "trip_p65_naga", category: "Fuel", amount: 600 }),
    makeExpense({ tripId: "trip_p65_1", category: "Fuel", amount: 999, status: "Submitted" }),
    makeExpense({ tripId: "trip_p65_1", category: "Repairs", amount: 888, status: "Rejected" }),
    makeExpense({ tripId: "trip_p65_1", category: "Fuel", amount: 400, createdAt: "2026-10-06T02:00:00.000Z" }),
    makeExpense({ category: "Fuel", amount: 500, createdAt: "2026-11-09T02:00:00.000Z" }),
    makeExpense({ category: "Branch Expense", amount: 150, createdAt: "2026-11-09T03:00:00.000Z" }),
    makeExpense({ tripId: "trip_p65_missing", category: "Fuel", amount: 777, createdAt: "2026-11-09T04:00:00.000Z" })
  );
  return service;
}

describe("profitability rollups", () => {
  test("trip view: billed / collected / outstanding / margin per trip, sorted by billed", () => {
    const report = fixtureService().getProfitabilityReport({ ...NOVEMBER, groupBy: "trip" }, undefined, NOW);
    expect(report.period).toEqual(NOVEMBER);
    expect(report.groups.map((group) => group.label)).toEqual(["TR-005 · Naga → Naga", "TR-001 · Daet → Naga", "TR-004 · Daet → Naga", "TR-002 · Naga → Daet", "No trip recorded"]);

    const byKey = new Map(report.groups.map((group) => [group.key, group]));
    expect(byKey.get("trip_p65_1")).toMatchObject({
      billed: 3000,
      collected: 2400,
      outstanding: 400,
      packageCount: 2,
      linkedExpenses: 400,
      margin: 2600
    });
    expect(byKey.get("trip_p65_1")?.linkedExpensesByCategory).toEqual([
      { category: "Fuel", amount: 300 },
      { category: "Toll", amount: 100 }
    ]);
    // Old was delivered in October: its November payment is collected
    // here, but it adds nothing to billed or the cohort outstanding.
    expect(byKey.get("trip_p65_2")).toMatchObject({ billed: 500, collected: 700, outstanding: 500, packageCount: 1, linkedExpenses: 250, margin: 250 });
    expect(byKey.get("trip_p65_4")).toMatchObject({ billed: 900, collected: 0, outstanding: 900, packageCount: 1, margin: 900 });
    expect(byKey.get("trip_p65_naga")).toMatchObject({ billed: 4000, outstanding: 4000, linkedExpenses: 600, margin: 3400 });
    expect(byKey.get("no-trip")).toMatchObject({ billed: 300, collected: 0, outstanding: 300, packageCount: 1, linkedExpenses: 0, margin: 300 });

    expect(report.totals).toEqual({ billed: 8700, collected: 3100, outstanding: 6100, approvedExpenses: 2677, margin: 7450 });
    expect(report.tripLinkedExpenses).toMatchObject({ total: 1250, count: 4 });
    expect(report.definition).toContain("Margin = billed");
  });

  test("route view: trips sharing a route roll together", () => {
    const report = fixtureService().getProfitabilityReport({ ...NOVEMBER, groupBy: "route" }, undefined, NOW);
    const byKey = new Map(report.groups.map((group) => [group.key, group]));
    expect(byKey.get("Daet → Naga")).toMatchObject({ billed: 3900, collected: 2400, outstanding: 1300, packageCount: 3, linkedExpenses: 400, margin: 3500 });
    expect(byKey.get("Naga → Daet")).toMatchObject({ billed: 500, collected: 700, outstanding: 500, linkedExpenses: 250, margin: 250 });
    expect(byKey.get("Naga → Naga")).toMatchObject({ billed: 4000, outstanding: 4000, linkedExpenses: 600, margin: 3400 });
    expect(byKey.get("no-trip")).toMatchObject({ billed: 300, margin: 300 });
    expect(report.totals.billed).toBe(8700);
  });

  test("customer view: revenue side only — margin is null, expenses never attributed", () => {
    const report = fixtureService().getProfitabilityReport({ ...NOVEMBER, groupBy: "customer" }, undefined, NOW);
    const byKey = new Map(report.groups.map((group) => [group.key, group]));
    expect(byKey.get(CUST_A)).toMatchObject({ label: "Alpha Traders", billed: 2400, collected: 1100, outstanding: 1800, packageCount: 3, linkedExpenses: 0, margin: null });
    expect(byKey.get(CUST_B)).toMatchObject({ label: "Beta Builders", billed: 6300, collected: 2000, outstanding: 4300, packageCount: 3, margin: null });
    expect(report.totals.margin).toBeNull();
    // Trip-linked costs stay visible as context, not allocated.
    expect(report.tripLinkedExpenses.total).toBe(1250);
    expect(report.definition).toContain("revenue-side only");
  });

  test("branch view: cargo attributes to its trip's destination branch", () => {
    const report = fixtureService().getProfitabilityReport({ ...NOVEMBER, groupBy: "branch" }, undefined, NOW);
    const byKey = new Map(report.groups.map((group) => [group.key, group]));
    expect(byKey.get("Naga")).toMatchObject({ billed: 7900, collected: 2400, outstanding: 5300, packageCount: 4, linkedExpenses: 1000, margin: 6900 });
    expect(byKey.get("Naga")?.linkedExpensesByCategory).toEqual([
      { category: "Fuel", amount: 900 },
      { category: "Toll", amount: 100 }
    ]);
    expect(byKey.get("Daet")).toMatchObject({ billed: 800, collected: 700, outstanding: 800, packageCount: 2, linkedExpenses: 250, margin: 550 });
    expect(report.definition).toContain("destination branch");
  });

  test("unallocated bucket: approved + in period + no usable trip link, in every view", () => {
    const service = fixtureService();
    for (const groupBy of ["trip", "route", "customer", "branch"] as const) {
      const report = service.getProfitabilityReport({ ...NOVEMBER, groupBy }, undefined, NOW);
      expect(report.unallocatedExpenses.total, groupBy).toBe(1427);
      expect(report.unallocatedExpenses.count, groupBy).toBe(3);
      expect(report.unallocatedExpenses.byCategory, groupBy).toEqual([
        { category: "Fuel", amount: 1277 },
        { category: "Branch Expense", amount: 150 }
      ]);
    }
  });

  test("default period is the current Manila month to date; groupBy defaults to trip", () => {
    const report = fixtureService().getProfitabilityReport({}, undefined, NOW);
    expect(report.period).toEqual({ from: "2026-11-01", to: "2026-11-12" });
    expect(report.groupBy).toBe("trip");
    // EdgeIn (Nov 30) is beyond the default period end.
    expect(report.groups.map((group) => group.key)).not.toContain("trip_p65_4");
    expect(report.totals.billed).toBe(7800);
  });
});

describe("period boundaries (Manila calendar edges)", () => {
  test("23:59 Manila on the last day is in; 00:01 Manila on the first of next month is out", () => {
    const service = fixtureService();
    const nov30 = service.getProfitabilityReport({ from: "2026-11-30", to: "2026-11-30", groupBy: "trip" }, undefined, NOW);
    expect(nov30.groups).toHaveLength(1);
    expect(nov30.groups[0]).toMatchObject({ key: "trip_p65_4", billed: 900 });

    const dec1 = service.getProfitabilityReport({ from: "2026-12-01", to: "2026-12-01", groupBy: "trip" }, undefined, new Date("2026-12-05T02:00:00.000Z"));
    expect(dec1.groups).toHaveLength(1);
    expect(dec1.groups[0]).toMatchObject({ key: "trip_p65_4", billed: 950 });
  });

  test("00:30 Manila on the 1st belongs to the new month, not the old one", () => {
    const service = fixtureService();
    const nov1 = service.getProfitabilityReport({ from: "2026-11-01", to: "2026-11-01", groupBy: "trip" }, undefined, NOW);
    expect(nov1.groups.map((group) => group.key)).toEqual(["trip_p65_2"]);
    expect(nov1.groups[0]?.billed).toBe(500);
    const oct31 = service.getProfitabilityReport({ from: "2026-10-31", to: "2026-10-31", groupBy: "trip" }, undefined, NOW);
    expect(oct31.totals.billed).toBe(0);
  });

  test("invalid periods are refused: reversed range, impossible date, unknown grouping", () => {
    const service = fixtureService();
    expect(() => service.getProfitabilityReport({ from: "2026-11-30", to: "2026-11-01" }, undefined, NOW)).toThrow("must not be after");
    expect(() => service.getProfitabilityReport({ from: "2026-02-31", to: "2026-11-30" }, undefined, NOW)).toThrow("YYYY-MM-DD");
    expect(() => service.getProfitabilityReport({ from: "12/11/2026", to: "2026-11-30" }, undefined, NOW)).toThrow("YYYY-MM-DD");
    expect(() => service.getProfitabilityReport({ ...NOVEMBER, groupBy: "driver" as never }, undefined, NOW)).toThrow("groupBy");
  });
});

describe("branch scoping", () => {
  test("a Daet-scoped caller never sees the Naga-only trip, its cargo, or its expenses", () => {
    const daetCaller = { id: "user_p65_daet", role: "Daet Owner", branchAccess: "Daet" };
    const report = fixtureService().getProfitabilityReport({ ...NOVEMBER, groupBy: "trip" }, daetCaller, NOW);
    expect(report.groups.map((group) => group.key)).not.toContain("trip_p65_naga");
    // Trips touching Daet stay whole (their cargo is visible per package).
    expect(report.totals.billed).toBe(4700);
    expect(report.tripLinkedExpenses.total).toBe(650);
    // Unattributed expenses are not branch facts: the bucket stays whole.
    expect(report.unallocatedExpenses.total).toBe(1427);

    const unrestricted = fixtureService().getProfitabilityReport({ ...NOVEMBER, groupBy: "trip" }, undefined, NOW);
    expect(unrestricted.groups.map((group) => group.key)).toContain("trip_p65_naga");
  });
});

describe("expense trip discipline", () => {
  function disciplineService() {
    const service = new LogisticsService();
    internals(service).trips.push(makeTrip("trip_p65_1", "TR-001", "Daet", "Naga", []));
    return service;
  }

  const attempt = (service: LogisticsService, input: Parameters<LogisticsService["createExpense"]>[0]) => async () => {
    await service.createExpense(input);
  };

  test("Fuel / Toll / Truck Rental without a trip are refused with a clear 400", async () => {
    const service = disciplineService();
    await expect(attempt(service, { category: "Fuel", amount: 100 })()).rejects.toThrow("must name the trip");
    await expect(attempt(service, { category: "Toll", amount: 100 })()).rejects.toThrow("must name the trip");
    await expect(attempt(service, { category: "Truck Rental", amount: 100 })()).rejects.toThrow("must name the trip");
    await expect(attempt(service, { category: " fuel ", amount: 100 })()).rejects.toThrow("must name the trip");
    expect(internals(service).expenses).toHaveLength(0);
  });

  test("a named trip that does not exist is refused", async () => {
    const service = disciplineService();
    await expect(attempt(service, { category: "Fuel", amount: 100, tripId: "trip_missing" })()).rejects.toThrow("was not found");
  });

  test("trip categories with a real trip save normally; other categories need no trip", async () => {
    const service = disciplineService();
    const fuel = await service.createExpense({ category: "Fuel", amount: 100, tripId: "trip_p65_1" });
    expect(fuel).toMatchObject({ category: "Fuel", tripId: "trip_p65_1", status: "Submitted" });
    const toll = await service.createExpense({ category: "toll", amount: 50, tripId: "trip_p65_1" });
    expect(toll.tripId).toBe("trip_p65_1");
    const meals = await service.createExpense({ category: "Meals", amount: 75 });
    expect(meals.tripId).toBeUndefined();
    expect(internals(service).expenses).toHaveLength(3);
  });
});

describe("dashboard profit definitions", () => {
  test("profitThisMonth is month-scoped; the deprecated estimatedProfit is gone (P6-6)", () => {
    const service = new LogisticsService();
    const state = internals(service);
    const nowIso = new Date().toISOString();
    const deliveredNow = makePackage({ price: 1000 });
    const deliveredOld = makePackage({ price: 5000 });
    state.packages.push(deliveredNow, deliveredOld);
    state.deliveries.push(makeDelivery(deliveredNow.id, nowIso), makeDelivery(deliveredOld.id, "2026-07-01T02:00:00.000Z"));
    state.expenses.push(
      makeExpense({ amount: 300, createdAt: nowIso }),
      makeExpense({ amount: 2000, createdAt: "2026-07-02T02:00:00.000Z" }),
      makeExpense({ amount: 999, status: "Submitted", createdAt: nowIso })
    );

    const dashboard = service.getDashboard({ id: "user_p65_admin", role: "System Admin", branchAccess: "All branches" }) as unknown as Record<string, unknown>;
    expect(dashboard.profitThisMonth).toBe(700);
    // P6-6: estimatedProfit (all-time delivered revenue − all-time
    // approved expenses; it would have read 3700 on this fixture) was
    // removed after its one deprecated release — the key must not
    // exist at all, not merely be undefined.
    expect("estimatedProfit" in dashboard).toBe(false);
    expect(dashboard.estimatedProfit).toBeUndefined();
    const expectedPeriod = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date());
    expect(dashboard.profitThisMonthPeriod).toBe(expectedPeriod);
  });
});

describe("reports.view enforcement (the profitability gate)", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "mts-p6-5-"));
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
    // The REAL Reflector + the REAL controller handler: the test proves
    // the decorator on the actual endpoint, not a paraphrase of it.
    return new AuthGuard(new Reflector(), service, jwt as never);
  }

  function contextFor(handler: () => void, token?: string) {
    const request: { headers: Record<string, string>; user?: unknown; path: string } = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      path: "/reports/profitability"
    };
    return {
      getHandler: () => handler,
      getClass: () => LogisticsController,
      switchToHttp: () => ({ getRequest: () => request })
    };
  }

  test("reports.view holders are exactly the owner/admin presets plus Delivery Admin", () => {
    for (const role of ["Administrator", "System Admin", "Daet Owner", "Naga Owner", "Delivery Admin"]) {
      expect(rolePresets[role], role).toContain("reports.view");
    }
    for (const role of ["Receiving Staff", "Delivery Staff", "Customer Owner"]) {
      expect(rolePresets[role], role).not.toContain("reports.view");
    }
  });

  test("reports.view alone admits; customers.manage alone does NOT (unlike balances)", async () => {
    const service = await bootService();
    const state = internals(service);
    const addUser = (user: StaffUserRecord) => state.customUsers.push(user);
    addUser({ id: "user_p65_deladmin", name: "Fixture Delivery Admin", email: "deladmin.p65@mts.local", role: "Delivery Admin", status: "Active", passwordHash: hashSecret("deladmin-pw-1") });
    addUser({ id: "user_p65_receiving", name: "Fixture Receiving", email: "receiving.p65@mts.local", role: "Receiving Staff", status: "Active", passwordHash: hashSecret("receiving-pw-1") });
    addUser({ id: "user_p65_delivery", name: "Fixture Delivery", email: "delivery.p65@mts.local", role: "Delivery Staff", status: "Active", passwordHash: hashSecret("delivery-pw-1") });
    addUser({ id: "user_p65_customer", name: "Fixture Customer User", email: "customer.p65@mts.local", role: "Customer Owner", status: "Active", passwordHash: hashSecret("customer-pw-1") });

    const guard = guardFor(service);
    const tokenFor = (email: string, password: string): string => service.login({ email, password }).token;
    const handler = LogisticsController.prototype.profitability as () => void;

    // Delivery Admin holds reports.view and NOT customers.manage — admitted.
    expect(rolePresets["Delivery Admin"]).not.toContain("customers.manage");
    expect(guard.canActivate(contextFor(handler, tokenFor("deladmin.p65@mts.local", "deladmin-pw-1")) as never)).toBe(true);
    // Receiving Staff holds customers.manage and NOT reports.view. The
    // balances endpoints admit it via the any-of pair; profitability is
    // reports.view proper, so it is refused here — deliberately.
    expect(rolePresets["Receiving Staff"]).toContain("customers.manage");
    expect(guard.canActivate(contextFor(handler, tokenFor("receiving.p65@mts.local", "receiving-pw-1")) as never)).toBe(false);
    expect(guard.canActivate(contextFor(handler, tokenFor("delivery.p65@mts.local", "delivery-pw-1")) as never)).toBe(false);
    expect(guard.canActivate(contextFor(handler, tokenFor("customer.p65@mts.local", "customer-pw-1")) as never)).toBe(false);
    expect(guard.canActivate(contextFor(handler, undefined) as never)).toBe(false);

    await service.onModuleDestroy();
  });
});
