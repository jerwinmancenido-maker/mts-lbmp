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
  PaymentRecord,
  StaffUserRecord
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 6 P6-6 — dashboard series + charts data, and the retirement of
 * the dashboard's hardcoded role-name financial gate.
 *
 * What is being proven:
 * - GET /reports/series bucketing: each fact lands on its own
 *   Asia/Manila day — deliveries on the Delivered-record anchor (the
 *   SAME deliveredAtForPackage lookup invoices, balances and the
 *   profitability billed cohort use), collections on the payment's
 *   createdAt, received on the package's createdAt;
 * - Manila midnight edges: a delivery at 23:59 Manila counts that
 *   day, one at 00:01 counts the next — including across a month
 *   boundary (UTC Oct 31 16:30 IS Manila Nov 1 00:30);
 * - every requested day is present and quiet days are explicit
 *   zeros; `days` defaults to 30 and clamps to 1..92;
 * - anchoring consistency: over the same window, the series'
 *   delivery total equals the profitability report's billed-cohort
 *   package count for the same fixture (one anchor, two surfaces);
 * - branch scoping follows the P5-3 list rules per fact;
 * - the endpoint's gate is reports.view ALONE, proven against the
 *   REAL controller handler through the REAL guard;
 * - the dashboard payload's financial fields are decided by the
 *   reports.view PERMISSION now: Delivery Admin (reports.view, not
 *   an owner role — the old role-name list excluded it) receives
 *   them; Delivery Staff does not; owners receive them scoped to
 *   their stored branchAccess, not their role name;
 * - the session user's safe payload carries the resolved permission
 *   list the web shell gates on.
 */

const NOW = new Date("2026-11-12T02:00:00.000Z"); // 10:00 Manila, Nov 12

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

let pkgCounter = 0;
function makePackage(overrides: Partial<CargoPackage> = {}): CargoPackage {
  pkgCounter += 1;
  const number = `PKG-P66-${String(pkgCounter).padStart(4, "0")}`;
  return {
    id: `pkg_p66_${pkgCounter}`,
    packageNumber: number,
    receivingRecordNumber: "RR-P66-0001",
    customerId: "cust_p66",
    customerName: "Series Traders",
    productId: "prod_p66",
    description: "Series cargo",
    quantity: 1,
    unit: "pcs",
    // Handling and destination agree in this fixture so each package
    // has exactly ONE branch attribution and the scoping expectations
    // stay exact (the P5-3 rule itself attributes a package to both
    // its handling and destination branches when they differ).
    destination: "Daet",
    handlingBranchId: "daet",
    handlingBranchName: "Daet",
    deliveryType: "Deliver to consignee",
    condition: "Good",
    status: "Delivered",
    price: 1000,
    qrValue: `MTS:PKG:${number}`,
    photoUrls: [],
    createdAt: "2026-11-10T02:00:00.000Z",
    ...overrides
  };
}

function makeDelivery(cargoPackageId: string, createdAt: string): DeliveryRecord {
  return { id: `del_${cargoPackageId}`, cargoPackageId, status: "Delivered", deliveredTo: "Fixture Receiver", createdAt };
}

let payCounter = 0;
function makePayment(cargoPackageId: string, amountPaid: number, createdAt: string, overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  payCounter += 1;
  return {
    id: `pay_p66_${payCounter}`,
    cargoPackageId,
    amountDue: 0,
    amountPaid,
    balance: 0,
    method: "Cash",
    collectionPoint: "Delivery",
    status: "Paid",
    createdAt,
    ...overrides
  };
}

/**
 * The shared fixture (all dates Manila; NOW = Nov 12):
 * - pkgA: received Nov 10, delivered Nov 10; paid 400 (Nov 10) + 250 (Nov 11).
 * - pkgB: received Oct 31 23:30 Manila, delivered Nov 1 00:30 Manila
 *   (UTC Oct 31 16:30 — the month-boundary crosser); paid 700 Nov 1.
 * - pkgC: received Nov 11, delivered Nov 11 23:59 Manila (15:59Z).
 * - pkgD: received Nov 11, delivered Nov 12 00:01 Manila (Nov 11 16:01Z)
 *   — the midnight-edge pair with pkgC.
 * - pkgE: received Nov 12, not delivered.
 * - pkgF (Naga-handled, Naga destination): received + delivered Nov 10,
 *   paid 500 Nov 10 with branchName "Naga" on the payment.
 */
function fixtureService() {
  const service = new LogisticsService();
  const state = internals(service);
  state.customers.push({ id: "cust_p66", businessName: "Series Traders", status: "Active", billingTerm: "Net 7", billingTermDays: 7 });

  const pkgA = makePackage({ createdAt: "2026-11-10T02:00:00.000Z" });
  const pkgB = makePackage({ createdAt: "2026-10-31T15:30:00.000Z" });
  const pkgC = makePackage({ createdAt: "2026-11-11T02:00:00.000Z" });
  const pkgD = makePackage({ createdAt: "2026-11-11T03:00:00.000Z" });
  const pkgE = makePackage({ createdAt: "2026-11-12T01:00:00.000Z", status: "Received" });
  const pkgF = makePackage({ createdAt: "2026-11-10T04:00:00.000Z", handlingBranchId: "naga", handlingBranchName: "Naga", destination: "Naga" });
  state.packages.push(pkgA, pkgB, pkgC, pkgD, pkgE, pkgF);

  state.deliveries.push(
    makeDelivery(pkgA.id, "2026-11-10T03:00:00.000Z"),
    makeDelivery(pkgB.id, "2026-10-31T16:30:00.000Z"), // Manila Nov 1, 00:30
    makeDelivery(pkgC.id, "2026-11-11T15:59:00.000Z"), // Manila Nov 11, 23:59
    makeDelivery(pkgD.id, "2026-11-11T16:01:00.000Z"), // Manila Nov 12, 00:01
    makeDelivery(pkgF.id, "2026-11-10T05:00:00.000Z")
  );

  state.payments.push(
    makePayment(pkgA.id, 400, "2026-11-10T06:00:00.000Z"),
    makePayment(pkgA.id, 250, "2026-11-11T06:00:00.000Z"),
    makePayment(pkgB.id, 700, "2026-10-31T17:00:00.000Z"), // Manila Nov 1, 01:00
    makePayment(pkgF.id, 500, "2026-11-10T06:30:00.000Z", { branchName: "Naga" })
  );
  return service;
}

function dayOf(series: { days: Array<{ date: string }> }, date: string) {
  return series.days.find((day) => day.date === date);
}

describe("GET /reports/series bucketing", () => {
  test("each fact lands on its own Manila day; quiet days are explicit zeros", () => {
    const series = fixtureService().getReportSeries({}, undefined, NOW);
    expect(series.period).toEqual({ from: "2026-10-14", to: "2026-11-12" });
    expect(series.days).toHaveLength(30);

    expect(dayOf(series, "2026-10-31")).toEqual({ date: "2026-10-31", deliveries: 0, collections: 0, received: 1 });
    // pkgB crossed the month boundary in UTC but not in Manila.
    expect(dayOf(series, "2026-11-01")).toEqual({ date: "2026-11-01", deliveries: 1, collections: 700, received: 0 });
    expect(dayOf(series, "2026-11-10")).toEqual({ date: "2026-11-10", deliveries: 2, collections: 900, received: 2 });
    expect(dayOf(series, "2026-11-11")).toEqual({ date: "2026-11-11", deliveries: 1, collections: 250, received: 2 });
    expect(dayOf(series, "2026-11-12")).toEqual({ date: "2026-11-12", deliveries: 1, collections: 0, received: 1 });
    // A quiet day inside the window is present, all zeros — never a gap.
    expect(dayOf(series, "2026-11-05")).toEqual({ date: "2026-11-05", deliveries: 0, collections: 0, received: 0 });
    expect(series.totals).toEqual({ deliveries: 5, collections: 1850, received: 6 });
  });

  test("Manila midnight edge pair across a month end (Nov 30 23:59 vs Dec 1 00:01)", () => {
    const service = new LogisticsService();
    const state = internals(service);
    const edgeIn = makePackage({ createdAt: "2026-11-29T02:00:00.000Z" });
    const edgeOut = makePackage({ createdAt: "2026-11-29T03:00:00.000Z" });
    state.packages.push(edgeIn, edgeOut);
    state.deliveries.push(
      makeDelivery(edgeIn.id, "2026-11-30T15:59:00.000Z"), // Manila Nov 30, 23:59
      makeDelivery(edgeOut.id, "2026-11-30T16:01:00.000Z") // Manila Dec 1, 00:01
    );
    const dec1 = new Date("2026-12-01T02:00:00.000Z"); // 10:00 Manila, Dec 1
    const series = service.getReportSeries({ days: 2 }, undefined, dec1);
    expect(series.period).toEqual({ from: "2026-11-30", to: "2026-12-01" });
    expect(series.days).toEqual([
      { date: "2026-11-30", deliveries: 1, collections: 0, received: 0 },
      { date: "2026-12-01", deliveries: 1, collections: 0, received: 0 }
    ]);
  });

  test("days parameter: default 30, honoured, clamped to 1..92, non-numeric falls back", () => {
    const service = fixtureService();
    expect(service.getReportSeries({}, undefined, NOW).days).toHaveLength(30);
    const week = service.getReportSeries({ days: 7 }, undefined, NOW);
    expect(week.days).toHaveLength(7);
    expect(week.period).toEqual({ from: "2026-11-06", to: "2026-11-12" });
    expect(service.getReportSeries({ days: "7" }, undefined, NOW).days).toHaveLength(7);
    const clamped = service.getReportSeries({ days: 1000 }, undefined, NOW);
    expect(clamped.days).toHaveLength(92);
    expect(clamped.period).toEqual({ from: "2026-08-13", to: "2026-11-12" });
    const single = service.getReportSeries({ days: 0 }, undefined, NOW);
    expect(single.days).toHaveLength(1);
    expect(single.period).toEqual({ from: "2026-11-12", to: "2026-11-12" });
    expect(service.getReportSeries({ days: "abc" }, undefined, NOW).days).toHaveLength(30);
  });

  test("a payment whose package is gone still counts on its own branchName; an unattributed one counts for unrestricted callers only", () => {
    const service = fixtureService();
    const state = internals(service);
    state.payments.push(makePayment("pkg_p66_missing", 999, "2026-11-10T07:00:00.000Z", { branchName: "Daet" }));
    state.payments.push(makePayment("pkg_p66_missing_2", 111, "2026-11-10T08:00:00.000Z"));

    const all = service.getReportSeries({}, undefined, NOW);
    expect(dayOf(all, "2026-11-10")?.collections).toBe(900 + 999 + 111);
    // Daet sees its own package payment (400) + the Daet-named orphan
    // (999) + the fully unattributed orphan (111 — no branch to hide
    // it from, the P5-3 list rule). The Naga payment (500) stays out.
    const daet = service.getReportSeries({}, { role: "Daet Owner", branchAccess: "Daet" }, NOW);
    expect(dayOf(daet, "2026-11-10")?.collections).toBe(400 + 999 + 111);
    // Naga sees its own payment (500) + the unattributed orphan (111);
    // the Daet-named orphan (999) is another branch's money.
    const naga = service.getReportSeries({}, { role: "Naga Owner", branchAccess: "Naga" }, NOW);
    expect(dayOf(naga, "2026-11-10")?.collections).toBe(500 + 111);
  });
});

describe("series anchoring consistency with P6-1/P6-5", () => {
  test("series delivery total over Nov 1–12 equals the profitability billed cohort for the same fixture", () => {
    const service = fixtureService();
    const series = service.getReportSeries({ days: 12 }, undefined, NOW);
    expect(series.period).toEqual({ from: "2026-11-01", to: "2026-11-12" });
    const report = service.getProfitabilityReport({ from: "2026-11-01", to: "2026-11-12", groupBy: "trip" }, undefined, NOW);
    const billedCohort = report.groups.reduce((sum, group) => sum + group.packageCount, 0);
    // All fixture packages are priced, so the delivered cohort is the
    // same set on both surfaces — pkgB (Manila Nov 1) included, pkgE
    // (never delivered) excluded from both.
    expect(billedCohort).toBe(5);
    expect(series.totals.deliveries).toBe(billedCohort);
    expect(dayOf(series, "2026-11-01")?.deliveries).toBe(1);
  });
});

describe("series branch scoping (P5-3 list rules per fact)", () => {
  test("a Daet-scoped caller sees Daet facts only; a Naga-scoped caller sees Naga facts only", () => {
    const service = fixtureService();
    const daet = service.getReportSeries({}, { role: "Daet Owner", branchAccess: "Daet" }, NOW);
    expect(dayOf(daet, "2026-11-10")).toEqual({ date: "2026-11-10", deliveries: 1, collections: 400, received: 1 });
    expect(daet.totals).toEqual({ deliveries: 4, collections: 1350, received: 5 });

    const naga = service.getReportSeries({}, { role: "Naga Owner", branchAccess: "Naga" }, NOW);
    expect(dayOf(naga, "2026-11-10")).toEqual({ date: "2026-11-10", deliveries: 1, collections: 500, received: 1 });
    expect(naga.totals).toEqual({ deliveries: 1, collections: 500, received: 1 });
  });
});

describe("dashboard financial fields follow the reports.view permission (P6-6)", () => {
  test("Delivery Admin — reports.view without an owner role name — now receives the financial fields", () => {
    const dashboard = fixtureService().getDashboard({ role: "Delivery Admin", branchAccess: "Daet / Naga" }) as unknown as Record<string, unknown>;
    expect(dashboard.paymentsCollected).toBe(1850);
    expect(typeof dashboard.profitThisMonth).toBe("number");
    expect(typeof dashboard.expensesAwaitingApproval).toBe("number");
    expect(dashboard.branchScope).toBe("All branches");
    expect("estimatedProfit" in dashboard).toBe(false);
  });

  test("roles without reports.view get NO financial fields (payload assertion, not just absence of tiles)", () => {
    for (const role of ["Delivery Staff", "Receiving Staff", "Customer Owner"]) {
      const dashboard = fixtureService().getDashboard({ role, branchAccess: "Daet" }) as unknown as Record<string, unknown>;
      expect(dashboard.paymentsCollected, role).toBeUndefined();
      expect(dashboard.profitThisMonth, role).toBeUndefined();
      expect(dashboard.profitThisMonthPeriod, role).toBeUndefined();
      expect(dashboard.expensesAwaitingApproval, role).toBeUndefined();
      // The operational fields are NOT permission-gated — they stay.
      expect(typeof dashboard.cargoWaiting, role).toBe("number");
      expect(typeof dashboard.delivered, role).toBe("number");
    }
  });

  test("owner financials are scoped by the stored branchAccess, matching the series scope", () => {
    const service = fixtureService();
    const daet = service.getDashboard({ role: "Daet Owner", branchAccess: "Daet" }) as unknown as Record<string, unknown>;
    expect(daet.branchScope).toBe("Daet");
    expect(daet.paymentsCollected).toBe(1350);
    const naga = service.getDashboard({ role: "Naga Owner", branchAccess: "Naga" }) as unknown as Record<string, unknown>;
    expect(naga.branchScope).toBe("Naga");
    expect(naga.paymentsCollected).toBe(500);
    // The role NAME no longer scopes: an owner-role account whose
    // stored access covers both branches sees both branches.
    const both = service.getDashboard({ role: "Daet Owner", branchAccess: "All branches" }) as unknown as Record<string, unknown>;
    expect(both.branchScope).toBe("All branches");
    expect(both.paymentsCollected).toBe(1850);
  });
});

describe("reports.view enforcement on GET /reports/series + session permissions payload", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "mts-p6-6-"));
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
      path: "/reports/series"
    };
    return {
      getHandler: () => handler,
      getClass: () => LogisticsController,
      switchToHttp: () => ({ getRequest: () => request })
    };
  }

  test("reports.view admits (Delivery Admin, owners); its absence refuses — and the login payload carries the permission list", async () => {
    const service = await bootService();
    const state = internals(service);
    state.customUsers.push(
      { id: "user_p66_deladmin", name: "Fixture Delivery Admin", email: "deladmin.p66@mts.local", role: "Delivery Admin", status: "Active", passwordHash: hashSecret("deladmin-pw-1") },
      { id: "user_p66_receiving", name: "Fixture Receiving", email: "receiving.p66@mts.local", role: "Receiving Staff", status: "Active", passwordHash: hashSecret("receiving-pw-1") },
      { id: "user_p66_delivery", name: "Fixture Delivery", email: "delivery.p66@mts.local", role: "Delivery Staff", status: "Active", passwordHash: hashSecret("delivery-pw-1") }
    );

    const guard = guardFor(service);
    const handler = LogisticsController.prototype.reportSeries as () => void;
    const login = (email: string, password: string) => service.login({ email, password });

    const delAdmin = login("deladmin.p66@mts.local", "deladmin-pw-1");
    expect(guard.canActivate(contextFor(handler, delAdmin.token) as never)).toBe(true);
    expect(guard.canActivate(contextFor(handler, login("receiving.p66@mts.local", "receiving-pw-1").token) as never)).toBe(false);
    expect(guard.canActivate(contextFor(handler, login("delivery.p66@mts.local", "delivery-pw-1").token) as never)).toBe(false);
    expect(guard.canActivate(contextFor(handler, undefined) as never)).toBe(false);

    // The web shell gates the charts + financial tiles on this list:
    // it is the resolved preset, identical to what the guard enforces.
    const delAdminUser = delAdmin.user as unknown as { permissions?: string[] };
    expect(delAdminUser.permissions).toEqual([...rolePresets["Delivery Admin"]]);
    expect(delAdminUser.permissions).toContain("reports.view");
    const receivingUser = login("receiving.p66@mts.local", "receiving-pw-1").user as unknown as { permissions?: string[] };
    expect(receivingUser.permissions).not.toContain("reports.view");

    await service.onModuleDestroy();
  });
});
