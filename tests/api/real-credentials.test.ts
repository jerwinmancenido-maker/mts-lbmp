import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AuthGuard } from "../../apps/api/src/modules/auth.guard";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import { hashSecret, verifyAuthToken, verifySecret } from "../../apps/api/src/modules/security";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type { ServiceAuditLog, StaffUserRecord } from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 5 tranche P5-1 — real per-user credentials + login hardening.
 *
 * What is proven here:
 * - login() verifies against the account's OWN passwordHash: the right
 *   password passes, a wrong one fails, and ANOTHER account's password
 *   fails (there is no shared password anymore — the demoPasswordHash
 *   constant is deleted).
 * - loginWithStaffCode() verifies against the account's staffCodeHash;
 *   codes are stored only as PBKDF2 hashes (createStaffUser hashes on
 *   set, and the persisted state file never contains the plaintext).
 * - Fail closed: an account with no credential set cannot sign in
 *   through that door. (Updated in P5-2: the six demo accounts are
 *   deleted outright — their old emails/codes are unknown accounts now,
 *   and the ALLOW_DEMO_AUTH gate provisions only the two smoke accounts;
 *   the P5-1 in-memory demo credential overlay is gone.)
 * - Lockout: 10 consecutive failures (shared across both doors) lock the
 *   account for 15 minutes; a successful sign-in resets the counter;
 *   failures and lockouts are audited.
 * - Revocation: tokens carry the sessionVersion (`sv` claim); a staff
 *   code change bumps it and the auth guard rejects pre-change tokens.
 * - Mapping: passwordHash / staffCodeHash / sessionVersion / branchId /
 *   permissionPreset / canApprove / lockout state round-trip through
 *   stateToRows/rowsToState (the Phase 2 §4.1 regression class).
 * - Migration: a state file persisted before P5-1 with a plaintext
 *   staffCode is hashed on load, the plaintext is dropped, and the
 *   migrated state is what gets persisted back.
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  auditLogs: ServiceAuditLog[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const ENV_KEYS = ["INIT_CWD", "MTS_REPOSITORY", "ALLOW_DEMO_AUTH", "NODE_ENV", "SMOKE_EMAIL", "SMOKE_PASSWORD", "SMOKE_LIMITED_EMAIL", "SMOKE_LIMITED_PASSWORD"];
const savedEnv: Record<string, string | undefined> = {};
const tempRoots: string[] = [];

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.MTS_REPOSITORY;
  delete process.env.SMOKE_EMAIL;
  delete process.env.SMOKE_PASSWORD;
  delete process.env.SMOKE_LIMITED_EMAIL;
  delete process.env.SMOKE_LIMITED_PASSWORD;
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
async function bootService(options: { allowDemoAuth?: boolean; seedState?: unknown } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mts-real-credentials-"));
  tempRoots.push(dir);
  if (options.seedState !== undefined) {
    const dataDir = join(dir, "storage", "dev-data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "mts-lbmp.json"), JSON.stringify(options.seedState, null, 2));
  }
  process.env.INIT_CWD = dir;
  if (options.allowDemoAuth) process.env.ALLOW_DEMO_AUTH = "true";
  else delete process.env.ALLOW_DEMO_AUTH;
  const service = new LogisticsService();
  await service.onModuleInit();
  return { service, dir };
}

function addUser(service: LogisticsService, user: StaffUserRecord) {
  internals(service).customUsers.push(user);
  return user;
}

/** saveData() persists fire-and-forget; poll until the write lands. */
async function readPersistedState(dir: string, marker: string) {
  const path = join(dir, "storage", "dev-data", "mts-lbmp.json");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8");
      if (raw.includes(marker)) return raw;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Persisted state file never contained ${marker}`);
}

describe("per-user password verification", () => {
  test("the right password passes; a wrong one and another user's password fail", async () => {
    const { service } = await bootService();
    addUser(service, {
      id: "user_alice",
      name: "Alice Receiver",
      email: "alice@mts.local",
      role: "Receiving Staff",
      branchAccess: "Daet",
      status: "Active",
      passwordHash: hashSecret("alice-pw-123")
    });
    addUser(service, {
      id: "user_bob",
      name: "Bob Delivery",
      email: "bob@mts.local",
      role: "Delivery Staff",
      branchAccess: "Naga",
      status: "Active",
      passwordHash: hashSecret("bob-pw-456")
    });

    const aliceLogin = service.login({ email: "alice@mts.local", password: "alice-pw-123" });
    expect(aliceLogin.user.id).toBe("user_alice");
    expect(aliceLogin.token).toBeTruthy();
    expect(service.login({ email: "bob@mts.local", password: "bob-pw-456" }).user.id).toBe("user_bob");

    expect(() => service.login({ email: "alice@mts.local", password: "wrong" })).toThrow("Invalid email or password");
    // The pre-P5-1 hole: any account's password (here Bob's) opened every
    // account, because verification ran against one shared hash.
    expect(() => service.login({ email: "alice@mts.local", password: "bob-pw-456" })).toThrow("Invalid email or password");
    expect(() => service.login({ email: "bob@mts.local", password: "alice-pw-123" })).toThrow("Invalid email or password");
    // The old shared demo password itself is gone.
    expect(() => service.login({ email: "alice@mts.local", password: "password" })).toThrow("Invalid email or password");

    await service.onModuleDestroy();
  });

  test("responses never expose credential or throttle state", async () => {
    const { service } = await bootService();
    addUser(service, {
      id: "user_alice",
      name: "Alice Receiver",
      email: "alice@mts.local",
      role: "Receiving Staff",
      status: "Active",
      passwordHash: hashSecret("alice-pw-123"),
      staffCodeHash: hashSecret("1357")
    });

    const login = service.login({ email: "alice@mts.local", password: "alice-pw-123" });
    const serialized = JSON.stringify(login);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("staffCodeHash");
    expect(serialized).not.toContain("pbkdf2:");
    expect(login.user.hasStaffCode).toBe(true);

    const bootstrap = service.getBootstrap();
    expect(JSON.stringify(bootstrap)).not.toContain("pbkdf2:");
    for (const entry of bootstrap.users) {
      expect(entry).not.toHaveProperty("passwordHash");
      expect(entry).not.toHaveProperty("staffCodeHash");
      expect(entry).not.toHaveProperty("failedLoginAttempts");
      expect(entry).not.toHaveProperty("loginLockedUntil");
    }

    await service.onModuleDestroy();
  });
});

describe("fail-closed credentials", () => {
  test("an account with no password hash cannot sign in with any password", async () => {
    const { service } = await bootService();
    addUser(service, {
      id: "user_carol",
      name: "Carol No Credential",
      email: "carol@mts.local",
      role: "Receiving Staff",
      status: "Active"
    });

    expect(() => service.login({ email: "carol@mts.local", password: "password" })).toThrow("Invalid email or password");
    expect(() => service.login({ email: "carol@mts.local", password: "anything-at-all" })).toThrow("Invalid email or password");

    await service.onModuleDestroy();
  });

  test("an account with no staff code hash cannot sign in through the code door", async () => {
    const { service } = await bootService();
    addUser(service, {
      id: "user_carol",
      name: "Carol No Credential",
      email: "carol@mts.local",
      role: "Receiving Staff",
      status: "Active",
      passwordHash: hashSecret("carol-pw")
    });

    expect(() => service.loginWithStaffCode({ staffCode: "0000" })).toThrow("Invalid staff code");
    expect(() => service.loginWithStaffCode({ staffCode: "" })).toThrow("Invalid staff code");

    await service.onModuleDestroy();
  });

  test("the removed demo accounts are simply unknown accounts on a fresh boot (P5-2)", async () => {
    const { service } = await bootService();

    // P5-1 made the demo records credential-less (fail closed); P5-2
    // deletes the records outright. The audit's §3.3 blockers #1 and
    // #2/#4 — the shared password "password" and the printed staff
    // codes — now fail because no such accounts exist at all, and a
    // fresh boot without provisioning has an empty user directory.
    expect(() => service.login({ email: "admin@mts.local", password: "password" })).toThrow("Invalid email or password");
    expect(() => service.login({ email: "daet.owner@mts.local", password: "password" })).toThrow("Invalid email or password");
    expect(() => service.loginWithStaffCode({ staffCode: "0001" })).toThrow("Invalid staff code");
    expect(() => service.loginWithStaffCode({ staffCode: "0000" })).toThrow("Invalid staff code");
    expect(service.getBootstrap().users).toEqual([]);

    await service.onModuleDestroy();
  });

  test("with ALLOW_DEMO_AUTH on, only the two smoke accounts exist — the demo doors stay shut (P5-2)", async () => {
    const { service } = await bootService({ allowDemoAuth: true });

    // The gate provisions the smoke accounts (P5-0) — and nothing else.
    // The P5-1 demo credential overlay is deleted with the demo accounts.
    expect(service.login({ email: "smoke.admin@mts-smoke.test", password: "password" }).user.role).toBe("System Admin");
    expect(service.getBootstrap().users.map((user) => user.email).sort()).toEqual([
      "smoke.admin@mts-smoke.test",
      "smoke.delivery@mts-smoke.test"
    ]);
    expect(() => service.login({ email: "admin@mts.local", password: "password" })).toThrow("Invalid email or password");
    expect(() => service.loginWithStaffCode({ staffCode: "0001" })).toThrow("Invalid staff code");
    expect(() => service.loginWithStaffCode({ staffCode: "5555" })).toThrow("Invalid staff code");

    await service.onModuleDestroy();
  });
});

describe("staff-code door (hashed)", () => {
  test("each account's code opens only that account", async () => {
    const { service } = await bootService();
    addUser(service, {
      id: "user_dave",
      name: "Dave Delivery",
      email: "dave@mts.local",
      role: "Delivery Staff",
      status: "Active",
      staffCodeHash: hashSecret("4321")
    });
    addUser(service, {
      id: "user_erin",
      name: "Erin Receiving",
      email: "erin@mts.local",
      role: "Receiving Staff",
      status: "Active",
      staffCodeHash: hashSecret("8765")
    });

    expect(service.loginWithStaffCode({ staffCode: "4321" }).user.id).toBe("user_dave");
    expect(service.loginWithStaffCode({ staffCode: "8765" }).user.id).toBe("user_erin");
    expect(() => service.loginWithStaffCode({ staffCode: "4322" })).toThrow("Invalid staff code");
    expect(() => service.loginWithStaffCode({ staffCode: "0000" })).toThrow("Invalid staff code");

    await service.onModuleDestroy();
  });

  test("createStaffUser stores only a hash and the code signs in", async () => {
    const { service, dir } = await bootService();

    const created = service.createStaffUser({
      name: "New Receiver",
      role: "Receiving Staff",
      branchAccess: "Daet",
      staffCode: "5555"
    });
    expect(created.hasStaffCode).toBe(true);
    expect(created).not.toHaveProperty("staffCode");
    expect(created).not.toHaveProperty("staffCodeHash");

    const record = internals(service).customUsers.find((user) => user.id === created.id);
    expect(record?.staffCodeHash).toBeTruthy();
    expect(verifySecret("5555", record?.staffCodeHash as string)).toBe(true);
    // No field of the stored record holds the plaintext code.
    expect(record).not.toHaveProperty("staffCode");
    expect(Object.values(record ?? {})).not.toContain("5555");

    // Uniqueness is enforced against the hashes (a plaintext compare is
    // impossible), and the persisted state file holds no plaintext code.
    expect(() =>
      service.createStaffUser({ name: "Copy Cat", role: "Delivery Staff", branchAccess: "Naga", staffCode: "5555" })
    ).toThrow("Staff code is already used");
    const persisted = await readPersistedState(dir, created.id);
    expect(persisted).not.toContain('"staffCode":');
    expect(persisted).toContain('"staffCodeHash":');

    expect(service.loginWithStaffCode({ staffCode: "5555" }).user.id).toBe(created.id);

    await service.onModuleDestroy();
  });
});

describe("per-account lockout (shared across both doors)", () => {
  test("the 10th consecutive failure locks the account; the lock covers both doors; expiry restores sign-in", async () => {
    const { service } = await bootService();
    const frank = addUser(service, {
      id: "user_frank",
      name: "Frank Locked",
      email: "frank@mts.local",
      role: "Delivery Staff",
      status: "Active",
      passwordHash: hashSecret("frank-pw"),
      staffCodeHash: hashSecret("1212")
    });

    for (let attempt = 1; attempt <= 9; attempt++) {
      expect(() => service.login({ email: "frank@mts.local", password: "wrong" })).toThrow("Invalid email or password");
    }
    expect(frank.failedLoginAttempts).toBe(9);
    expect(frank.loginLockedUntil).toBeUndefined();

    // Failure #10 trips the lock.
    expect(() => service.login({ email: "frank@mts.local", password: "wrong" })).toThrow("Invalid email or password");
    expect(frank.failedLoginAttempts).toBe(10);
    expect(frank.loginLockedUntil).toBeTruthy();
    expect(new Date(frank.loginLockedUntil as string).getTime()).toBeGreaterThan(Date.now());

    // While locked, even the CORRECT credentials are refused — on both
    // doors, because the counter and lock are shared per account.
    expect(() => service.login({ email: "frank@mts.local", password: "frank-pw" })).toThrow(/locked/);
    expect(() => service.loginWithStaffCode({ staffCode: "1212" })).toThrow(/locked/);

    // Failures and the lockout itself are in the audit log (before P5-1
    // only successful logins were audited).
    const actions = internals(service).auditLogs.filter((entry) => entry.entityId === "user_frank").map((entry) => entry.action);
    expect(actions.filter((action) => action === "auth.loginFailed")).toHaveLength(9);
    expect(actions).toContain("auth.loginLocked");

    // After the lock expires, the correct password works and the
    // throttle state is cleared.
    frank.loginLockedUntil = new Date(Date.now() - 1000).toISOString();
    expect(service.login({ email: "frank@mts.local", password: "frank-pw" }).user.id).toBe("user_frank");
    expect(frank.failedLoginAttempts).toBe(0);
    expect(frank.loginLockedUntil).toBeUndefined();

    await service.onModuleDestroy();
  });

  test("a successful sign-in resets the failure counter before the threshold", async () => {
    const { service } = await bootService();
    const grace = addUser(service, {
      id: "user_grace",
      name: "Grace Reset",
      email: "grace@mts.local",
      role: "Receiving Staff",
      status: "Active",
      passwordHash: hashSecret("grace-pw")
    });

    for (let attempt = 0; attempt < 4; attempt++) {
      expect(() => service.login({ email: "grace@mts.local", password: "wrong" })).toThrow("Invalid email or password");
    }
    expect(grace.failedLoginAttempts).toBe(4);

    expect(service.login({ email: "grace@mts.local", password: "grace-pw" }).user.id).toBe("user_grace");
    expect(grace.failedLoginAttempts).toBe(0);

    // Nine more failures must NOT lock: the counter restarted at zero.
    for (let attempt = 0; attempt < 9; attempt++) {
      expect(() => service.login({ email: "grace@mts.local", password: "wrong" })).toThrow("Invalid email or password");
    }
    expect(grace.failedLoginAttempts).toBe(9);
    expect(grace.loginLockedUntil).toBeUndefined();
    expect(service.login({ email: "grace@mts.local", password: "grace-pw" }).user.id).toBe("user_grace");

    await service.onModuleDestroy();
  });
});

describe("sessionVersion revocation", () => {
  /** Minimal Nest doubles: no required permissions, JWT verify via the
   *  repo's own hand-rolled verifier (the guard's fallback path). */
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

  function contextFor(token: string) {
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: { authorization: `Bearer ${token}` }
    };
    return {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request })
    };
  }

  test("a credential change bumps sessionVersion and the guard rejects tokens issued before it", async () => {
    const { service } = await bootService();
    const heidi = addUser(service, {
      id: "user_heidi",
      name: "Heidi Revoked",
      email: "heidi@mts.local",
      role: "Delivery Staff",
      status: "Active",
      passwordHash: hashSecret("heidi-pw"),
      staffCodeHash: hashSecret("3434"),
      sessionVersion: 0
    });
    const guard = guardFor(service);

    const firstLogin = service.login({ email: "heidi@mts.local", password: "heidi-pw" });
    expect(verifyAuthToken(firstLogin.token)?.sv).toBe(0);
    expect(guard.canActivate(contextFor(firstLogin.token) as never)).toBe(true);

    // Admin changes Heidi's staff code: new hash stored, version bumped.
    service.updateStaffUser("user_heidi", { staffCode: "9090" });
    expect(heidi.sessionVersion).toBe(1);
    expect(verifySecret("9090", heidi.staffCodeHash as string)).toBe(true);
    expect(verifySecret("3434", heidi.staffCodeHash as string)).toBe(false);

    // The pre-change token is revoked even though it has not expired;
    // the old code is dead and the new one signs in.
    expect(guard.canActivate(contextFor(firstLogin.token) as never)).toBe(false);
    expect(() => service.loginWithStaffCode({ staffCode: "3434" })).toThrow("Invalid staff code");
    const secondLogin = service.loginWithStaffCode({ staffCode: "9090" });
    expect(secondLogin.user.id).toBe("user_heidi");
    expect(verifyAuthToken(secondLogin.token)?.sv).toBe(1);
    expect(guard.canActivate(contextFor(secondLogin.token) as never)).toBe(true);

    // Re-submitting the SAME code is not a credential change: no bump.
    service.updateStaffUser("user_heidi", { staffCode: "9090" });
    expect(heidi.sessionVersion).toBe(1);
    expect(guard.canActivate(contextFor(secondLogin.token) as never)).toBe(true);

    await service.onModuleDestroy();
  });
});

describe("prisma mapping round-trip (Phase 2 §4.1 fields)", () => {
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

  test("credentials, session version, §4.1 fields and lockout state all survive state→rows→state", () => {
    const passwordHash = hashSecret("round-trip-pw");
    const staffCodeHash = hashSecret("6543");
    const lockedUntil = "2026-11-12T03:30:00.000Z";
    const state = minimalState([
      {
        id: "user_roundtrip",
        name: "Round Trip Staff",
        email: "roundtrip@mts.local",
        phone: "0917 111 2222",
        role: "Delivery Staff",
        passwordHash,
        staffCodeHash,
        sessionVersion: 3,
        failedLoginAttempts: 4,
        loginLockedUntil: lockedUntil,
        branchId: "branch_daet",
        branchAccess: "Daet",
        permissionPreset: "Delivery Staff",
        canApprove: ["Daet expenses", "Mixed trips"],
        status: "Active",
        createdAt: "2026-11-11T00:00:00.000Z"
      }
    ]);

    const rows = stateToRows(state);
    expect(rows.users).toHaveLength(1);
    expect(rows.users[0]).toMatchObject({
      passwordHash,
      staffCodeHash,
      sessionVersion: 3,
      failedLoginAttempts: 4,
      branchId: "branch_daet",
      permissionPreset: "Delivery Staff",
      canApprove: ["Daet expenses", "Mixed trips"]
    });
    expect(rows.users[0]?.loginLockedUntil).toEqual(new Date(lockedUntil));

    const roundTripped = rowsToState(rows);
    expect(roundTripped.customUsers?.[0]).toMatchObject({
      id: "user_roundtrip",
      passwordHash,
      staffCodeHash,
      sessionVersion: 3,
      failedLoginAttempts: 4,
      loginLockedUntil: lockedUntil,
      branchId: "branch_daet",
      branchAccess: "Daet",
      permissionPreset: "Delivery Staff",
      canApprove: ["Daet expenses", "Mixed trips"]
    });
  });

  test("an account with no credentials maps to NULL columns (fail closed), never a placeholder", () => {
    const rows = stateToRows(
      minimalState([
        {
          id: "user_plain",
          name: "Plain Staff",
          email: "plain@mts.local",
          role: "Receiving Staff",
          status: "Active"
        }
      ])
    );
    expect(rows.users[0]?.passwordHash).toBeNull();
    expect(rows.users[0]?.staffCodeHash).toBeNull();
    expect(rows.users[0]?.sessionVersion).toBe(0);

    const roundTripped = rowsToState(rows);
    expect(roundTripped.customUsers?.[0]?.passwordHash).toBeUndefined();
    expect(roundTripped.customUsers?.[0]?.staffCodeHash).toBeUndefined();
  });
});

describe("plaintext staffCode migration on load", () => {
  test("a pre-P5-1 state record is hashed on load, the plaintext dropped, and the code still signs in", async () => {
    const legacyUser = {
      id: "user_legacy",
      name: "Legacy Receiver",
      email: "legacy@mts.local",
      role: "Receiving Staff",
      branchAccess: "Daet",
      status: "Active",
      // The pre-P5-1 storage shape: plaintext code, no hash.
      staffCode: "7777",
      createdAt: "2026-11-01T00:00:00.000Z"
    };
    const { service, dir } = await bootService({ seedState: { customUsers: [legacyUser] } });

    const record = internals(service).customUsers.find((user) => user.id === "user_legacy");
    expect(record).toBeTruthy();
    expect(record).not.toHaveProperty("staffCode");
    expect(record?.staffCodeHash).toBeTruthy();
    expect(verifySecret("7777", record?.staffCodeHash as string)).toBe(true);

    // The migrated credential works through the real door...
    expect(service.loginWithStaffCode({ staffCode: "7777" }).user.id).toBe("user_legacy");

    // ...and the state persisted back to disk carries the hash, not the
    // plaintext field.
    const persisted = await readPersistedState(dir, "user_legacy");
    expect(persisted).not.toContain('"staffCode":');
    expect(persisted).toContain('"staffCodeHash":');

    await service.onModuleDestroy();
  });
});
