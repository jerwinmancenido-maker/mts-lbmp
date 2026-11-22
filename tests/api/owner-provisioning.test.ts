import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { rolePresets } from "@mts-lbmp/permissions";
import { AuthGuard } from "../../apps/api/src/modules/auth.guard";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { hashSecret, verifyAuthToken } from "../../apps/api/src/modules/security";
import type { CargoPackage, PaymentRecord, StaffUserRecord } from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 fix loop PR-5 — owner account provisioning (canonical finding
 * C-M6; filed as L5-F2 = L2-F4, journey J13).
 *
 * Before this fix, POST /settings/users (createStaffUser) refused every
 * role except Receiving Staff / Delivery Staff / Delivery Admin, so a
 * Daet Owner or Naga Owner could not be provisioned through the app at
 * all — the Round 1 drivers had to write owner accounts straight into
 * state. What is proven here:
 * - A System Admin actor can create a Daet Owner / Naga Owner through
 *   the same lifecycle as staff (initial password hashed, flagged
 *   mustChangePassword, forced change at first sign-in), and the
 *   created owner signs in and lands in exactly its CR-006 preset
 *   scope: branch-scoped lists, 404 existence-hiding on the other
 *   branch's records, branch-scoped dashboard figures (the L5 matrix
 *   shape for owners).
 * - An owner's branchAccess comes from its preset, never from the
 *   request: omitted access defaults to the preset branch, and a
 *   supplied grant naming anything else (the other branch, both
 *   branches, all branches) is refused.
 * - Non-admin actors keep today's restriction exactly: an owner or
 *   staff actor (or no actor) attempting to create an owner is refused
 *   with no record written — while those same actors can still create
 *   staff, as users.manage holders could before. Invalid roles are
 *   refused the same way for every actor, System Admin included.
 * - The edit path matches: only a System Admin actor can assign an
 *   owner role via updateStaffUser; the promotion narrows branchAccess
 *   to the preset branch and bumps sessionVersion (the promoted user's
 *   old token dies). Staff-role edits behave exactly as before.
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  packages: CargoPackage[];
  payments: PaymentRecord[];
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
  const dir = mkdtempSync(join(tmpdir(), "mts-owner-provisioning-"));
  tempRoots.push(dir);
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

/** Minimal Nest doubles, mirroring the account-lifecycle tests. */
function guardFor(service: LogisticsService) {
  const reflector = { getAllAndOverride: () => undefined };
  const jwt = {
    verify: (token: string) => {
      const payload = verifyAuthToken(token);
      if (!payload) throw new Error("invalid token");
      return payload;
    }
  };
  return new AuthGuard(reflector as never, service, jwt as never);
}

function contextFor(token: string, url: string) {
  const request: { headers: Record<string, string>; user?: unknown; url: string } = {
    headers: { authorization: `Bearer ${token}` },
    url
  };
  return {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => request })
  };
}

function seedUser(service: LogisticsService, overrides: Partial<StaffUserRecord> & Pick<StaffUserRecord, "id" | "role">) {
  const user: StaffUserRecord = {
    name: overrides.id,
    email: `${overrides.id}@example.test`,
    branchAccess: "All branches",
    status: "Active",
    sessionVersion: 0,
    ...overrides
  };
  internals(service).customUsers.push(user);
  return user;
}

function seedAdmin(service: LogisticsService) {
  return seedUser(service, {
    id: "user_admin",
    name: "Provisioning Admin",
    email: "admin@example.test",
    role: "System Admin",
    branchAccess: "All branches",
    passwordHash: hashSecret("admin-pw-123")
  });
}

const NOW = "2026-11-12T00:00:00.000Z";

function makePackage(overrides: Partial<CargoPackage>): CargoPackage {
  return {
    id: "pkg_pr5",
    packageNumber: "PKG-PR5",
    receivingRecordNumber: "RR-PR5",
    customerId: "cust_pr5",
    customerName: "PR-5 Fixture Customer",
    productId: "prod_pr5",
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
    qrValue: "MTS:PKG:PKG-PR5",
    photoUrls: [],
    createdAt: NOW,
    ...overrides
  };
}

/** One Daet-local and one Naga-local package, each with a full payment —
 *  the smallest dataset that shows branch scoping on lists, detail
 *  reads, and the dashboard's paymentsCollected figure. */
function seedBranchData(service: LogisticsService) {
  const state = internals(service);
  state.packages.push(
    makePackage({ id: "pkg_pr5_daet", packageNumber: "PKG-PR5-DAET", qrValue: "MTS:PKG:PKG-PR5-DAET" }),
    makePackage({
      id: "pkg_pr5_naga",
      packageNumber: "PKG-PR5-NAGA",
      qrValue: "MTS:PKG:PKG-PR5-NAGA",
      destination: "Naga",
      handlingBranchId: "naga",
      handlingBranchName: "Naga"
    })
  );
  state.payments.push(
    {
      id: "pay_pr5_daet",
      cargoPackageId: "pkg_pr5_daet",
      amountDue: 1000,
      amountPaid: 1000,
      balance: 0,
      method: "Cash",
      collectionPoint: "Receiving",
      branchName: "Daet",
      status: "Paid",
      createdAt: NOW
    },
    {
      id: "pay_pr5_naga",
      cargoPackageId: "pkg_pr5_naga",
      amountDue: 500,
      amountPaid: 500,
      balance: 0,
      method: "Cash",
      collectionPoint: "Receiving",
      branchName: "Naga",
      status: "Paid",
      createdAt: NOW
    }
  );
}

describe("System Admin provisions branch owners through the lifecycle", () => {
  test("create Daet Owner → flagged first sign-in → forced change → owner lands in Daet-only scope", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const guard = guardFor(service);
    seedBranchData(service);

    const created = service.createStaffUser(
      {
        name: "Daet Boss",
        email: "daet.owner@example.test",
        role: "Daet Owner",
        branchAccess: "Daet",
        password: "owner-temp-1"
      },
      admin.id
    );
    expect(created.role).toBe("Daet Owner");
    expect(created.branchAccess).toBe("Daet");
    expect(created.mustChangePassword).toBe(true);
    expect(created.hasPassword).toBe(true);
    expect(created).not.toHaveProperty("passwordHash");
    // The preset is the authorization source of truth (CR-006): the new
    // account's preset is its owner role, with the preset's permissions.
    const record = internals(service).customUsers.find((user) => user.id === created.id);
    expect(record?.permissionPreset).toBe("Daet Owner");
    expect(rolePresets[record?.permissionPreset as string]).toContain("users.manage");

    // First sign-in works but is flagged, and its token opens ONLY the
    // change-password endpoint — the same lifecycle staff get.
    const login = service.login({ email: "daet.owner@example.test", password: "owner-temp-1" });
    expect(login.user.mustChangePassword).toBe(true);
    expect(guard.canActivate(contextFor(login.token, "/dashboard") as never)).toBe(false);
    expect(guard.canActivate(contextFor(login.token, "/auth/change-password") as never)).toBe(true);

    service.changeOwnPassword(created.id, { currentPassword: "owner-temp-1", newPassword: "owner-own-pass-1" });
    const settled = service.login({ email: "daet.owner@example.test", password: "owner-own-pass-1" });
    expect(settled.user.mustChangePassword).toBe(false);
    expect(guard.canActivate(contextFor(settled.token, "/dashboard") as never)).toBe(true);

    // The L5 owner shape: Daet-only lists, the other branch's record
    // answers 404 exactly like a missing one, dashboard figures scoped.
    const ownerCtx = { id: created.id, role: "Daet Owner", branchAccess: "Daet" };
    const visible = service.listPackages({}, ownerCtx);
    expect(visible.map((pkg) => pkg.id)).toContain("pkg_pr5_daet");
    expect(visible.map((pkg) => pkg.id)).not.toContain("pkg_pr5_naga");
    expect(service.listMessages("pkg_pr5_daet", ownerCtx)).toEqual([]);
    expect(() => service.listMessages("pkg_pr5_naga", ownerCtx)).toThrow("Cargo package not found");
    const dashboard = service.getDashboard(ownerCtx);
    expect(dashboard.branchScope).toBe("Daet");
    expect(dashboard.paymentsCollected).toBe(1000);

    await service.onModuleDestroy();
  });

  test("owner branchAccess defaults from the preset and refuses any wider or foreign grant", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);

    // Omitted access → the preset's branch, never the staff default
    // ("Daet / Naga") that would hand the owner both branches.
    const naga = service.createStaffUser(
      { name: "Naga Boss", email: "naga.owner@example.test", role: "Naga Owner", branchAccess: "", password: "owner-temp-2" },
      admin.id
    );
    expect(naga.branchAccess).toBe("Naga");

    for (const branchAccess of ["Naga", "Daet / Naga", "All branches"]) {
      expect(() =>
        service.createStaffUser(
          { name: "Wrong Scope", email: `wrong-${branchAccess}@example.test`, role: "Daet Owner", branchAccess, password: "owner-temp-3" },
          admin.id
        )
      ).toThrow("Daet Owner accounts are scoped to the Daet branch");
    }
    // None of the refused creations wrote a record.
    expect(internals(service).customUsers.filter((user) => user.name === "Wrong Scope")).toHaveLength(0);

    await service.onModuleDestroy();
  });

  test("an owner can also be provisioned with a staff code only", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);

    const created = service.createStaffUser(
      { name: "Code Owner", email: "code.owner@example.test", role: "Naga Owner", branchAccess: "Naga", staffCode: "7788" },
      admin.id
    );
    expect(created.hasStaffCode).toBe(true);
    // Owners are in STAFF_CODE_LOGIN_ROLES, so the code door signs in.
    expect(service.loginWithStaffCode({ staffCode: "7788" }).user.id).toBe(created.id);

    await service.onModuleDestroy();
  });
});

describe("non-admin actors keep today's restriction exactly", () => {
  test("owner, staff, and anonymous actors cannot create owners — but can still create staff", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const ownerActor = seedUser(service, { id: "user_daet_owner", role: "Daet Owner", branchAccess: "Daet" });
    const staffActor = seedUser(service, { id: "user_receiver", role: "Receiving Staff", branchAccess: "Daet" });

    for (const actorId of [ownerActor.id, staffActor.id, undefined]) {
      expect(() =>
        service.createStaffUser(
          { name: "Sneaky Owner", email: "sneaky@example.test", role: "Naga Owner", branchAccess: "Naga", password: "owner-temp-9" },
          actorId
        )
      ).toThrow("Only a System Admin can add branch owner accounts");
    }
    expect(internals(service).customUsers.some((user) => user.name === "Sneaky Owner")).toBe(false);

    // The same actors keep the staff provisioning users.manage holders
    // had before this change — nothing about staff creation narrowed.
    const byOwner = service.createStaffUser(
      { name: "Owner-Made Receiver", email: "omr@example.test", role: "Receiving Staff", branchAccess: "Daet", staffCode: "6655" },
      ownerActor.id
    );
    expect(byOwner.role).toBe("Receiving Staff");
    const byAdmin = service.createStaffUser(
      { name: "Admin-Made Receiver", email: "amr@example.test", role: "Receiving Staff", branchAccess: "Naga", staffCode: "6656" },
      admin.id
    );
    expect(byAdmin.branchAccess).toBe("Naga");

    await service.onModuleDestroy();
  });

  test("invalid roles are refused the same way for every actor, System Admin included", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);

    // A second System Admin is still not mintable here — the bootstrap
    // hook remains the one source of admin accounts.
    for (const role of ["System Admin", "Administrator", "Customer Owner", "Wizard"]) {
      expect(() =>
        service.createStaffUser(
          { name: "Bad Role", email: "bad@example.test", role, branchAccess: "Daet", password: "owner-temp-8" },
          admin.id
        )
      ).toThrow("Only receiving and delivery staff can be added here");
    }
    expect(internals(service).customUsers.some((user) => user.name === "Bad Role")).toBe(false);

    await service.onModuleDestroy();
  });
});

describe("update path: assigning an owner role is a System Admin act", () => {
  test("admin promotion narrows branchAccess to the preset branch and revokes the old token", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const guard = guardFor(service);
    seedBranchData(service);

    const staff = service.createStaffUser(
      { name: "Promote Me", email: "promote@example.test", role: "Delivery Staff", branchAccess: "Daet / Naga", password: "staff-temp-1" },
      admin.id
    );
    service.changeOwnPassword(staff.id, { currentPassword: "staff-temp-1", newPassword: "staff-own-pass-1" });
    const before = service.login({ email: "promote@example.test", password: "staff-own-pass-1" });
    expect(guard.canActivate(contextFor(before.token, "/dashboard") as never)).toBe(true);
    const versionBefore = internals(service).customUsers.find((user) => user.id === staff.id)?.sessionVersion ?? 0;

    const promoted = service.updateStaffUser(staff.id, { role: "Naga Owner" }, admin.id);
    expect(promoted.role).toBe("Naga Owner");
    expect(promoted.branchAccess).toBe("Naga");
    const record = internals(service).customUsers.find((user) => user.id === staff.id);
    expect(record?.permissionPreset).toBe("Naga Owner");
    expect(record?.sessionVersion).toBe(versionBefore + 1);

    // The token issued under the staff role dies with the promotion;
    // a fresh sign-in lands in Naga-only scope.
    expect(guard.canActivate(contextFor(before.token, "/dashboard") as never)).toBe(false);
    const after = service.login({ email: "promote@example.test", password: "staff-own-pass-1" });
    expect(guard.canActivate(contextFor(after.token, "/dashboard") as never)).toBe(true);
    const visible = service.listPackages({}, { id: staff.id, role: "Naga Owner", branchAccess: "Naga" });
    expect(visible.map((pkg) => pkg.id)).toContain("pkg_pr5_naga");
    expect(visible.map((pkg) => pkg.id)).not.toContain("pkg_pr5_daet");

    await service.onModuleDestroy();
  });

  test("non-admin promotion attempts and cross-branch promotion grants are refused, record unchanged", async () => {
    const service = await bootService();
    const admin = seedAdmin(service);
    const ownerActor = seedUser(service, { id: "user_daet_owner", role: "Daet Owner", branchAccess: "Daet" });
    const staff = service.createStaffUser(
      { name: "Stay Staff", email: "stay@example.test", role: "Receiving Staff", branchAccess: "Daet", staffCode: "2211" },
      admin.id
    );

    expect(() => service.updateStaffUser(staff.id, { role: "Daet Owner" }, ownerActor.id)).toThrow(
      "Only a System Admin can assign branch owner roles"
    );
    expect(() => service.updateStaffUser(staff.id, { role: "Daet Owner" })).toThrow(
      "Only a System Admin can assign branch owner roles"
    );
    expect(() => service.updateStaffUser(staff.id, { role: "Daet Owner", branchAccess: "Naga" }, admin.id)).toThrow(
      "Daet Owner accounts are scoped to the Daet branch"
    );
    const record = internals(service).customUsers.find((user) => user.id === staff.id);
    expect(record?.role).toBe("Receiving Staff");
    expect(record?.branchAccess).toBe("Daet");

    // Staff-role edits behave exactly as before — no actor needed, the
    // role and preset move together.
    const moved = service.updateStaffUser(staff.id, { role: "Delivery Staff" });
    expect(moved.role).toBe("Delivery Staff");
    expect(internals(service).customUsers.find((user) => user.id === staff.id)?.permissionPreset).toBe("Delivery Staff");

    await service.onModuleDestroy();
  });
});
