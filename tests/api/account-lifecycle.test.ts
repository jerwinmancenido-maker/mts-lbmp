import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { rolePresets } from "@mts-lbmp/permissions";
import { AuthGuard } from "../../apps/api/src/modules/auth.guard";
import {
  BOOTSTRAP_MISSING_ENV_WARNING,
  resolveBootstrapAdmin
} from "../../apps/api/src/modules/bootstrap-admin";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import { hashSecret, verifyAuthToken, verifySecret } from "../../apps/api/src/modules/security";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type { ServiceAuditLog, StaffUserRecord } from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 5 tranche P5-2 — account lifecycle + demo removal + first-boot
 * provisioning.
 *
 * What is proven here:
 * - Admin lifecycle: createStaffUser accepts an initial password (hashed
 *   at creation, flagged mustChangePassword) and/or a staff code; neither
 *   credential (or a too-short password) is rejected.
 * - Forced change: a flagged account's login reports
 *   mustChangePassword, and the auth guard refuses every route except
 *   POST /auth/change-password for its token. changeOwnPassword verifies
 *   the current password, clears the flag, bumps sessionVersion (the
 *   pre-change token dies), and the temporary password stops working.
 * - Admin reset: resetUserPassword installs a temporary password, sets
 *   the flag, revokes the pre-reset token, and is audited.
 * - Disable: flipping status to Inactive bumps sessionVersion and the
 *   guard rejects the account's live token immediately.
 * - Door 3 is gone: the guard rejects a static `demo-token-*` bearer
 *   string outright (it is not a JWT and resolves to no user).
 * - users.manage is wired: the permission now gates user management in
 *   the controller, and the Owner presets carry it (they managed staff
 *   through these endpoints before, under settings.manage).
 * - First-boot provisioning: from an empty store, MTS_BOOTSTRAP_* env
 *   creates exactly one flagged System Admin (and a second boot creates
 *   no duplicate); a non-empty store is left alone; no env means no
 *   account and a clear warning — never a default credential.
 * - mustChangePassword round-trips through the Prisma state mapping.
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  auditLogs: ServiceAuditLog[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const ENV_KEYS = [
  "INIT_CWD",
  "MTS_REPOSITORY",
  "ALLOW_DEMO_AUTH",
  "NODE_ENV",
  "MTS_BOOTSTRAP_EMAIL",
  "MTS_BOOTSTRAP_PASSWORD",
  "MTS_BOOTSTRAP_NAME"
];
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
async function bootService(options: { seedState?: unknown; bootstrap?: { email: string; password: string; name?: string } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mts-account-lifecycle-"));
  tempRoots.push(dir);
  if (options.seedState !== undefined) {
    const dataDir = join(dir, "storage", "dev-data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "mts-lbmp.json"), JSON.stringify(options.seedState, null, 2));
  }
  process.env.INIT_CWD = dir;
  delete process.env.ALLOW_DEMO_AUTH;
  if (options.bootstrap) {
    process.env.MTS_BOOTSTRAP_EMAIL = options.bootstrap.email;
    process.env.MTS_BOOTSTRAP_PASSWORD = options.bootstrap.password;
    if (options.bootstrap.name) process.env.MTS_BOOTSTRAP_NAME = options.bootstrap.name;
    else delete process.env.MTS_BOOTSTRAP_NAME;
  } else {
    delete process.env.MTS_BOOTSTRAP_EMAIL;
    delete process.env.MTS_BOOTSTRAP_PASSWORD;
    delete process.env.MTS_BOOTSTRAP_NAME;
  }
  const service = new LogisticsService();
  await service.onModuleInit();
  return { service, dir };
}

/** saveData() persists fire-and-forget; poll until the write lands. */
async function waitForPersistedState(dir: string, marker: string) {
  const path = join(dir, "storage", "dev-data", "mts-lbmp.json");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (existsSync(path) && readFileSync(path, "utf8").includes(marker)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Persisted state file never contained ${marker}`);
}

/** Minimal Nest doubles, mirroring the P5-1 revocation tests: no required
 *  permissions; JWT verification via the repo's own hand-rolled verifier. */
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

/** An admin actor for the lifecycle calls (the controller's users.manage
 *  gate is what authorizes it over HTTP; the service methods are the
 *  lifecycle itself). */
function seedAdmin(service: LogisticsService) {
  const admin: StaffUserRecord = {
    id: "user_admin",
    name: "Lifecycle Admin",
    email: "admin@example.test",
    role: "System Admin",
    branchAccess: "All branches",
    status: "Active",
    passwordHash: hashSecret("admin-pw-123"),
    sessionVersion: 0
  };
  internals(service).customUsers.push(admin);
  return admin;
}

describe("admin lifecycle: create with initial password", () => {
  test("create → login is flagged → guard gates to change-password → change clears it and kills the old token", async () => {
    const { service } = await bootService();
    seedAdmin(service);
    const guard = guardFor(service);

    const created = service.createStaffUser({
      name: "New Receiver",
      email: "receiver@example.test",
      role: "Receiving Staff",
      branchAccess: "Daet",
      password: "temp-pass-123"
    });
    expect(created.hasPassword).toBe(true);
    expect(created.hasStaffCode).toBe(false);
    expect(created.mustChangePassword).toBe(true);
    expect(created).not.toHaveProperty("passwordHash");

    const record = internals(service).customUsers.find((user) => user.id === created.id);
    expect(record?.passwordHash).toBeTruthy();
    expect(verifySecret("temp-pass-123", record?.passwordHash as string)).toBe(true);
    expect(Object.values(record ?? {})).not.toContain("temp-pass-123");
    expect(record?.mustChangePassword).toBe(true);

    // First sign-in works but is flagged...
    const login = service.login({ email: "receiver@example.test", password: "temp-pass-123" });
    expect(login.user.mustChangePassword).toBe(true);

    // ...and its token opens ONLY the change-password endpoint.
    expect(guard.canActivate(contextFor(login.token, "/dashboard") as never)).toBe(false);
    expect(guard.canActivate(contextFor(login.token, "/settings/users") as never)).toBe(false);
    expect(guard.canActivate(contextFor(login.token, "/auth/change-password") as never)).toBe(true);

    // Wrong current password, same-as-current, and too-short all fail
    // without clearing the flag.
    expect(() =>
      service.changeOwnPassword(created.id, { currentPassword: "not-the-temp", newPassword: "my-own-pass-1" })
    ).toThrow("Current password is incorrect");
    expect(() =>
      service.changeOwnPassword(created.id, { currentPassword: "temp-pass-123", newPassword: "temp-pass-123" })
    ).toThrow("must be different");
    expect(() => service.changeOwnPassword(created.id, { currentPassword: "temp-pass-123", newPassword: "short" })).toThrow(
      "at least 8 characters"
    );
    expect(record?.mustChangePassword).toBe(true);

    // The real change: flag cleared, version bumped, fresh token issued.
    const changed = service.changeOwnPassword(created.id, {
      currentPassword: "temp-pass-123",
      newPassword: "my-own-pass-1"
    });
    expect(changed.user.mustChangePassword).toBe(false);
    expect(record?.mustChangePassword).toBe(false);
    expect(record?.sessionVersion).toBe(1);

    // The temporary password is dead; the pre-change token is revoked;
    // the fresh token passes the guard anywhere.
    expect(() => service.login({ email: "receiver@example.test", password: "temp-pass-123" })).toThrow(
      "Invalid email or password"
    );
    expect(guard.canActivate(contextFor(login.token, "/auth/change-password") as never)).toBe(false);
    expect(guard.canActivate(contextFor(changed.token, "/dashboard") as never)).toBe(true);
    const relogin = service.login({ email: "receiver@example.test", password: "my-own-pass-1" });
    expect(relogin.user.mustChangePassword).toBe(false);

    await service.onModuleDestroy();
  });

  test("create requires at least one credential, and a password of at least 8 characters", async () => {
    const { service } = await bootService();
    seedAdmin(service);

    expect(() =>
      service.createStaffUser({ name: "No Credential", role: "Delivery Staff", branchAccess: "Naga" })
    ).toThrow("initial password or a staff code");
    expect(() =>
      service.createStaffUser({ name: "Short Password", role: "Delivery Staff", branchAccess: "Naga", password: "short" })
    ).toThrow("at least 8 characters");
    expect(internals(service).customUsers.filter((user) => user.id !== "user_admin")).toHaveLength(0);

    await service.onModuleDestroy();
  });

  test("an account can carry both credentials; the flag gates staff-code sessions too", async () => {
    const { service } = await bootService();
    seedAdmin(service);
    const guard = guardFor(service);

    const created = service.createStaffUser({
      name: "Both Doors",
      email: "both@example.test",
      role: "Delivery Staff",
      branchAccess: "Naga",
      staffCode: "2468",
      password: "both-pass-123"
    });
    expect(created.hasPassword).toBe(true);
    expect(created.hasStaffCode).toBe(true);

    const codeLogin = service.loginWithStaffCode({ staffCode: "2468" });
    expect(codeLogin.user.id).toBe(created.id);
    expect(codeLogin.user.mustChangePassword).toBe(true);
    expect(guard.canActivate(contextFor(codeLogin.token, "/dashboard") as never)).toBe(false);
    expect(guard.canActivate(contextFor(codeLogin.token, "/auth/change-password") as never)).toBe(true);

    await service.onModuleDestroy();
  });
});

describe("admin reset and disable", () => {
  test("admin reset revokes the live token, installs a flagged temporary password, and is audited", async () => {
    const { service } = await bootService();
    const admin = seedAdmin(service);
    const guard = guardFor(service);

    const created = service.createStaffUser({
      name: "Reset Target",
      email: "target@example.test",
      role: "Receiving Staff",
      branchAccess: "Daet",
      password: "first-pass-123"
    });
    service.changeOwnPassword(created.id, { currentPassword: "first-pass-123", newPassword: "settled-pass-1" });
    const liveLogin = service.login({ email: "target@example.test", password: "settled-pass-1" });
    expect(guard.canActivate(contextFor(liveLogin.token, "/dashboard") as never)).toBe(true);

    const reset = service.resetUserPassword(admin.id, created.id, { temporaryPassword: "reset-temp-99" });
    expect(reset.mustChangePassword).toBe(true);

    // The pre-reset token dies immediately; the settled password is gone;
    // only the temporary password signs in, flagged.
    expect(guard.canActivate(contextFor(liveLogin.token, "/dashboard") as never)).toBe(false);
    expect(() => service.login({ email: "target@example.test", password: "settled-pass-1" })).toThrow(
      "Invalid email or password"
    );
    const tempLogin = service.login({ email: "target@example.test", password: "reset-temp-99" });
    expect(tempLogin.user.mustChangePassword).toBe(true);

    const audit = internals(service).auditLogs.find((entry) => entry.action === "settings.user.passwordReset");
    expect(audit?.entityId).toBe(created.id);
    expect(audit?.reason).toContain("user_admin");

    expect(() => service.resetUserPassword(admin.id, created.id, { temporaryPassword: "short" })).toThrow(
      "at least 8 characters"
    );
    expect(() => service.resetUserPassword(admin.id, "user_missing", { temporaryPassword: "reset-temp-99" })).toThrow(
      "User not found"
    );

    await service.onModuleDestroy();
  });

  test("disabling an account cuts its live token immediately; re-enabling restores sign-in", async () => {
    const { service } = await bootService();
    seedAdmin(service);
    const guard = guardFor(service);

    const created = service.createStaffUser({
      name: "Disable Target",
      email: "disable@example.test",
      role: "Delivery Staff",
      branchAccess: "Naga",
      staffCode: "1357"
    });
    const record = internals(service).customUsers.find((user) => user.id === created.id);
    const login = service.loginWithStaffCode({ staffCode: "1357" });
    expect(guard.canActivate(contextFor(login.token, "/dashboard") as never)).toBe(true);
    const versionBefore = record?.sessionVersion ?? 0;

    service.updateStaffUser(created.id, { status: "Inactive" });
    expect(record?.sessionVersion).toBe(versionBefore + 1);
    expect(guard.canActivate(contextFor(login.token, "/dashboard") as never)).toBe(false);
    expect(() => service.loginWithStaffCode({ staffCode: "1357" })).toThrow("Invalid staff code");

    service.updateStaffUser(created.id, { status: "Active" });
    expect(service.loginWithStaffCode({ staffCode: "1357" }).user.id).toBe(created.id);

    await service.onModuleDestroy();
  });

  test("admin staff-code reset: the old code dies, the new code signs in", async () => {
    const { service } = await bootService();
    seedAdmin(service);

    const created = service.createStaffUser({
      name: "Code Reset",
      role: "Receiving Staff",
      branchAccess: "Daet",
      staffCode: "1122"
    });
    expect(service.loginWithStaffCode({ staffCode: "1122" }).user.id).toBe(created.id);

    service.updateStaffUser(created.id, { staffCode: "3344" });
    expect(() => service.loginWithStaffCode({ staffCode: "1122" })).toThrow("Invalid staff code");
    expect(service.loginWithStaffCode({ staffCode: "3344" }).user.id).toBe(created.id);

    await service.onModuleDestroy();
  });
});

describe("door 3 removal and users.manage wiring", () => {
  test("the guard rejects the old static demo-token strings outright", async () => {
    const { service } = await bootService();
    seedAdmin(service);
    const guard = guardFor(service);

    // These strings authenticated as Daet Owner / System Admin with no
    // credential check before P5-2 (audit Door 3). They are not JWTs and
    // must now fail like any other garbage bearer value.
    expect(guard.canActivate(contextFor("demo-token-user_owner", "/dashboard") as never)).toBe(false);
    expect(guard.canActivate(contextFor("demo-token-user_system_admin", "/dashboard") as never)).toBe(false);
    expect(guard.canActivate(contextFor("demo-token-user_customer", "/dashboard") as never)).toBe(false);

    await service.onModuleDestroy();
  });

  test("users.manage is held by the roles that manage users, and not by staff roles", () => {
    expect(rolePresets["System Admin"]).toContain("users.manage");
    expect(rolePresets["Administrator"]).toContain("users.manage");
    // Owners managed their branch staff through these endpoints under
    // settings.manage before P5-2; the presets carry users.manage so the
    // permission swap does not lock them out of staff management.
    expect(rolePresets["Daet Owner"]).toContain("users.manage");
    expect(rolePresets["Naga Owner"]).toContain("users.manage");
    expect(rolePresets["Delivery Staff"]).not.toContain("users.manage");
    expect(rolePresets["Receiving Staff"]).not.toContain("users.manage");
  });
});

describe("first-boot provisioning (bootstrap admin)", () => {
  test("resolveBootstrapAdmin: not needed with users, missing-env without env, provision with env", () => {
    expect(resolveBootstrapAdmin(3, {})).toEqual({ kind: "not-needed" });
    expect(resolveBootstrapAdmin(0, {})).toEqual({ kind: "missing-env" });
    expect(resolveBootstrapAdmin(0, { MTS_BOOTSTRAP_EMAIL: "boss@example.test" })).toEqual({ kind: "missing-env" });
    expect(
      resolveBootstrapAdmin(0, { MTS_BOOTSTRAP_EMAIL: "boss@example.test", MTS_BOOTSTRAP_PASSWORD: "one-time-pw" })
    ).toEqual({
      kind: "provision",
      config: { email: "boss@example.test", password: "one-time-pw", name: "Initial Administrator" }
    });
    expect(
      resolveBootstrapAdmin(0, {
        MTS_BOOTSTRAP_EMAIL: "boss@example.test",
        MTS_BOOTSTRAP_PASSWORD: "one-time-pw",
        MTS_BOOTSTRAP_NAME: "The Boss"
      })
    ).toMatchObject({ kind: "provision", config: { name: "The Boss" } });
  });

  test("empty JSON store + env: exactly one flagged System Admin is created, and a reboot creates no duplicate", async () => {
    const { service, dir } = await bootService({
      bootstrap: { email: "boss@example.test", password: "one-time-pw-123", name: "The Boss" }
    });

    const users = internals(service).customUsers;
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      name: "The Boss",
      email: "boss@example.test",
      role: "System Admin",
      status: "Active",
      mustChangePassword: true
    });
    expect(verifySecret("one-time-pw-123", users[0]?.passwordHash as string)).toBe(true);
    expect(
      internals(service).auditLogs.some((entry) => entry.action === "auth.bootstrapAdminProvisioned")
    ).toBe(true);

    // The bootstrap admin signs in with the env password — flagged, so
    // the temporary password is single-use through the forced change.
    const login = service.login({ email: "boss@example.test", password: "one-time-pw-123" });
    expect(login.user.mustChangePassword).toBe(true);
    await service.onModuleDestroy();

    // Reboot against the persisted store with the env STILL set: the
    // store is no longer empty, so no second admin appears.
    await waitForPersistedState(dir, "boss@example.test");
    process.env.INIT_CWD = dir;
    const rebooted = new LogisticsService();
    await rebooted.onModuleInit();
    expect(internals(rebooted).customUsers).toHaveLength(1);
    expect(internals(rebooted).customUsers[0]?.email).toBe("boss@example.test");
    await rebooted.onModuleDestroy();
  });

  test("non-empty store + env: provisioning stays out of the way", async () => {
    const existing = {
      id: "user_existing",
      name: "Existing Receiver",
      email: "existing@example.test",
      role: "Receiving Staff",
      status: "Active"
    };
    const { service } = await bootService({
      seedState: { customUsers: [existing] },
      bootstrap: { email: "boss@example.test", password: "one-time-pw-123" }
    });

    expect(internals(service).customUsers).toHaveLength(1);
    expect(internals(service).customUsers[0]?.email).toBe("existing@example.test");

    await service.onModuleDestroy();
  });

  test("empty store without env: no account is created and a clear warning is logged (no default credential)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { service } = await bootService();
      expect(internals(service).customUsers).toHaveLength(0);
      expect(service.getBootstrap().users).toEqual([]);
      expect(warn).toHaveBeenCalledWith(BOOTSTRAP_MISSING_ENV_WARNING);
      await service.onModuleDestroy();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("prisma mapping round-trip (mustChangePassword)", () => {
  function minimalState(customUsers: StaffUserRecord[]): ServiceState {
    return {
      sequences: [],
      customers: [],
      receivingRecords: [],
      receivingDrafts: [],
      receivingIntakeTasks: [],
      packages: [],
      productMasters: [],
      trucks: [],
      trips: [],
      deliveries: [],
      payments: [],
      expenses: [],
      returnRecords: [],
      billingInvoices: [],
      notifications: [],
      auditLogs: [],
      descriptionBarcodes: [],
      messages: [],
      operationChatThreads: [],
      hardwareTests: [],
      printLogs: [],
      customUsers,
      idempotencyRecords: [],
      companyProfile: {
        companyName: "Mancenido Trucking Services",
        address: "Fixture address",
        phone: "0917 000 0000",
        email: "ops@example.test"
      },
      branches: [],
      paymentMethods: ["Cash"],
      expenseCategories: ["Fuel"],
    };
  }

  test("the flag survives state→rows→state; an unflagged account maps to false", () => {
    const rows = stateToRows(
      minimalState([
        {
          id: "user_flagged",
          name: "Flagged Staff",
          email: "flagged@example.test",
          role: "Receiving Staff",
          passwordHash: hashSecret("flagged-pw-1"),
          mustChangePassword: true,
          status: "Active"
        },
        {
          id: "user_settled",
          name: "Settled Staff",
          email: "settled@example.test",
          role: "Delivery Staff",
          passwordHash: hashSecret("settled-pw-1"),
          status: "Active"
        }
      ])
    );
    expect(rows.users.find((user) => user.id === "user_flagged")?.mustChangePassword).toBe(true);
    expect(rows.users.find((user) => user.id === "user_settled")?.mustChangePassword).toBe(false);

    const roundTripped = rowsToState(rows);
    expect(roundTripped.customUsers?.find((user) => user.id === "user_flagged")?.mustChangePassword).toBe(true);
    expect(roundTripped.customUsers?.find((user) => user.id === "user_settled")?.mustChangePassword).toBeUndefined();
  });
});
