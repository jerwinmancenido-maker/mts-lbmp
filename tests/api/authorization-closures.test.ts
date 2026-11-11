import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rolePresets } from "@mts-lbmp/permissions";
import { AuthGuard, IS_PUBLIC_ROUTE, REQUIRED_PERMISSIONS } from "../../apps/api/src/modules/auth.guard";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { hashSecret, verifyAuthToken } from "../../apps/api/src/modules/security";
import type {
  BillingInvoice,
  CargoPackage,
  Customer,
  DeliveryRecord,
  ExpenseRecord,
  PaymentRecord,
  ReceivingDraft,
  ReceivingIntakeTask,
  ReceivingRecord,
  ReturnRecord,
  StaffUserRecord,
  Trip
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 5 tranche P5-3 — authorization closures.
 *
 * What is proven here:
 * - Branch scoping is a SERVER control now: every list/detail read named
 *   in the audit §2.3 is filtered by the caller's stored branchAccess.
 *   A Naga-scoped caller does not see a Daet-handled, Daet-destined
 *   package in GET /packages, and a direct detail read of it (QR label,
 *   messages, receiving audit) answers 404 exactly like a missing
 *   package. A package IS visible to its destination branch (incoming
 *   cargo), and an unrestricted caller ("All branches", or a grant
 *   naming every branch) sees everything. Records with no branch
 *   attribution (trip-less expense, destination-less draft, packageless
 *   invoice) are not hidden — there is no branch whose data they leak.
 * - GET /packages requires the new `packages.view` permission: every
 *   staff preset holds it, every customer preset stays empty, so a
 *   customer token is refused by the guard (their tracking stays on the
 *   public reference endpoint, which still answers without a token).
 * - The bootstrap split: getPublicBootstrap() returns ONLY company
 *   branding, branch names/codes, and the payment/expense defaults —
 *   key-scanned for users/customers/trucks and for staff emails — while
 *   the full getBootstrap() (now behind a token) is unchanged.
 * - Uploads: POST /uploads is no longer a public route (the guard
 *   refuses a tokenless call), and the scoped public intake variant
 *   accepts only the wall-QR DR photo type through the shared
 *   type/size enforcement (GIF rejected, >5 MB rejected).
 * - Write-path branch check: a branch-scoped loader cannot load another
 *   branch's package onto a trip.
 *
 * CORS is covered by live checks in the gate (main.ts boots the app, so
 * it has no unit seam): an allow-listed Origin is echoed, a foreign
 * Origin is not.
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  customers: Customer[];
  packages: CargoPackage[];
  trips: Trip[];
  deliveries: DeliveryRecord[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  receivingRecords: ReceivingRecord[];
  receivingDrafts: ReceivingDraft[];
  receivingIntakeTasks: ReceivingIntakeTask[];
  returnRecords: ReturnRecord[];
  billingInvoices: BillingInvoice[];
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
  const dir = mkdtempSync(join(tmpdir(), "mts-p5-3-"));
  tempRoots.push(dir);
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

function addUser(service: LogisticsService, user: StaffUserRecord) {
  internals(service).customUsers.push(user);
  return user;
}

/* ------------------------------------------------------------------ */
/* Fixtures: one Daet-local package, one Naga-local package, and the   */
/* records that hang off them.                                         */
/* ------------------------------------------------------------------ */

const NOW = "2026-11-12T00:00:00.000Z";

function makePackage(overrides: Partial<CargoPackage>): CargoPackage {
  return {
    id: "pkg_p53",
    packageNumber: "PKG-P53",
    receivingRecordNumber: "RR-P53",
    customerId: "cust_p53",
    customerName: "P5-3 Fixture Customer",
    productId: "prod_p53",
    description: "Fixture cargo",
    quantity: 1,
    unit: "box",
    destination: "Daet",
    handlingBranchId: "daet",
    handlingBranchName: "Daet",
    deliveryType: "Deliver to consignee",
    condition: "Good",
    status: "Received",
    price: 500,
    qrValue: "MTS:PKG:PKG-P53",
    photoUrls: [],
    createdAt: NOW,
    ...overrides
  };
}

const pkgDaet = makePackage({ id: "pkg_p53_daet", packageNumber: "PKG-P53-DAET", qrValue: "MTS:PKG:PKG-P53-DAET" });
const pkgNaga = makePackage({
  id: "pkg_p53_naga",
  packageNumber: "PKG-P53-NAGA",
  qrValue: "MTS:PKG:PKG-P53-NAGA",
  destination: "Naga",
  handlingBranchId: "naga",
  handlingBranchName: "Naga"
});
/** Handled in Daet, destined for Naga: incoming cargo for Naga. */
const pkgDaetToNaga = makePackage({
  id: "pkg_p53_incoming",
  packageNumber: "PKG-P53-INCOMING",
  qrValue: "MTS:PKG:PKG-P53-INCOMING",
  destination: "Naga"
});

function seedOperations(service: LogisticsService) {
  const state = internals(service);
  state.customers.push({ id: "cust_p53", businessName: "P5-3 Fixture Customer", status: "Active", billingTerm: "Pay upon delivery" });
  state.packages.push(pkgDaet, pkgNaga, pkgDaetToNaga);
  state.trips.push(
    { id: "trip_p53_daet_local", tripNumber: "TRIP-P53-D", origin: "Daet", destination: "Daet", status: "Planned", isMixedTrip: false, cargoPackageIds: [], createdAt: NOW },
    { id: "trip_p53_naga_local", tripNumber: "TRIP-P53-N", origin: "Naga", destination: "Naga", status: "Planned", isMixedTrip: false, cargoPackageIds: [], createdAt: NOW },
    { id: "trip_p53_cross", tripNumber: "TRIP-P53-X", origin: "Daet", destination: "Naga", status: "Planned", isMixedTrip: false, cargoPackageIds: [], createdAt: NOW }
  );
  state.deliveries.push(
    { id: "del_p53_daet", cargoPackageId: pkgDaet.id, status: "Delivered", createdAt: NOW },
    { id: "del_p53_naga", cargoPackageId: pkgNaga.id, status: "Delivered", createdAt: NOW }
  );
  state.payments.push(
    { id: "pay_p53_daet", cargoPackageId: pkgDaet.id, amountDue: 500, amountPaid: 500, balance: 0, method: "Cash", collectionPoint: "Receiving", branchName: "Daet", status: "Paid", createdAt: NOW },
    { id: "pay_p53_naga", cargoPackageId: pkgNaga.id, amountDue: 500, amountPaid: 500, balance: 0, method: "Cash", collectionPoint: "Receiving", branchName: "Naga", status: "Paid", createdAt: NOW }
  );
  state.expenses.push(
    { id: "exp_p53_daet_trip", tripId: "trip_p53_daet_local", category: "Fuel", amount: 100, status: "Submitted", createdAt: NOW },
    { id: "exp_p53_tripless", category: "Office", amount: 50, status: "Submitted", createdAt: NOW }
  );
  state.receivingRecords.push(
    { id: "rec_p53_daet", recordNumber: "RR-P53-DAET", customerId: "cust_p53", customerName: "P5-3 Fixture Customer", destination: "Daet", packages: [pkgDaet], createdAt: NOW },
    { id: "rec_p53_naga", recordNumber: "RR-P53-NAGA", customerId: "cust_p53", customerName: "P5-3 Fixture Customer", destination: "Naga", packages: [pkgNaga], createdAt: NOW }
  );
  state.receivingDrafts.push(
    { id: "draft_p53_daet", draftNumber: "DRF-P53-D", status: "Draft", destination: "Daet", formState: {}, productLines: [], createdBy: "fixture", updatedBy: "fixture", createdAt: NOW, updatedAt: NOW },
    { id: "draft_p53_open", draftNumber: "DRF-P53-O", status: "Draft", formState: {}, productLines: [], createdBy: "fixture", updatedBy: "fixture", createdAt: NOW, updatedAt: NOW }
  );
  state.receivingIntakeTasks.push(
    {
      id: "intake_p53_daet", intakeNumber: "INT-P53-D", status: "Pending Review", source: "Wall QR", warehouseCode: "daet",
      duplicateKey: "k-daet", duplicateCount: 1, customerNameTyped: "Fixture Customer", customerMatched: false,
      receiverMatched: false, productMatched: false, destinationBranch: "Daet", extraPhotoUrls: [], duplicateNotes: [],
      createdAt: NOW, updatedAt: NOW
    },
    {
      id: "intake_p53_naga", intakeNumber: "INT-P53-N", status: "Pending Review", source: "Wall QR", warehouseCode: "naga",
      duplicateKey: "k-naga", duplicateCount: 1, customerNameTyped: "Fixture Customer", customerMatched: false,
      receiverMatched: false, productMatched: false, destinationBranch: "Naga", extraPhotoUrls: [], duplicateNotes: [],
      createdAt: NOW, updatedAt: NOW
    }
  );
  state.returnRecords.push(
    { id: "ret_p53_daet", cargoPackageId: pkgDaet.id, reason: "Fixture return", nextAction: "Hold at Branch", status: "Requested", createdAt: NOW },
    { id: "ret_p53_naga", cargoPackageId: pkgNaga.id, reason: "Fixture return", nextAction: "Hold at Branch", status: "Requested", createdAt: NOW }
  );
  state.billingInvoices.push(
    { id: "inv_p53_daet", invoiceNumber: "INV-P53-D", customerId: "cust_p53", customerName: "P5-3 Fixture Customer", packageIds: [pkgDaet.id], amountDue: 500, amountPaid: 0, balance: 500, dueRule: "Pay upon delivery", status: "Issued", createdAt: NOW },
    { id: "inv_p53_open", invoiceNumber: "INV-P53-O", customerId: "cust_p53", customerName: "P5-3 Fixture Customer", packageIds: [], amountDue: 0, amountPaid: 0, balance: 0, dueRule: "Pay upon delivery", status: "Draft", createdAt: NOW }
  );
}

const nagaCaller = { id: "user_p53_naga", role: "Naga Owner", branchAccess: "Naga" };
const daetCaller = { id: "user_p53_daet", role: "Daet Owner", branchAccess: "Daet" };
const allBranchesCaller = { id: "user_p53_admin", role: "System Admin", branchAccess: "All branches" };
const bothBranchesCaller = { id: "user_p53_both", role: "Delivery Staff", branchAccess: "Daet / Naga" };

const idsOf = (records: Array<{ id: string }>) => records.map((record) => record.id);

/* ------------------------------------------------------------------ */

describe("branch-scoped lists", () => {
  test("GET /packages rule: a Naga caller sees Naga cargo and incoming cargo, never Daet-local cargo", async () => {
    const service = await bootService();
    seedOperations(service);

    const nagaList = idsOf(service.listPackages({}, nagaCaller));
    expect(nagaList).toContain(pkgNaga.id);
    // Incoming cargo: handled in Daet but destined for Naga — the
    // destination branch legitimately works this package on arrival.
    expect(nagaList).toContain(pkgDaetToNaga.id);
    expect(nagaList).not.toContain(pkgDaet.id);

    const daetList = idsOf(service.listPackages({}, daetCaller));
    expect(daetList).toContain(pkgDaet.id);
    expect(daetList).toContain(pkgDaetToNaga.id);
    expect(daetList).not.toContain(pkgNaga.id);

    for (const caller of [allBranchesCaller, bothBranchesCaller, undefined]) {
      const list = idsOf(service.listPackages({}, caller));
      expect(list).toEqual(expect.arrayContaining([pkgDaet.id, pkgNaga.id, pkgDaetToNaga.id]));
    }

    await service.onModuleDestroy();
  });

  test("trips, deliveries, payments, expenses, receiving, drafts, intake, returns and invoices follow the same rule", async () => {
    const service = await bootService();
    seedOperations(service);

    const trips = idsOf(service.listTrips({}, nagaCaller));
    expect(trips).toContain("trip_p53_naga_local");
    expect(trips).toContain("trip_p53_cross"); // touches Naga as destination
    expect(trips).not.toContain("trip_p53_daet_local");

    const deliveries = idsOf(service.listDeliveries(nagaCaller));
    expect(deliveries).toContain("del_p53_naga");
    expect(deliveries).not.toContain("del_p53_daet");

    const payments = idsOf(service.listPayments({}, nagaCaller));
    expect(payments).toContain("pay_p53_naga");
    expect(payments).not.toContain("pay_p53_daet");

    const expenses = idsOf(service.listExpenses({}, nagaCaller));
    expect(expenses).not.toContain("exp_p53_daet_trip");
    // No trip → no branch attribution → not hidden (documented rule).
    expect(expenses).toContain("exp_p53_tripless");

    const receiving = idsOf(service.listReceivingRecords(nagaCaller));
    expect(receiving).toContain("rec_p53_naga");
    expect(receiving).not.toContain("rec_p53_daet");

    const drafts = idsOf(service.listReceivingDrafts(nagaCaller));
    expect(drafts).not.toContain("draft_p53_daet");
    expect(drafts).toContain("draft_p53_open"); // no destination yet

    const intake = idsOf(service.listReceivingIntakeTasks({}, nagaCaller));
    expect(intake).toContain("intake_p53_naga");
    expect(intake).not.toContain("intake_p53_daet");

    const returns = idsOf(service.listReturnRecords(nagaCaller));
    expect(returns).toContain("ret_p53_naga");
    expect(returns).not.toContain("ret_p53_daet");

    const invoices = idsOf(service.listBillingInvoices(nagaCaller));
    expect(invoices).not.toContain("inv_p53_daet");
    expect(invoices).toContain("inv_p53_open"); // no packages yet

    await service.onModuleDestroy();
  });
});

describe("branch-scoped detail reads", () => {
  test("a cross-branch package detail answers 404 exactly like a missing package", async () => {
    const service = await bootService();
    seedOperations(service);

    expect(() => service.renderQrLabel(pkgDaet.id, nagaCaller)).toThrow("Cargo package not found");
    expect(() => service.renderQrLabel("pkg_does_not_exist", nagaCaller)).toThrow("Cargo package not found");
    expect(() => service.renderReceivingSlip(pkgDaet.id, nagaCaller)).toThrow("Cargo package not found");
    expect(() => service.listMessages(pkgDaet.id, nagaCaller)).toThrow("Cargo package not found");
    expect(() => service.listReceivingRecordAudit("rec_p53_daet", nagaCaller)).toThrow("Receiving record not found");
    expect(() => service.renderReceivingDocument("rec_p53_daet", nagaCaller)).toThrow("Receiving record not found");
    expect(() => service.renderTripManifest("trip_p53_daet_local", nagaCaller)).toThrow("Trip not found");

    // The owning branch (and the destination branch for incoming cargo)
    // reads the same details fine.
    expect(service.renderQrLabel(pkgDaet.id, daetCaller).print.documentNumber).toBe(pkgDaet.packageNumber);
    expect(service.renderQrLabel(pkgDaetToNaga.id, nagaCaller).print.documentNumber).toBe(pkgDaetToNaga.packageNumber);
    expect(service.listMessages(pkgDaet.id, daetCaller)).toEqual([]);
    expect(Array.isArray(service.listReceivingRecordAudit("rec_p53_daet", daetCaller))).toBe(true);
    expect(service.renderTripManifest("trip_p53_cross", nagaCaller).print.documentNumber).toBe("TRIP-P53-X");

    await service.onModuleDestroy();
  });

  test("write-path check: a branch-scoped loader cannot load another branch's package", async () => {
    const service = await bootService();
    seedOperations(service);

    expect(() => service.loadCargo("trip_p53_naga_local", { cargoPackageId: pkgDaet.id }, nagaCaller)).toThrow(
      /outside your branch access/
    );
    expect(internals(service).trips.find((trip) => trip.id === "trip_p53_naga_local")?.cargoPackageIds).toEqual([]);

    const loaded = service.loadCargo("trip_p53_daet_local", { cargoPackageId: pkgDaet.id }, daetCaller);
    expect(loaded.trip.cargoPackageIds).toContain(pkgDaet.id);

    await service.onModuleDestroy();
  });
});

describe("packages.view permission", () => {
  test("every staff preset holds packages.view; every customer preset stays empty", () => {
    for (const role of ["Administrator", "System Admin", "Daet Owner", "Naga Owner", "Receiving Staff", "Delivery Staff", "Delivery Admin"]) {
      expect(rolePresets[role]).toContain("packages.view");
    }
    for (const role of ["Customer Owner", "Customer Accounting", "Customer Operations", "Customer Viewer"]) {
      expect(rolePresets[role]).toEqual([]);
    }
  });

  /** Guard doubles in the real-credentials.test.ts style, with metadata. */
  function guardFor(service: LogisticsService, metadata: { public?: boolean; permissions?: string[] }) {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === IS_PUBLIC_ROUTE ? metadata.public : key === REQUIRED_PERMISSIONS ? metadata.permissions : undefined
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
      path: "/packages"
    };
    return {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request })
    };
  }

  test("the guard refuses a customer token on GET /packages and admits staff tokens", async () => {
    const service = await bootService();
    addUser(service, { id: "user_p53_customer", name: "Fixture Customer User", email: "customer.p53@mts.local", role: "Customer Owner", status: "Active", passwordHash: hashSecret("customer-pw-1") });
    addUser(service, { id: "user_p53_delivery", name: "Fixture Delivery", email: "delivery.p53@mts.local", role: "Delivery Staff", branchAccess: "Naga", status: "Active", passwordHash: hashSecret("delivery-pw-1") });

    const customerToken = service.login({ email: "customer.p53@mts.local", password: "customer-pw-1" }).token;
    const deliveryToken = service.login({ email: "delivery.p53@mts.local", password: "delivery-pw-1" }).token;

    const packagesGuard = guardFor(service, { permissions: ["packages.view"] });
    expect(packagesGuard.canActivate(contextFor(customerToken) as never)).toBe(false);
    expect(packagesGuard.canActivate(contextFor(deliveryToken) as never)).toBe(true);
    expect(packagesGuard.canActivate(contextFor(undefined) as never)).toBe(false);

    await service.onModuleDestroy();
  });

  test("the guard refuses tokenless calls to POST /uploads and GET /bootstrap, and admits the public routes", async () => {
    const service = await bootService();
    addUser(service, { id: "user_p53_delivery2", name: "Fixture Delivery Two", email: "delivery2.p53@mts.local", role: "Delivery Staff", branchAccess: "Naga", status: "Active", passwordHash: hashSecret("delivery-pw-2") });
    const deliveryToken = service.login({ email: "delivery2.p53@mts.local", password: "delivery-pw-2" }).token;

    // POST /uploads after P5-3: authenticated, no narrower permission.
    const uploadsGuard = guardFor(service, {});
    expect(uploadsGuard.canActivate(contextFor(undefined) as never)).toBe(false);
    expect(uploadsGuard.canActivate(contextFor(deliveryToken) as never)).toBe(true);

    // GET /bootstrap after P5-3: authenticated full bootstrap.
    const bootstrapGuard = guardFor(service, {});
    expect(bootstrapGuard.canActivate(contextFor(undefined) as never)).toBe(false);
    expect(bootstrapGuard.canActivate(contextFor(deliveryToken) as never)).toBe(true);

    // The public routes stay public: reduced bootstrap + tracking.
    const publicGuard = guardFor(service, { public: true });
    expect(publicGuard.canActivate(contextFor(undefined) as never)).toBe(true);

    await service.onModuleDestroy();
  });
});

describe("bootstrap split", () => {
  test("the public projection carries branding, branch names and defaults — and no staff or customer data", async () => {
    const service = await bootService();
    addUser(service, { id: "user_p53_staff", name: "Fixture Staff", email: "staff.p53@mts.local", role: "Receiving Staff", branchAccess: "Daet", status: "Active", passwordHash: hashSecret("staff-pw-1") });

    const projection = service.getPublicBootstrap();
    expect(Object.keys(projection).sort()).toEqual(["branches", "companyProfile", "defaultExpenseCategories", "defaultPaymentMethods"]);
    expect(projection.companyProfile.companyName).toBeTruthy();
    expect(projection.companyProfile).not.toHaveProperty("email");
    expect(projection.branches.length).toBeGreaterThan(0);
    for (const branch of projection.branches) {
      expect(Object.keys(branch).sort()).toEqual(["code", "name"]);
    }
    expect(Array.isArray(projection.defaultPaymentMethods)).toBe(true);
    expect(Array.isArray(projection.defaultExpenseCategories)).toBe(true);

    // Key scan, the permission-smoke assertion in unit form: no staff
    // emails, no credential material, no directory keys anywhere.
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("staff.p53@mts.local");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("pbkdf2:");
    expect(serialized).not.toContain("\"users\"");
    expect(serialized).not.toContain("\"customers\"");
    expect(serialized).not.toContain("\"trucks\"");

    // The full bootstrap is unchanged for the authenticated shell.
    const full = service.getBootstrap();
    expect(full.users.map((user) => user.email)).toContain("staff.p53@mts.local");
    expect(Array.isArray(full.customers)).toBe(true);
    expect(Array.isArray(full.trucks)).toBe(true);

    await service.onModuleDestroy();
  });
});

describe("uploads split", () => {
  const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
  const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

  test("the intake variant accepts a valid DR photo and rejects wrong scope, type and size", async () => {
    const service = await bootService();

    const accepted = await service.uploadIntakePhoto({ dataUrl: TINY_PNG, fileName: "dr.png", type: "wall-qr-dr-photo", entityId: "DR-1" });
    expect(accepted.fileUrl).toMatch(/^\/uploads\//);
    expect(accepted.mimeType).toBe("image/png");

    // Any other photo type is staff business and does not belong here.
    await expect(service.uploadIntakePhoto({ dataUrl: TINY_PNG, fileName: "dr.png", type: "receiving-dr-photo" })).rejects.toThrow(
      "only accepts wall-QR intake DR photos"
    );
    // File-type enforcement is shared with the staff endpoint.
    await expect(service.uploadIntakePhoto({ dataUrl: GIF, fileName: "dr.gif", type: "wall-qr-dr-photo" })).rejects.toThrow(
      "Only JPEG, PNG, and WebP images are accepted"
    );
    // Size enforcement: just over the 5 MB cap.
    const oversize = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")}`;
    await expect(service.uploadIntakePhoto({ dataUrl: oversize, fileName: "big.png", type: "wall-qr-dr-photo" })).rejects.toThrow(
      "exceeds 5MB"
    );

    // The staff endpoint itself is unchanged apart from its new token
    // requirement (guard-proven above).
    const staffUpload = await service.uploadFile({ dataUrl: TINY_PNG, fileName: "staff.png", type: "receiving-dr-photo" });
    expect(staffUpload.fileUrl).toMatch(/^\/uploads\//);

    await service.onModuleDestroy();
  });
});

describe("public tracking (unchanged by design)", () => {
  test("trackShipment still answers from a bare reference with no caller context", async () => {
    const service = await bootService();
    seedOperations(service);

    const tracked = service.trackShipment(pkgDaet.packageNumber);
    expect(tracked.packageNumber).toBe(pkgDaet.packageNumber);
    expect(tracked.status).toBe(pkgDaet.status);
    expect(tracked.destination).toBe(pkgDaet.destination);

    await service.onModuleDestroy();
  });
});
