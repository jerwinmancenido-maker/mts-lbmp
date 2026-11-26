import { describe, expect, test } from "vitest";
import {
  buildSearchOverlayResults,
  isSearchPermissionError,
  scopeSearchOverlayCollections,
  searchOverlayPanelState,
  type SearchOverlayCollections
} from "../../apps/web/src/app/ui/search-overlay";
import type { CargoPackage, Customer, ExpenseRecord, PaymentRecord, Trip } from "../../apps/web/src/app/ui/types";

/**
 * Search overlay data flow (deferred L26 re-run observation N1).
 *
 * The defect: the overlay derived results from the shell's per-module
 * list state, so in a fresh session — signed in, no module visited —
 * it answered "No matching records" for the exact number of a package
 * that exists (the API search returned it); the record appeared only
 * after the Cargo tab had been visited once.
 *
 * The fix pinned here: buildSearchOverlayResults takes the overlay's
 * collections as an explicit input — the shell now fetches them from
 * the API when the overlay is used — and there is no module-state
 * input left to disagree with. Given the collections (as the API
 * returns them for a session that has visited NOTHING), the
 * derivation must find the record. The PR-10 tiering contract
 * (substring results untouched; fuzzy only on a total substring miss)
 * and the overlay's branch scoping must hold exactly as before.
 */

const ALL_TABS = ["dashboard", "receiving", "packages", "trips", "delivery", "payments", "expenses", "reports", "customer", "chat", "admin", "settings", "hardware"];

function pkg(overrides: Partial<CargoPackage> & { id: string }): CargoPackage {
  return {
    packageNumber: `PKG-2026-11-${overrides.id}`,
    receivingRecordNumber: `RR-2026-11-${overrides.id}`,
    customerName: "Findability Motors Inc",
    description: "Engine parts",
    destination: "Naga",
    condition: "Good",
    status: "Delivered",
    price: 350,
    qrValue: `QR-${overrides.id}`,
    createdAt: "2026-11-22T01:00:00.000Z",
    ...overrides
  };
}

function collections(overrides: Partial<SearchOverlayCollections> = {}): SearchOverlayCollections {
  return {
    packages: [],
    trips: [],
    payments: [],
    expenses: [],
    customers: [],
    auditLogs: [],
    hardwareTests: [],
    ...overrides
  };
}

describe("buildSearchOverlayResults — navigation independence (N1)", () => {
  test("a fresh session finds an existing package by its exact number", () => {
    // The verifier's acceptance case: the seeded package
    // PKG-2026-11-000001 (Delivered), searched before any module was
    // visited. The input is the API payload alone — no module state
    // exists in this signature to be empty.
    const results = buildSearchOverlayResults(
      collections({ packages: [pkg({ id: "000001", packageNumber: "PKG-2026-11-000001", receivingRecordNumber: "RR-2026-11-000001" })] }),
      undefined,
      "PKG-2026-11-000001",
      ALL_TABS
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "package-000001", tab: "packages", type: "Package", status: "Delivered" });
    expect(results[0]?.documentNumber).toBe("RR-2026-11-000001");
  });

  test("a partial number finds the package in a fresh session (the mobile probe's failing queries)", () => {
    const data = collections({ packages: [pkg({ id: "000001", packageNumber: "PKG-2026-11-000001" })] });
    for (const query of ["PKG", "PKG-2026"]) {
      const results = buildSearchOverlayResults(data, undefined, query, ALL_TABS);
      expect(results.map((item) => item.id)).toContain("package-000001");
    }
  });

  test("a query with no match in loaded collections is honestly empty", () => {
    const results = buildSearchOverlayResults(collections({ packages: [pkg({ id: "000001" })] }), undefined, "no-such-record-zzz", ALL_TABS);
    expect(results).toEqual([]);
  });

  test("an empty query lists recent records across collections (capped at 10)", () => {
    const many = Array.from({ length: 12 }, (_, index) => pkg({ id: `p${index}`, packageNumber: `PKG-X-${index}` }));
    const results = buildSearchOverlayResults(collections({ packages: many }), undefined, "", ALL_TABS);
    expect(results).toHaveLength(10);
  });
});

describe("buildSearchOverlayResults — PR-10 tiering preserved", () => {
  test("substring hits are untouched: a fuzzy-only lookalike is NOT added", () => {
    const exact = pkg({ id: "exact", customerName: "Findability Motors Inc" });
    const lookalike = pkg({ id: "lookalike", customerName: "Findabilty Logistics", packageNumber: "PKG-OTHER-1", receivingRecordNumber: "RR-OTHER-1" });
    const results = buildSearchOverlayResults(collections({ packages: [exact, lookalike] }), undefined, "Findability", ALL_TABS);
    expect(results.map((item) => item.id)).toEqual(["package-exact"]);
  });

  test("a one-letter typo finds the record when the substring tier misses entirely", () => {
    const data = collections({
      packages: [pkg({ id: "typo", customerName: "Findability Motors Inc" })],
      customers: [{ id: "cust1", businessName: "Findability Motors Inc", status: "Active" } as Customer]
    });
    const results = buildSearchOverlayResults(data, undefined, "Findabilty", ALL_TABS);
    expect(results.map((item) => item.id)).toEqual(expect.arrayContaining(["package-typo", "customer-cust1"]));
  });

  test("a two-letter garble still finds nothing", () => {
    const data = collections({ packages: [pkg({ id: "typo", customerName: "Findability Motors Inc" })] });
    expect(buildSearchOverlayResults(data, undefined, "Findxbilty", ALL_TABS)).toEqual([]);
  });
});

describe("buildSearchOverlayResults — scope and visibility", () => {
  test("branch scope narrows packages, and payments/expenses follow their scoped parents", () => {
    const daetPkg = pkg({ id: "daet", destination: "Daet", handlingBranchName: "Daet" });
    const nagaPkg = pkg({ id: "naga", destination: "Naga", handlingBranchName: "Naga" });
    const daetTrip: Trip = {
      id: "trip-daet",
      tripNumber: "TRIP-D1",
      origin: "Daet",
      destination: "Naga",
      status: "Departed",
      isMixedTrip: false,
      cargoPackageIds: ["daet"],
      createdAt: "2026-11-22T01:00:00.000Z"
    };
    const payment: PaymentRecord = {
      id: "pay-naga",
      cargoPackageId: "naga",
      amountDue: 500,
      amountPaid: 500,
      balance: 0,
      method: "Cash",
      branchName: "Naga",
      status: "Paid",
      createdAt: "2026-11-22T02:00:00.000Z"
    };
    const expense: ExpenseRecord = { id: "exp-daet", tripId: "trip-daet", category: "Fuel", amount: 900, status: "Approved", createdAt: "2026-11-22T03:00:00.000Z" };
    const data = collections({ packages: [daetPkg, nagaPkg], trips: [daetTrip], payments: [payment], expenses: [expense] });

    const scoped = scopeSearchOverlayCollections(data, "Daet");
    expect(scoped.packages.map((entry) => entry.id)).toEqual(["daet"]);
    // The trip survives scoping through its Daet package even though
    // the trip itself is bound for Naga (the shell's own predicate).
    expect(scoped.trips.map((entry) => entry.id)).toEqual(["trip-daet"]);
    // The Naga payment is out of scope via its package.
    expect(scoped.payments).toEqual([]);
    expect(scoped.expenses.map((entry) => entry.id)).toEqual(["exp-daet"]);

    const results = buildSearchOverlayResults(data, "Daet", "Findability", ALL_TABS);
    expect(results.map((item) => item.id)).toContain("package-daet");
    expect(results.map((item) => item.id)).not.toContain("package-naga");
    expect(results.map((item) => item.id)).not.toContain("payment-pay-naga");
  });

  test("results for tabs the role cannot see are filtered out", () => {
    const data = collections({
      packages: [pkg({ id: "000001" })],
      auditLogs: [{ id: "log1", action: "package.created", entityType: "Package", entityId: "000001", createdAt: "2026-11-22T01:00:00.000Z" }]
    });
    const withoutAdmin = buildSearchOverlayResults(data, undefined, "PKG", ALL_TABS.filter((tab) => tab !== "admin"));
    expect(withoutAdmin.map((item) => item.type)).not.toContain("Audit");
    const withAdmin = buildSearchOverlayResults(data, undefined, "package.created", ALL_TABS);
    expect(withAdmin.map((item) => item.type)).toContain("Audit");
  });

  test("customers come from the bootstrap-shaped collection input", () => {
    const data = collections({
      customers: [{ id: "cust9", businessName: "Findability Motors Inc", contactPerson: "Ana", phone: "0917", billingTerm: "Net 30", status: "Active" } as Customer]
    });
    const results = buildSearchOverlayResults(data, undefined, "Findability", ALL_TABS);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "customer-cust9", tab: "customer", type: "Customer", documentNumber: "0917" });
  });
});

describe("searchOverlayPanelState — loading / error / empty are distinct faces", () => {
  test("no collections yet is loading, whatever the status", () => {
    expect(searchOverlayPanelState({ status: "idle", hasCollections: false, resultCount: 0 })).toBe("loading");
    expect(searchOverlayPanelState({ status: "loading", hasCollections: false, resultCount: 0 })).toBe("loading");
    // Even a "ready" status with nothing loaded must not read as an
    // honest empty — the false "No matching records" is the defect.
    expect(searchOverlayPanelState({ status: "ready", hasCollections: false, resultCount: 0 })).toBe("loading");
  });

  test("a failed load with nothing to show is error, not empty", () => {
    expect(searchOverlayPanelState({ status: "error", hasCollections: false, resultCount: 0 })).toBe("error");
  });

  test("loaded collections with no match are the honest empty", () => {
    expect(searchOverlayPanelState({ status: "ready", hasCollections: true, resultCount: 0 })).toBe("empty");
  });

  test("any results win over every other face", () => {
    expect(searchOverlayPanelState({ status: "ready", hasCollections: true, resultCount: 3 })).toBe("results");
    expect(searchOverlayPanelState({ status: "loading", hasCollections: true, resultCount: 3 })).toBe("results");
  });

  test("a failed re-load with collections on hand keeps the data faces", () => {
    expect(searchOverlayPanelState({ status: "error", hasCollections: true, resultCount: 0 })).toBe("empty");
    expect(searchOverlayPanelState({ status: "error", hasCollections: true, resultCount: 2 })).toBe("results");
  });
});

describe("buildSearchOverlayResults — every result carries its PR-12 tone (R2-11)", () => {
  // The defect: the overlay rendered every status in the role accent
  // colour, bypassing status-tone.ts — "Failed Delivery" read the
  // same blue as "Arrived". The derivation now carries the tone on
  // each result item and the shell paints the status text with it.
  test("a failed delivery is a problem; delivered and arrived are successes", () => {
    const data = collections({
      packages: [
        pkg({ id: "failed", status: "Failed Delivery", packageNumber: "PKG-FAILED-1" }),
        pkg({ id: "delivered", status: "Delivered", packageNumber: "PKG-DELIVERED-1" }),
        pkg({ id: "arrived", status: "Arrived", packageNumber: "PKG-ARRIVED-1" })
      ]
    });
    const results = buildSearchOverlayResults(data, undefined, "PKG", ALL_TABS);
    const toneById = new Map(results.map((item) => [item.id, item.statusTone]));
    expect(toneById.get("package-failed")).toBe("problem");
    expect(toneById.get("package-delivered")).toBe("success");
    expect(toneById.get("package-arrived")).toBe("success");
    expect(toneById.get("package-failed")).not.toBe(toneById.get("package-arrived"));
  });

  test("in-flight work is progress; an unstarted or unlisted status is neutral", () => {
    const data = collections({
      packages: [
        pkg({ id: "transit", status: "In Transit", packageNumber: "PKG-TRANSIT-1" }),
        pkg({ id: "draft", status: "Draft", packageNumber: "PKG-DRAFT-1" }),
        pkg({ id: "unlisted", status: "Being Weighed", packageNumber: "PKG-WEIGHED-1" })
      ]
    });
    const results = buildSearchOverlayResults(data, undefined, "PKG", ALL_TABS);
    const toneById = new Map(results.map((item) => [item.id, item.statusTone]));
    expect(toneById.get("package-transit")).toBe("progress");
    expect(toneById.get("package-draft")).toBe("neutral");
    // The map's fallback: a status the tone table does not list
    // borrows no meaning.
    expect(toneById.get("package-unlisted")).toBe("neutral");
  });

  test("trips, payments, customers and audit rows carry the tone of their own status", () => {
    const trip: Trip = {
      id: "trip-1",
      tripNumber: "TRIP-T1",
      origin: "Daet",
      destination: "Naga",
      status: "Departed",
      isMixedTrip: false,
      cargoPackageIds: [],
      createdAt: "2026-11-22T01:00:00.000Z"
    };
    const payment: PaymentRecord = {
      id: "pay-1",
      cargoPackageId: "000001",
      amountDue: 350,
      amountPaid: 350,
      balance: 0,
      method: "Cash",
      branchName: "Daet",
      status: "Paid",
      createdAt: "2026-11-22T02:00:00.000Z"
    };
    const data = collections({
      packages: [pkg({ id: "000001" })],
      trips: [trip],
      payments: [payment],
      customers: [{ id: "cust1", businessName: "Findability Motors Inc", contactPerson: "Ana", phone: "0917", billingTerm: "Net 30", status: "Active" } as Customer],
      auditLogs: [{ id: "log1", action: "package.created", entityType: "Package", entityId: "000001", createdAt: "2026-11-22T01:00:00.000Z" }]
    });
    const results = buildSearchOverlayResults(data, undefined, "", ALL_TABS);
    const toneById = new Map(results.map((item) => [item.id, item.statusTone]));
    expect(toneById.get("trip-trip-1")).toBe("progress");
    expect(toneById.get("payment-pay-1")).toBe("success");
    expect(toneById.get("customer-cust1")).toBe("success");
    // Audit actions are free-form strings, not statuses — neutral.
    expect(toneById.get("audit-log1")).toBe("neutral");
  });
});

describe("isSearchPermissionError — a 403 is absence, not failure", () => {
  test("an error carrying HTTP 403 is permission-shaped", () => {
    const error = new Error("Forbidden") as Error & { status?: number };
    error.status = 403;
    expect(isSearchPermissionError(error)).toBe(true);
  });

  test("network and server errors are real failures", () => {
    expect(isSearchPermissionError(new TypeError("Failed to fetch"))).toBe(false);
    const error500 = new Error("Internal Server Error") as Error & { status?: number };
    error500.status = 500;
    expect(isSearchPermissionError(error500)).toBe(false);
    expect(isSearchPermissionError(null)).toBe(false);
    expect(isSearchPermissionError("403")).toBe(false);
  });
});
