import { formatMoney } from "./money-format";
import { paymentSearchDetails, remainingBalanceForPackage } from "./payment-display";
import { tieredSearchScores } from "./search-ranking";
import type { AuditLog, CargoPackage, Customer, ExpenseRecord, HardwareTestRecord, PaymentRecord, Trip } from "./types";

/**
 * Global search overlay data flow (extracted from app-shell.tsx so the
 * derivation is unit-testable — the same reason dashboard-tiles.ts was
 * extracted in Round 1 PR-11).
 *
 * The defect (deferred L26 re-run observation N1, 2026-11-22): the
 * overlay derived its results from the shell's per-module list state —
 * the collections a module tab loads when visited. In a fresh session
 * (signed in, no module opened yet) those lists are empty, so the
 * overlay answered "No matching records" for the exact number of a
 * package that exists, while the API's own search returned it; the
 * record appeared only after the Cargo tab had been visited once.
 * Same root-cause family as C-M13 (dashboard tiles reading
 * navigation-dependent shell state, fixed by PR #46): a surface that
 * must be true on first landing cannot read state that only a visit
 * populates.
 *
 * The fix: the shell fetches the searchable collections from the API
 * when the overlay is used (see loadSearchOverlayCollections in
 * app-shell.tsx) and hands them to buildSearchOverlayResults here.
 * The derivation itself — branch scoping, the per-collection value
 * sets, PR-10's tiered substring/fuzzy scoring via
 * tieredSearchScores, ordering, and the result cap — is the overlay's
 * original derivation, unchanged; only the data source moved.
 *
 * Collection inventory (overlay before → after):
 * - Packages: shell `packages` state (per-tab fetches with differing
 *   status filters/limits; empty in a fresh session) → GET /packages.
 * - Trips: shell `trips` state → GET /trips.
 * - Payments: shell `payments` state → GET /payments.
 * - Expenses: shell `expenses` state (expenses tab only) → GET /expenses.
 * - Audit logs: shell `auditLogs` state (admin tab only) → GET /audit.
 * - Hardware tests: shell `hardwareTests` state (device tab only) →
 *   GET /hardware/tests.
 * - Customers: the login bootstrap's customer list — already fetched
 *   from the API unconditionally at sign-in, never tied to a module
 *   visit, so this collection was never navigation-dependent and
 *   stays sourced from the bootstrap (there is no /customers list
 *   endpoint; the bootstrap is the API's customer read).
 * Every list endpoint applies the signed-in user's branch scope
 * server-side (Phase 5 P5-3); the shell passes the same `branch`
 * workspace parameter the module loads use, and the branch scoping
 * below re-applies the overlay's original client-side predicates, so
 * a search can never surface a record the module lists would hide.
 */

export type SearchOverlayTabId = "packages" | "trips" | "payments" | "expenses" | "customer" | "admin" | "hardware";

export interface SearchResultItem {
  id: string;
  tab: SearchOverlayTabId;
  type: string;
  customerName: string;
  documentNumber: string;
  date: string;
  status: string;
  details: string;
  amount?: string;
  priority: number;
}

export interface SearchOverlayCollections {
  packages: CargoPackage[];
  trips: Trip[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  customers: Customer[];
  auditLogs: AuditLog[];
  hardwareTests: HardwareTestRecord[];
}

export type SearchOverlayLoadStatus = "idle" | "loading" | "ready" | "error";

export function formatSearchDate(value?: string) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The overlay panel has four mutually exclusive faces. "empty" (the
 * "No matching records" face) may only appear once collections have
 * actually loaded — before that the panel is "loading", and a load
 * that failed with nothing to show is "error". A failed RE-load with
 * earlier collections still on hand keeps deriving from them, so it
 * lands on "results"/"empty", never on a false error or a false
 * loading state.
 */
export function searchOverlayPanelState(input: {
  status: SearchOverlayLoadStatus;
  hasCollections: boolean;
  resultCount: number;
}): "results" | "loading" | "error" | "empty" {
  if (input.resultCount > 0) return "results";
  if (input.status === "error" && !input.hasCollections) return "error";
  if (!input.hasCollections) return "loading";
  return "empty";
}

/**
 * A 403 from a list endpoint is permission-shaped absence, not a
 * failed load: the role presets give every staff role the four core
 * list permissions, and the two extra collections sit behind
 * permissions some tab-visible roles legitimately lack (audit.view,
 * settings.manage). The module loads already treat such endpoints
 * this way (billing invoices and balances are fetched with
 * .catch(() => []) inside composite loads). Any other failure — the
 * API unreachable, a 500 — is a real load failure and surfaces as the
 * panel's error state instead of a false "No matching records".
 * The status rides on the error the API client throws (see api.ts).
 */
export function isSearchPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 403;
}

/**
 * The overlay's original branch scoping (the shell's branchScoped*
 * predicates), applied to the fetched collections: packages by
 * handling branch/destination, trips and payments through the scoped
 * package set, expenses through the scoped trip set. Audit logs,
 * hardware tests, and customers were never branch-scoped in the
 * overlay and stay unscoped.
 */
export function scopeSearchOverlayCollections(
  collections: SearchOverlayCollections,
  branchScope?: string
): SearchOverlayCollections {
  if (!branchScope) return collections;
  const scopedPackages = collections.packages.filter(
    (pkg) => pkg.handlingBranchName === branchScope || pkg.destination === branchScope
  );
  const scopedPackageIds = new Set(scopedPackages.map((pkg) => pkg.id));
  const scopedTrips = collections.trips.filter(
    (trip) => trip.destination === branchScope || trip.cargoPackageIds.some((packageId) => scopedPackageIds.has(packageId))
  );
  const scopedTripIds = new Set(scopedTrips.map((trip) => trip.id));
  const scopedPayments = collections.payments.filter(
    (payment) => payment.branchName === branchScope || scopedPackageIds.has(payment.cargoPackageId)
  );
  const scopedExpenses = collections.expenses.filter((expense) => expense.tripId && scopedTripIds.has(expense.tripId));
  return {
    ...collections,
    packages: scopedPackages,
    trips: scopedTrips,
    payments: scopedPayments,
    expenses: scopedExpenses
  };
}

/**
 * The overlay derivation, exactly as the shell computed it from module
 * state — same value sets, same tiered scoring, same ordering
 * (priority desc, then date desc) and the same caps (16 with a query,
 * 10 without) — now over the API-fetched collections.
 */
export function buildSearchOverlayResults(
  collections: SearchOverlayCollections,
  branchScope: string | undefined,
  query: string,
  visibleTabIds: readonly string[]
): SearchResultItem[] {
  const scoped = scopeSearchOverlayCollections(collections, branchScope);
  const branchScopedPackages = scoped.packages;
  const branchScopedTrips = scoped.trips;
  const branchScopedPayments = scoped.payments;
  const branchScopedExpenses = scoped.expenses;
  const auditLogs = scoped.auditLogs;
  const hardwareTests = scoped.hardwareTests;
  const packageById = new Map(branchScopedPackages.map((pkg) => [pkg.id, pkg]));
  const results: SearchResultItem[] = [];
  const trimmedQuery = query.trim();

  // PR-10 (C-M12): every collection below is scored with
  // tieredSearchScores — substring priorities exactly as before when
  // anything matches; typo-tolerant priorities only when a
  // collection's substring tier found nothing.
  const packagePriorities = tieredSearchScores(
    branchScopedPackages.map((pkg) => [
      pkg.customerName,
      pkg.receivingRecordNumber,
      pkg.packageNumber,
      formatSearchDate(pkg.createdAt),
      pkg.destination,
      pkg.description,
      pkg.status
    ]),
    trimmedQuery
  );
  branchScopedPackages.forEach((pkg, pkgIndex) => {
    const priority = packagePriorities[pkgIndex] ?? 0;
    if (trimmedQuery && priority === 0) return;
    results.push({
      id: `package-${pkg.id}`,
      tab: "packages",
      type: "Package",
      customerName: pkg.customerName,
      documentNumber: pkg.receivingRecordNumber || pkg.packageNumber,
      date: formatSearchDate(pkg.createdAt),
      status: pkg.status,
      details: `${pkg.packageNumber} - ${pkg.description} - ${pkg.destination}`,
      amount: pkg.price == null ? "No price" : formatMoney(pkg.price),
      priority
    });
  });

  const tripSearchEntries = branchScopedTrips.map((trip) => {
    const relatedPackages = trip.cargoPackageIds.map((id) => packageById.get(id)).filter(Boolean) as CargoPackage[];
    const customerNames = Array.from(new Set(relatedPackages.map((pkg) => pkg.customerName))).join(", ");
    return {
      trip,
      customerNames,
      values: [
        customerNames,
        trip.tripNumber,
        trip.origin,
        trip.destination,
        trip.status,
        trip.vehicleDescription,
        trip.driverName
      ]
    };
  });
  const tripPriorities = tieredSearchScores(tripSearchEntries.map((entry) => entry.values), trimmedQuery);
  tripSearchEntries.forEach(({ trip, customerNames }, tripIndex) => {
    const priority = tripPriorities[tripIndex] ?? 0;
    if (trimmedQuery && priority === 0) return;
    results.push({
      id: `trip-${trip.id}`,
      tab: "trips",
      type: "Trip",
      customerName: customerNames || "Multiple customers",
      documentNumber: trip.tripNumber,
      date: "Trip date pending",
      status: trip.status,
      details: `${trip.origin} to ${trip.destination} - ${trip.cargoPackageIds.length} package(s)`,
      priority
    });
  });

  const paymentSearchEntries = branchScopedPayments.map((payment) => {
    const pkg = packageById.get(payment.cargoPackageId);
    return {
      payment,
      pkg,
      values: [
        pkg?.customerName,
        pkg?.receivingRecordNumber,
        pkg?.packageNumber,
        formatSearchDate(payment.createdAt),
        payment.method,
        payment.status,
        payment.amountPaid,
        pkg ? remainingBalanceForPackage(pkg, branchScopedPayments) : payment.balance
      ]
    };
  });
  const paymentPriorities = tieredSearchScores(paymentSearchEntries.map((entry) => entry.values), trimmedQuery);
  paymentSearchEntries.forEach(({ payment, pkg }, paymentIndex) => {
    const priority = paymentPriorities[paymentIndex] ?? 0;
    if (trimmedQuery && priority === 0) return;
    results.push({
      id: `payment-${payment.id}`,
      tab: "payments",
      type: "Payment",
      customerName: pkg?.customerName ?? "Customer not linked",
      documentNumber: pkg?.receivingRecordNumber ?? pkg?.packageNumber ?? "Payment record",
      date: formatSearchDate(payment.createdAt),
      status: payment.status,
      // P6-2 §2.3.1: show the package's cumulative remaining balance;
      // the stored Payment.balance is a per-call historical value and
      // is never presented as a remaining balance.
      details: paymentSearchDetails(payment, pkg, branchScopedPayments),
      amount: `Due ${formatMoney(payment.amountDue)}`,
      priority
    });
  });

  const expensePriorities = tieredSearchScores(
    branchScopedExpenses.map((expense) => [expense.category, expense.description, expense.status, expense.tripId, formatSearchDate(expense.createdAt), expense.amount]),
    trimmedQuery
  );
  branchScopedExpenses.forEach((expense, expenseIndex) => {
    const priority = expensePriorities[expenseIndex] ?? 0;
    if (trimmedQuery && priority === 0) return;
    results.push({
      id: `expense-${expense.id}`,
      tab: "expenses",
      type: "Expense",
      customerName: "Operations",
      documentNumber: expense.tripId ?? "General expense",
      date: formatSearchDate(expense.createdAt),
      status: expense.status,
      details: `${expense.category} - ${expense.description ?? "No description"}`,
      amount: formatMoney(expense.amount),
      priority
    });
  });

  const overlayCustomers = collections.customers;
  const customerPriorities = tieredSearchScores(
    overlayCustomers.map((customer) => [customer.businessName, customer.contactPerson, customer.phone, customer.billingTerm, customer.status]),
    trimmedQuery
  );
  overlayCustomers.forEach((customer, customerIndex) => {
    const priority = customerPriorities[customerIndex] ?? 0;
    if (trimmedQuery && priority === 0) return;
    results.push({
      id: `customer-${customer.id}`,
      tab: "customer",
      type: "Customer",
      customerName: customer.businessName,
      documentNumber: customer.phone ?? "No phone",
      date: customer.billingTerm ?? "No billing term",
      status: customer.status,
      details: customer.contactPerson ?? "Customer profile",
      priority
    });
  });

  const auditPriorities = tieredSearchScores(
    auditLogs.map((log) => [log.action, log.entityType, log.entityId, log.reason, formatSearchDate(log.createdAt)]),
    trimmedQuery
  );
  auditLogs.forEach((log, logIndex) => {
    const priority = auditPriorities[logIndex] ?? 0;
    if (trimmedQuery && priority === 0) return;
    results.push({
      id: `audit-${log.id}`,
      tab: "admin",
      type: "Audit",
      customerName: "System audit",
      documentNumber: log.entityId,
      date: formatSearchDate(log.createdAt),
      status: log.action,
      details: `${log.entityType}${log.reason ? ` - ${log.reason}` : ""}`,
      priority
    });
  });

  const hardwarePriorities = tieredSearchScores(
    hardwareTests.map((test) => [test.deviceName, test.scannerResult, test.printerResult, test.cameraResult, test.signatureResult, test.pwaResult, test.notes, formatSearchDate(test.createdAt)]),
    trimmedQuery
  );
  hardwareTests.forEach((test, testIndex) => {
    const priority = hardwarePriorities[testIndex] ?? 0;
    if (trimmedQuery && priority === 0) return;
    results.push({
      id: `hardware-${test.id}`,
      tab: "hardware",
      type: "Hardware",
      customerName: "Device test",
      documentNumber: test.deviceName,
      date: formatSearchDate(test.createdAt),
      status: test.pwaResult,
      details: `Scanner ${test.scannerResult} - Printer ${test.printerResult}`,
      priority
    });
  });

  return results
    .filter((item) => visibleTabIds.includes(item.tab))
    .sort((a, b) => b.priority - a.priority || b.date.localeCompare(a.date))
    .slice(0, trimmedQuery ? 16 : 10);
}
