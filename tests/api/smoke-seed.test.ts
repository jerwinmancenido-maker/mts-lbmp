import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { verifySecret } from "../../apps/api/src/modules/security";
import {
  resolveSmokeSeedConfig,
  upsertSmokeAccounts,
  SMOKE_SEED_DEFAULTS,
  type SmokeSeedConfig
} from "../../apps/api/src/modules/smoke-seed";
import type { StaffUserRecord } from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 5 P5-0: the smoke gates run on provisioned smoke accounts instead of
 * the demo users. The provisioning is a boot-time seed hook gated on
 * ALLOW_DEMO_AUTH=true + NODE_ENV!=production; these tests pin the gate, the
 * upsert semantics, and the guarantee that the seeded per-user passwordHash
 * never leaks into an API response.
 */

const config: SmokeSeedConfig = { ...SMOKE_SEED_DEFAULTS };

describe("resolveSmokeSeedConfig gating", () => {
  test("inert when ALLOW_DEMO_AUTH is absent or not exactly 'true'", () => {
    expect(resolveSmokeSeedConfig({})).toBeNull();
    expect(resolveSmokeSeedConfig({ ALLOW_DEMO_AUTH: "false" })).toBeNull();
    expect(resolveSmokeSeedConfig({ ALLOW_DEMO_AUTH: "1" })).toBeNull();
  });

  test("inert in production even with the flag on", () => {
    expect(resolveSmokeSeedConfig({ ALLOW_DEMO_AUTH: "true", NODE_ENV: "production" })).toBeNull();
  });

  test("returns the throwaway defaults when enabled outside production", () => {
    expect(resolveSmokeSeedConfig({ ALLOW_DEMO_AUTH: "true", NODE_ENV: "test" })).toEqual(SMOKE_SEED_DEFAULTS);
    expect(resolveSmokeSeedConfig({ ALLOW_DEMO_AUTH: "true" })).toEqual(SMOKE_SEED_DEFAULTS);
  });

  test("env credentials override the defaults per field", () => {
    const resolved = resolveSmokeSeedConfig({
      ALLOW_DEMO_AUTH: "true",
      SMOKE_EMAIL: "gate-admin@example.test",
      SMOKE_LIMITED_PASSWORD: "limited-secret"
    });
    expect(resolved?.email).toBe("gate-admin@example.test");
    expect(resolved?.password).toBe(SMOKE_SEED_DEFAULTS.password);
    expect(resolved?.limitedEmail).toBe(SMOKE_SEED_DEFAULTS.limitedEmail);
    expect(resolved?.limitedPassword).toBe("limited-secret");
  });
});

describe("upsertSmokeAccounts", () => {
  test("provisions both accounts as ordinary custom users with hashed passwords", () => {
    const { users, changed } = upsertSmokeAccounts([], config);
    expect(changed).toBe(true);
    expect(users).toHaveLength(2);

    const admin = users.find((user) => user.email === config.email);
    const delivery = users.find((user) => user.email === config.limitedEmail);
    expect(admin?.role).toBe("System Admin");
    expect(admin?.status).toBe("Active");
    expect(delivery?.role).toBe("Delivery Staff");
    expect(delivery?.status).toBe("Active");

    // No staff code: the smoke accounts are email+password accounts only.
    expect(admin?.staffCode).toBeUndefined();
    expect(delivery?.staffCode).toBeUndefined();

    // The stored credential is a real PBKDF2 hash of the configured password
    // (the field P5-1 will make login() verify against).
    expect(admin?.passwordHash).toBeTruthy();
    expect(verifySecret(config.password, admin!.passwordHash!)).toBe(true);
    expect(verifySecret("not-the-password", admin!.passwordHash!)).toBe(false);
    expect(delivery?.passwordHash).toBeTruthy();
    expect(verifySecret(config.limitedPassword, delivery!.passwordHash!)).toBe(true);
  });

  test("is idempotent: a second upsert changes nothing, hash included", () => {
    const first = upsertSmokeAccounts([], config);
    const second = upsertSmokeAccounts(first.users, config);
    expect(second.changed).toBe(false);
    expect(second.users).toEqual(first.users);
  });

  test("never touches unrelated users", () => {
    const other: StaffUserRecord = {
      id: "user_real_staff",
      name: "Real Staff",
      email: "real@mts.local",
      role: "Receiving Staff",
      staffCode: "4321",
      status: "Active"
    };
    const { users } = upsertSmokeAccounts([other], config);
    expect(users.find((user) => user.id === other.id)).toEqual(other);
  });

  test("repairs a tampered or disabled smoke account back to spec", () => {
    const first = upsertSmokeAccounts([], config);
    const tampered = first.users.map((user) =>
      user.email === config.email ? { ...user, role: "Customer Owner", status: "Inactive" as const } : user
    );
    const repaired = upsertSmokeAccounts(tampered, config);
    expect(repaired.changed).toBe(true);
    const admin = repaired.users.find((user) => user.email === config.email);
    expect(admin?.role).toBe("System Admin");
    expect(admin?.status).toBe("Active");
  });

  test("rotates the stored hash when the configured password changes", () => {
    const first = upsertSmokeAccounts([], config);
    const rotated = upsertSmokeAccounts(first.users, { ...config, password: "rotated-secret" });
    expect(rotated.changed).toBe(true);
    const admin = rotated.users.find((user) => user.email === config.email);
    expect(verifySecret("rotated-secret", admin!.passwordHash!)).toBe(true);
    expect(verifySecret(config.password, admin!.passwordHash!)).toBe(false);
  });
});

describe("LogisticsService smoke seeding", () => {
  const tempRoots: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ["INIT_CWD", "MTS_REPOSITORY", "ALLOW_DEMO_AUTH", "NODE_ENV", "SMOKE_EMAIL", "SMOKE_PASSWORD", "SMOKE_LIMITED_EMAIL", "SMOKE_LIMITED_PASSWORD"];

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

  /** Boots a service against a fresh throwaway state dir, so each test's
   *  seeded (or unseeded) state is independent of the others. */
  async function bootService(allowDemoAuth: boolean) {
    const dir = mkdtempSync(join(tmpdir(), "mts-smoke-seed-"));
    tempRoots.push(dir);
    process.env.INIT_CWD = dir;
    if (allowDemoAuth) process.env.ALLOW_DEMO_AUTH = "true";
    else delete process.env.ALLOW_DEMO_AUTH;
    const service = new LogisticsService();
    await service.onModuleInit();
    return service;
  }

  test("with ALLOW_DEMO_AUTH on, the smoke accounts sign in through the real login path", async () => {
    const service = await bootService(true);

    const adminLogin = service.login({ email: SMOKE_SEED_DEFAULTS.email, password: SMOKE_SEED_DEFAULTS.password });
    expect(adminLogin.token).toBeTruthy();
    expect(adminLogin.user.role).toBe("System Admin");
    expect(adminLogin.user.email).toBe(SMOKE_SEED_DEFAULTS.email);

    const deliveryLogin = service.login({
      email: SMOKE_SEED_DEFAULTS.limitedEmail,
      password: SMOKE_SEED_DEFAULTS.limitedPassword
    });
    expect(deliveryLogin.user.role).toBe("Delivery Staff");

    // Wrong passwords still fail. And since P5-2 the gate provisions ONLY
    // the smoke accounts: the old demo admin login is gone with the demo
    // accounts (in P5-1 it still worked here via the credential overlay).
    expect(() => service.login({ email: SMOKE_SEED_DEFAULTS.email, password: "wrong" })).toThrow();
    expect(() => service.login({ email: "admin@mts.local", password: "password" })).toThrow("Invalid email or password");

    await service.onModuleDestroy();
  });

  test("the seeded passwordHash never appears in login or bootstrap responses", async () => {
    const service = await bootService(true);

    const adminLogin = service.login({ email: SMOKE_SEED_DEFAULTS.email, password: SMOKE_SEED_DEFAULTS.password });
    expect(JSON.stringify(adminLogin)).not.toContain("passwordHash");
    expect(JSON.stringify(adminLogin)).not.toContain("pbkdf2:");

    const bootstrap = service.getBootstrap();
    const smokeEntries = bootstrap.users.filter((user) => user.email?.endsWith("@mts-smoke.test"));
    expect(smokeEntries).toHaveLength(2);
    for (const entry of bootstrap.users) {
      expect(entry).not.toHaveProperty("passwordHash");
    }
    expect(JSON.stringify(bootstrap)).not.toContain("pbkdf2:");

    await service.onModuleDestroy();
  });

  test("with ALLOW_DEMO_AUTH off, no smoke accounts exist", async () => {
    const service = await bootService(false);

    expect(() => service.login({ email: SMOKE_SEED_DEFAULTS.email, password: SMOKE_SEED_DEFAULTS.password })).toThrow();
    const bootstrap = service.getBootstrap();
    expect(bootstrap.users.some((user) => user.email?.endsWith("@mts-smoke.test"))).toBe(false);

    await service.onModuleDestroy();
  });
});
