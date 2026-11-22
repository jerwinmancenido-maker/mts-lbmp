import { describe, expect, test } from "vitest";
import { dashboardScopeLabel, dashboardTiles } from "../../apps/web/src/app/ui/dashboard-tiles";
import type { DashboardData } from "../../apps/web/src/app/ui/types";

/**
 * Round 1 fix loop PR-11 — dashboard tile data flow, web surface
 * (canonical finding C-M13; filed as L1 B-F4 = C-F2, Major).
 *
 * The finding: on the direct login → Dashboard path, the six count
 * tiles read 0 while the same screen's money tiles and activity
 * chart showed the true figures. The verifier proved the mechanism
 * live: the count tiles were computed from the shell's package/trip
 * list state, which the Dashboard never loads (the lists populate
 * only after visiting another tab), and once loaded they followed
 * the branch-workspace context instead of the user's API scope.
 *
 * The fix pinned here: dashboardTiles takes the API dashboard
 * payload (GET /dashboard — the source the money tiles and chart
 * already trust, scoped server-side by the user's stored
 * branchAccess) and NO list state at all. The signature is the
 * guarantee: there is no list input left to disagree with.
 *
 * The payload fixture uses the verifier's own reproduced figures
 * (GET /dashboard for the admin in the round: cargoWaiting 5,
 * delivered 7, paymentsCollected ₱1,400, profitThisMonth ₱4,450).
 */

const verifierPayload: DashboardData = {
  cargoWaiting: 5,
  cargoWithoutPrice: 3,
  pendingCustomers: 2,
  activeTrips: 6,
  delivered: 7,
  failedDeliveries: 1,
  paymentsCollected: 1400,
  expensesAwaitingApproval: 4,
  profitThisMonth: 4450,
  profitThisMonthPeriod: "2026-11",
  branchScope: "All branches",
  notifications: []
};

function byKey(tiles: ReturnType<typeof dashboardTiles>) {
  return new Map(tiles.map((tile) => [tile.key, tile]));
}

describe("dashboardTiles — count tiles read the API dashboard payload (C-M13)", () => {
  test("all six count tiles take the payload's figures", () => {
    const tiles = byKey(dashboardTiles(verifierPayload, { canViewFinancialSummary: true, collectedTotal: 0, unpaidCount: 0 }));
    expect(tiles.get("waiting")?.value).toBe(5);
    expect(tiles.get("withoutPrice")?.value).toBe(3);
    expect(tiles.get("pendingCustomers")?.value).toBe(2);
    expect(tiles.get("activeTrips")?.value).toBe(6);
    expect(tiles.get("delivered")?.value).toBe(7);
    expect(tiles.get("failedDelivery")?.value).toBe(1);
  });

  test("tile order and labels are the screen's stable set", () => {
    const tiles = dashboardTiles(verifierPayload, { canViewFinancialSummary: true, collectedTotal: 0, unpaidCount: 0 });
    expect(tiles.map((tile) => tile.key)).toEqual([
      "waiting",
      "withoutPrice",
      "pendingCustomers",
      "activeTrips",
      "delivered",
      "failedDelivery",
      "payments",
      "expenses",
      "profit"
    ]);
    expect(tiles.map((tile) => tile.label)).toEqual([
      "Cargo Waiting",
      "Without Price",
      "Customer Pending",
      "Active Trips",
      "Delivered",
      "Failed Delivery",
      "Payments",
      "Expenses Review",
      "Profit This Month"
    ]);
  });

  test("financial tiles read the payload's money figures, PHP-formatted", () => {
    const tiles = byKey(dashboardTiles(verifierPayload, { canViewFinancialSummary: true, collectedTotal: 0, unpaidCount: 0 }));
    expect(tiles.get("payments")?.value).toBe("PHP 1,400.00");
    expect(tiles.get("expenses")?.value).toBe(4);
    expect(tiles.get("profit")?.value).toBe("PHP 4,450.00");
  });

  test("money tiles are flagged for the one-line treatment; count tiles are not (R2-05)", () => {
    const tiles = byKey(dashboardTiles(verifierPayload, { canViewFinancialSummary: true, collectedTotal: 0, unpaidCount: 0 }));
    expect(tiles.get("payments")?.money).toBe(true);
    expect(tiles.get("profit")?.money).toBe(true);
    expect(tiles.get("waiting")?.money).toBeUndefined();
    expect(tiles.get("expenses")?.money).toBeUndefined();
  });

  test("a null payload (pre-load) reads 0 on every count tile, never a list figure", () => {
    const tiles = byKey(dashboardTiles(null, { canViewFinancialSummary: true, collectedTotal: 0, unpaidCount: 0 }));
    for (const key of ["waiting", "withoutPrice", "pendingCustomers", "activeTrips", "delivered", "failedDelivery", "expenses"] as const) {
      expect(tiles.get(key)?.value).toBe(0);
    }
    expect(tiles.get("payments")?.value).toBe("PHP 0.00");
    expect(tiles.get("profit")?.value).toBe("PHP 0.00");
  });
});

describe("dashboardTiles — the non-financial (no reports.view) tile set", () => {
  test("count tiles still read the payload; collected/unpaid take the caller's role-scoped values", () => {
    // The API withholds the financial fields from sessions without
    // reports.view (P6-6), so the payload arrives without them; the
    // two role-scoped tiles are computed by the shell from the lists
    // it loads for the dashboard tab.
    const staffPayload: DashboardData = {
      cargoWaiting: 5,
      cargoWithoutPrice: 3,
      pendingCustomers: 2,
      activeTrips: 6,
      delivered: 7,
      failedDeliveries: 1,
      notifications: []
    };
    const tiles = dashboardTiles(staffPayload, { canViewFinancialSummary: false, collectedTotal: 2750.5, unpaidCount: 9 });
    const byKeyStaff = byKey(tiles);
    expect(tiles.map((tile) => tile.key)).toEqual([
      "waiting",
      "withoutPrice",
      "pendingCustomers",
      "activeTrips",
      "delivered",
      "failedDelivery",
      "collected",
      "unpaid"
    ]);
    expect(byKeyStaff.get("waiting")?.value).toBe(5);
    expect(byKeyStaff.get("delivered")?.value).toBe(7);
    expect(byKeyStaff.get("collected")?.value).toBe("PHP 2,750.50");
    expect(byKeyStaff.get("collected")?.money).toBe(true);
    expect(byKeyStaff.get("unpaid")?.value).toBe(9);
    expect(byKeyStaff.has("payments")).toBe(false);
    expect(byKeyStaff.has("profit")).toBe(false);
  });
});

/**
 * Round 1 fix loop PR-12 — dashboard scope label (recommendation
 * R3, the labelling half of C-M13). PR-11 settled the tiles' scope
 * as the signed-in user's stored branchAccess; the label states
 * that same scope in plain words above the tiles, derived from the
 * branchAccess string itself — never from the branch-workspace
 * switcher, which was the silent second scope in the finding.
 */
describe("dashboardScopeLabel (PR-12, R3)", () => {
  test("a two-branch user reads both branches", () => {
    expect(dashboardScopeLabel("Daet / Naga")).toBe("Your branches: Daet / Naga");
  });

  test("a single-branch user reads the singular label", () => {
    expect(dashboardScopeLabel("Daet")).toBe("Your branch: Daet");
    expect(dashboardScopeLabel("Naga")).toBe("Your branch: Naga");
  });

  test("the stored all-branches grant states itself", () => {
    expect(dashboardScopeLabel("All branches")).toBe("All branches");
  });

  test("spacing variants of the stored string normalise", () => {
    expect(dashboardScopeLabel("Daet/Naga")).toBe("Your branches: Daet / Naga");
    expect(dashboardScopeLabel("  Daet  ")).toBe("Your branch: Daet");
  });

  test("no recorded branch access prints no label at all", () => {
    expect(dashboardScopeLabel(undefined)).toBeNull();
    expect(dashboardScopeLabel(null)).toBeNull();
    expect(dashboardScopeLabel("")).toBeNull();
    expect(dashboardScopeLabel(" / ")).toBeNull();
  });
});
