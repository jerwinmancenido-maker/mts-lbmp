import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type { CargoPackage, ExpenseRecord, ProductMaster, Trip } from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 fix loop PR-10 — typo-tolerant staff search (canonical
 * finding C-M12; filed as L25-F2, Major).
 *
 * Before this fix, every list search was substring-only: the round
 * planted a package for customer "Findability Motors Inc" and the
 * staff packages search for "Findabilty" (one letter dropped) returned
 * 0 records, so staff concluded the record did not exist. The fix adds
 * a fallback tier to the shared list-search helper (applySearchTiers):
 * the substring tier's results are returned untouched whenever it
 * finds anything; a token-based typo-tolerant tier (bounded Damerau
 * distance of ONE edit, words only — numeric tokens stay exact) runs
 * only when the substring tier found nothing.
 *
 * The fixture below re-plants the round's own record
 * (PKG-2026-11-000105, "Findability Motors Inc") alongside near
 * neighbours chosen so each pin separates the tiers: "Motor Parts
 * Trading" is one edit from "Motors" but must NOT appear for the
 * correctly-spelled query, because the substring tier already hit.
 */

type ServiceInternals = {
  packages: CargoPackage[];
  trips: Trip[];
  expenses: ExpenseRecord[];
  productMasters: ProductMaster[];
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
  const dir = mkdtempSync(join(tmpdir(), "mts-fuzzy-search-"));
  tempRoots.push(dir);
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

function makePackage(overrides: Partial<CargoPackage> = {}): CargoPackage {
  return {
    id: "pkg_pr10_base",
    packageNumber: "PKG-2026-11-000100",
    receivingRecordNumber: "RR-2026-11-000100",
    customerId: "cust_pr10",
    customerName: "Base Fixture Customer",
    productId: "",
    description: "General cargo",
    quantity: 1,
    unit: "box",
    destination: "Daet",
    handlingBranchId: "daet",
    handlingBranchName: "Daet",
    deliveryType: "Deliver to consignee",
    condition: "Good",
    status: "Delivered",
    price: 1000,
    qrValue: "MTS:PKG:PKG-2026-11-000100",
    photoUrls: [],
    createdAt: "2026-11-12T00:00:00.000Z",
    ...overrides
  };
}

/** The round's planted record plus near neighbours, in a fixed order. */
function seedPackages(service: LogisticsService) {
  const state = internals(service);
  state.packages.push(
    makePackage({
      id: "pkg_pr10_find",
      packageNumber: "PKG-2026-11-000105",
      receivingRecordNumber: "RR-2026-11-000105",
      customerName: "Findability Motors Inc",
      description: "Findability brake pads",
      destination: "Naga",
      price: 1500
    }),
    makePackage({
      id: "pkg_pr10_motor",
      packageNumber: "PKG-2026-11-000106",
      receivingRecordNumber: "RR-2026-11-000106",
      customerName: "Motor Parts Trading",
      description: "Motor oil drums",
      price: 900
    }),
    makePackage({
      id: "pkg_pr10_santos",
      packageNumber: "PKG-2026-11-000107",
      receivingRecordNumber: "RR-2026-11-000107",
      customerName: "Santos Logistics",
      description: "Rice sacks",
      price: 700
    }),
    makePackage({
      id: "pkg_pr10_samson",
      packageNumber: "PKG-2026-11-000108",
      receivingRecordNumber: "RR-2026-11-000108",
      customerName: "Samson Hardware",
      description: "Roofing sheets",
      destination: "Naga",
      handlingBranchId: "naga",
      handlingBranchName: "Naga",
      price: 800
    }),
    makePackage({
      id: "pkg_pr10_find2",
      packageNumber: "PKG-2026-11-000109",
      receivingRecordNumber: "RR-2026-11-000109",
      customerName: "Findability Trading Corp",
      description: "Gaskets",
      price: 300
    }),
    makePackage({
      id: "pkg_pr10_find3",
      packageNumber: "PKG-2026-11-000110",
      receivingRecordNumber: "RR-2026-11-000110",
      customerName: "Findability Logistics",
      description: "Filters",
      price: 250
    })
  );
}

const idsOf = (records: Array<{ id: string }>) => records.map((record) => record.id);

describe("C-M12 — the packages search survives a one-letter typo", () => {
  test("the round's exact probe: 'Findabilty' finds the Findability Motors package", async () => {
    const service = await bootService();
    seedPackages(service);

    // Control (the round's passing leg): the correct spelling finds it.
    expect(idsOf(service.listPackages({ search: "Findability" }))).toContain("pkg_pr10_find");
    // The round's failing leg: one letter dropped now finds it too,
    // together with the other two Findability customers — and nothing
    // else in the fixture.
    expect(idsOf(service.listPackages({ search: "Findabilty" }))).toEqual([
      "pkg_pr10_find",
      "pkg_pr10_find2",
      "pkg_pr10_find3"
    ]);
    await service.onModuleDestroy();
  });

  test("a typo in one token of a multi-word query still finds the record ('Findabilty Motors')", async () => {
    const service = await bootService();
    seedPackages(service);

    expect(idsOf(service.listPackages({ search: "Findabilty Motors" }))).toEqual(["pkg_pr10_find"]);
    await service.onModuleDestroy();
  });

  test("substitution, deletion and transposition typos each find their record", async () => {
    const service = await bootService();
    seedPackages(service);

    // Substitution: Santos -> Santoz.
    expect(idsOf(service.listPackages({ search: "Santoz" }))).toEqual(["pkg_pr10_santos"]);
    // Deletion: Santos -> Sntos.
    expect(idsOf(service.listPackages({ search: "Sntos" }))).toEqual(["pkg_pr10_santos"]);
    // Transposition: Motors -> Motros (Damerau distance 1; plain
    // Levenshtein would call this 2 and miss it).
    expect(idsOf(service.listPackages({ search: "Motros" }))).toEqual(["pkg_pr10_find"]);
    await service.onModuleDestroy();
  });
});

describe("C-M12 — correctly-spelled searches are byte-for-byte the old behaviour", () => {
  test("exact and partial searches return the same records in the same order", async () => {
    const service = await bootService();
    seedPackages(service);

    expect(idsOf(service.listPackages({}))).toEqual([
      "pkg_pr10_find",
      "pkg_pr10_motor",
      "pkg_pr10_santos",
      "pkg_pr10_samson",
      "pkg_pr10_find2",
      "pkg_pr10_find3"
    ]);
    expect(idsOf(service.listPackages({ search: "Findability" }))).toEqual([
      "pkg_pr10_find",
      "pkg_pr10_find2",
      "pkg_pr10_find3"
    ]);
    expect(idsOf(service.listPackages({ search: "Trading" }))).toEqual(["pkg_pr10_motor", "pkg_pr10_find2"]);
    // The number-fragment leg the round passed: substring over the
    // package number, unchanged.
    expect(idsOf(service.listPackages({ search: "000105" }))).toEqual(["pkg_pr10_find"]);
    await service.onModuleDestroy();
  });

  test("the fuzzy tier never adds records to a search the substring tier already answered", async () => {
    const service = await bootService();
    seedPackages(service);

    // "Motors" is spelled correctly and substring-matches only the
    // Findability Motors package. "Motor Parts Trading" sits one edit
    // away — the fuzzy tier would take it — but the tier must not run,
    // so it stays out.
    expect(idsOf(service.listPackages({ search: "Motors" }))).toEqual(["pkg_pr10_find"]);
    await service.onModuleDestroy();
  });
});

describe("C-M12 — the fuzzy tier's bounds hold", () => {
  test("a two-letter garble matches nothing", async () => {
    const service = await bootService();
    seedPackages(service);

    // Motors -> Motxrz: two substitutions, distance 2 > the 1-edit cap.
    expect(idsOf(service.listPackages({ search: "Motxrz" }))).toEqual([]);
    // Findability -> Findabilty is one edit (finds records, pinned
    // above); Findxbilty is two (a->x plus a dropped i) and must not.
    // It must not be rescued by containment either: the garble
    // contains the fixture id's "find" token, and a query token that
    // merely contains a field token is not a match.
    expect(idsOf(service.listPackages({ search: "Findxbilty" }))).toEqual([]);
    await service.onModuleDestroy();
  });

  test("short tokens stay strict: a 3-letter fragment of a name does not fuzzy-match", async () => {
    const service = await bootService();
    seedPackages(service);

    // "Mtr" is a 3-letter garble of "Motor"/"Motors": under-4 tokens
    // get no edit distance, and it is contained in no field token.
    expect(idsOf(service.listPackages({ search: "Mtr" }))).toEqual([]);
    await service.onModuleDestroy();
  });

  test("numeric tokens stay exact: a mistyped digit finds nothing", async () => {
    const service = await bootService();
    seedPackages(service);

    // 000105 exists; 000205 is one digit off. Typo tolerance is for
    // words — a digit slip must not surface the wrong package.
    expect(idsOf(service.listPackages({ search: "000205" }))).toEqual([]);
    expect(idsOf(service.listPackages({ search: "000115" }))).toEqual([]);
    await service.onModuleDestroy();
  });

  test("branch scoping still applies inside the fuzzy tier", async () => {
    const service = await bootService();
    seedPackages(service);

    const daetCaller = { id: "user_pr10_daet", role: "Daet Owner", branchAccess: "Daet" };
    // Samson Hardware is Naga-handled and Naga-bound: invisible to a
    // Daet caller even though "Samsom" is one edit from "Samson".
    expect(idsOf(service.listPackages({ search: "Samsom" }, daetCaller))).toEqual([]);
    expect(idsOf(service.listPackages({ search: "Samsom" }))).toEqual(["pkg_pr10_samson"]);
    await service.onModuleDestroy();
  });

  test("limit and cursor paginate the fuzzy tier like any other result", async () => {
    const service = await bootService();
    seedPackages(service);

    const firstPage = service.listPackages({ search: "Findabilty", limit: 2 });
    expect(idsOf(firstPage)).toEqual(["pkg_pr10_find", "pkg_pr10_find2"]);
    const secondPage = service.listPackages({ search: "Findabilty", limit: 2, cursor: "pkg_pr10_find2" });
    expect(idsOf(secondPage)).toEqual(["pkg_pr10_find3"]);
    await service.onModuleDestroy();
  });
});

describe("C-M12 — the other API list searches inherit the same tiers", () => {
  test("trips: a typo in the driver name finds the trip", async () => {
    const service = await bootService();
    internals(service).trips.push({
      id: "trip_pr10",
      tripNumber: "TRIP-2026-11-0010",
      origin: "Daet",
      destination: "Naga",
      status: "Completed",
      isMixedTrip: false,
      plateNumber: "ABC 1234",
      driverName: "Juan Dela Cruz",
      cargoPackageIds: [],
      createdAt: "2026-11-12T00:00:00.000Z"
    });

    expect(idsOf(service.listTrips({ search: "Dela Cruzz" }))).toEqual(["trip_pr10"]);
    expect(idsOf(service.listTrips({ search: "Dela Cruz" }))).toEqual(["trip_pr10"]);
    await service.onModuleDestroy();
  });

  test("expenses: a transposed description word finds the expense", async () => {
    const service = await bootService();
    internals(service).expenses.push({
      id: "exp_pr10",
      category: "Meals",
      amount: 250,
      description: "Diesel and crew meals",
      status: "Approved",
      createdAt: "2026-11-12T00:00:00.000Z"
    });

    expect(idsOf(service.listExpenses({ search: "Deisel" }))).toEqual(["exp_pr10"]);
    expect(idsOf(service.listExpenses({ search: "Diesel" }))).toEqual(["exp_pr10"]);
    await service.onModuleDestroy();
  });

  test("products: a transposed name word finds the product master", async () => {
    const service = await bootService();
    internals(service).productMasters.push({
      id: "prod_pr10",
      name: "Brake Pads Premium",
      sku: "BP-100",
      brand: "Findability",
      category: "Auto Parts",
      defaultUnit: "set",
      status: "Active",
      createdAt: "2026-11-12T00:00:00.000Z"
    });

    expect(idsOf(service.listProductMasters({ search: "Braek Pads" }))).toEqual(["prod_pr10"]);
    expect(idsOf(service.listProductMasters({ search: "Brake Pads" }))).toEqual(["prod_pr10"]);
    await service.onModuleDestroy();
  });
});
