/**
 * Dashboard tile derivation for the web shell (extracted from
 * app-shell.tsx in Round 1 fix loop PR-11 so the derivation is
 * unit-testable, the same reason search-ranking.ts was extracted in
 * PR-10).
 *
 * PR-11 (canonical finding C-M13; filed as L1 B-F4 = C-F2) — every
 * count tile reads the API dashboard payload (GET /dashboard) and
 * NOTHING else. Before this fix the five cargo/trip tiles were
 * computed client-side from the shell's package/trip list state,
 * which the Dashboard never loads: on the direct login → Dashboard
 * path the lists were still empty, so all six count tiles read 0
 * while the money tiles and activity chart on the same screen —
 * which do read the API payload — showed the true figures. Once
 * another tab had loaded the lists, the tiles instead followed the
 * shell's branch-workspace context, a second scope that silently
 * diverged from the API figures' scope.
 *
 * The payload's scope is the signed-in user's stored branchAccess
 * (the P5-3 rule getDashboard applies server-side) — the same scope
 * as the money tiles and the /reports/series chart, so the whole
 * Dashboard now describes one scope. The branch-workspace switcher
 * keeps driving the operational list screens; it no longer leaks
 * into the overview. (Labelling that scope on the tiles is
 * recommendation R3, a separate presentation pass.)
 *
 * The two role-scoped tiles in the non-financial set are the one
 * deliberate exception, and they take caller-computed values rather
 * than list state of their own: "Collected Here" is the signed-in
 * staff member's own collection responsibility and "Need
 * Collection" is their role's unpaid responsibility set. No API
 * figure exists for either — the payload's paymentsCollected is
 * the business-wide figure and is withheld entirely from sessions
 * without reports.view (P6-6) — so the shell computes them from
 * the payments/package lists, which it now also loads for the
 * dashboard tab (see refreshCurrentTabData in app-shell.tsx).
 */

import { formatMoney } from "./money-format";
import type { DashboardData } from "./types";

export type DashboardMetricKey =
  | "waiting"
  | "withoutPrice"
  | "pendingCustomers"
  | "activeTrips"
  | "delivered"
  | "failedDelivery"
  | "collected"
  | "unpaid"
  | "payments"
  | "expenses"
  | "profit";

export interface DashboardTile {
  key: DashboardMetricKey;
  label: string;
  value: string | number;
  /** Money tiles render through the shared money format and carry
   *  the metricMoney styling (Round 2 R2-05: currency + figure stay
   *  on one line); count tiles keep the plain headline treatment. */
  money?: boolean;
}

/**
 * Round 1 fix loop PR-12 (recommendation R3, the labelling half of
 * C-M13) — the Dashboard now names the scope its figures describe.
 * PR-11 settled that scope as the signed-in user's stored
 * branchAccess (the server applies the same value in getDashboard);
 * this label states it in plain words above the tiles, derived from
 * that same branchAccess string ("Daet", "Naga", "Daet / Naga").
 * Returns null when no branch access is recorded, so the Dashboard
 * never prints an empty or guessed scope.
 */
export function dashboardScopeLabel(branchAccess: string | null | undefined): string | null {
  const branches = (branchAccess ?? "")
    .split("/")
    .map((branch) => branch.trim())
    .filter(Boolean);
  if (!branches.length) return null;
  // The all-branches grant is stored as the literal "All branches"
  // (the bootstrap admin's value) — it states its own scope.
  if (branches.length === 1 && branches[0] === "All branches") return "All branches";
  return branches.length === 1 ? `Your branch: ${branches[0]}` : `Your branches: ${branches.join(" / ")}`;
}

export function dashboardTiles(
  dashboard: DashboardData | null,
  options: { canViewFinancialSummary: boolean; collectedTotal: number; unpaidCount: number }
): DashboardTile[] {
  return [
    { key: "waiting", label: "Cargo Waiting", value: dashboard?.cargoWaiting ?? 0 },
    { key: "withoutPrice", label: "Without Price", value: dashboard?.cargoWithoutPrice ?? 0 },
    { key: "pendingCustomers", label: "Customer Pending", value: dashboard?.pendingCustomers ?? 0 },
    { key: "activeTrips", label: "Active Trips", value: dashboard?.activeTrips ?? 0 },
    { key: "delivered", label: "Delivered", value: dashboard?.delivered ?? 0 },
    { key: "failedDelivery", label: "Failed Delivery", value: dashboard?.failedDeliveries ?? 0 },
    ...(options.canViewFinancialSummary
      ? ([
          { key: "payments", label: "Payments", value: formatMoney(dashboard?.paymentsCollected ?? 0), money: true },
          { key: "expenses", label: "Expenses Review", value: dashboard?.expensesAwaitingApproval ?? 0 },
          // Phase 6 P6-5: the tile reads the period-scoped figure
          // and its label says what it is. (The all-time
          // estimatedProfit it replaced was removed from the API
          // in P6-6 after its one deprecated release.)
          { key: "profit", label: "Profit This Month", value: formatMoney(dashboard?.profitThisMonth ?? 0), money: true }
        ] satisfies DashboardTile[])
      : ([
          { key: "collected", label: "Collected Here", value: formatMoney(options.collectedTotal), money: true },
          { key: "unpaid", label: "Need Collection", value: options.unpaidCount }
        ] satisfies DashboardTile[]))
  ];
}
