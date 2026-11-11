import { hashSecret, verifySecret } from "./security.js";
import type { StaffUserRecord } from "./logistics.types.js";

/**
 * Phase 5 tranche P5-0 — test-only smoke account seeding.
 *
 * The smoke gates (tools/smoke-test.mjs, tools/permission-smoke-test.mjs) used
 * to log in as the hard-coded demo accounts. So the gates could survive the
 * demo accounts' removal (P5-2), they use dedicated smoke accounts that
 * this hook provisions into the ordinary custom-user store at API boot.
 *
 * This is a seed hook, NOT a backdoor:
 * - It runs only when ALLOW_DEMO_AUTH is explicitly "true" AND NODE_ENV is
 *   not "production". Either condition failing means it does nothing at all.
 * - It only ever upserts the two fixed smoke accounts below, with the roles
 *   hard-coded here — it cannot create arbitrary users or grant arbitrary
 *   roles, and it accepts no input over HTTP.
 * - The seeded accounts are ordinary custom users: they sign in through the
 *   real POST /auth/login path and are authorized by the same role presets
 *   as any other account. Nothing about login or the guard changes.
 *
 * Credentials come from env (SMOKE_EMAIL / SMOKE_PASSWORD for the admin-level
 * account, SMOKE_LIMITED_EMAIL / SMOKE_LIMITED_PASSWORD for the limited
 * delivery account). The defaults below exist so a fresh clone passes the
 * gates with zero setup; they are throwaway credentials for throwaway
 * accounts in throwaway state, on the non-routable .test TLD.
 *
 * NOTE on the default password: since P5-1, login() verifies against each
 * account's own PBKDF2 `passwordHash`, so the env passwords configured here
 * ARE the seeded accounts' real per-account passwords (hashed via
 * hashSecret, the repo's own hasher) — no shared demo hash remains.
 *
 * Keep the defaults in sync with tools/smoke-credentials.mjs.
 */
export interface SmokeSeedConfig {
  email: string;
  password: string;
  limitedEmail: string;
  limitedPassword: string;
}

export const SMOKE_SEED_DEFAULTS: SmokeSeedConfig = {
  email: "smoke.admin@mts-smoke.test",
  password: "password",
  limitedEmail: "smoke.delivery@mts-smoke.test",
  limitedPassword: "password"
};

const SMOKE_ADMIN_ID = "user_smoke_admin";
const SMOKE_DELIVERY_ID = "user_smoke_delivery";

// Phase 5 P5-2 removed the demo accounts entirely, and with them the
// P5-1 in-memory demo credential overlay that used to live here
// (DEMO_ACCOUNT_CREDENTIALS / buildDemoCredentialOverlay). ALLOW_DEMO_AUTH
// now gates ONLY the two smoke accounts below — nothing else signs in
// "as a demo" anymore. First-run provisioning of a real deployment is
// the separate, production-safe bootstrap hook in bootstrap-admin.ts.

/**
 * Returns the seed config when smoke seeding is explicitly enabled for a
 * non-production run, or null when the hook must stay inert.
 */
export function resolveSmokeSeedConfig(env: NodeJS.ProcessEnv = process.env): SmokeSeedConfig | null {
  if (env.ALLOW_DEMO_AUTH !== "true") return null;
  if (env.NODE_ENV === "production") return null;
  return {
    email: env.SMOKE_EMAIL?.trim() || SMOKE_SEED_DEFAULTS.email,
    password: env.SMOKE_PASSWORD || SMOKE_SEED_DEFAULTS.password,
    limitedEmail: env.SMOKE_LIMITED_EMAIL?.trim() || SMOKE_SEED_DEFAULTS.limitedEmail,
    limitedPassword: env.SMOKE_LIMITED_PASSWORD || SMOKE_SEED_DEFAULTS.limitedPassword
  };
}

function smokeAccountSpecs(config: SmokeSeedConfig) {
  return [
    {
      id: SMOKE_ADMIN_ID,
      name: "Smoke Admin (test only)",
      email: config.email,
      password: config.password,
      role: "System Admin",
      branchAccess: "All branches",
      permissionPreset: "System Admin",
      canApprove: ["System configuration", "All branch support"]
    },
    {
      id: SMOKE_DELIVERY_ID,
      name: "Smoke Delivery (test only)",
      email: config.limitedEmail,
      password: config.limitedPassword,
      role: "Delivery Staff",
      branchAccess: "Daet / Naga",
      permissionPreset: "Delivery Staff",
      canApprove: [] as string[]
    }
  ];
}

function passwordHashFor(existing: StaffUserRecord | undefined, password: string) {
  // Keep the stored hash when it already verifies for the configured
  // password, so repeated boots do not churn the state file/database.
  if (existing?.passwordHash && verifySecret(password, existing.passwordHash)) {
    return existing.passwordHash;
  }
  return hashSecret(password);
}

/**
 * Upserts the two smoke accounts into the custom-user list. Pure: returns the
 * next list plus whether anything changed. Matching is by deterministic smoke
 * id first, then by email, so re-seeding after an env email change updates
 * the same records instead of duplicating them. Non-smoke users are never
 * touched. Accounts previously disabled are re-activated — these are test
 * fixtures, and a stale Inactive flag must not silently break the gates.
 */
export function upsertSmokeAccounts(
  customUsers: StaffUserRecord[],
  config: SmokeSeedConfig
): { users: StaffUserRecord[]; changed: boolean } {
  const users = [...customUsers];
  let changed = false;

  for (const spec of smokeAccountSpecs(config)) {
    const index = users.findIndex((user) => user.id === spec.id || user.email === spec.email);
    const existing = index >= 0 ? users[index] : undefined;
    const record: StaffUserRecord = {
      id: spec.id,
      name: spec.name,
      email: spec.email,
      role: spec.role,
      branchAccess: spec.branchAccess,
      permissionPreset: spec.permissionPreset,
      canApprove: spec.canApprove,
      status: "Active",
      passwordHash: passwordHashFor(existing, spec.password),
      createdAt: existing?.createdAt ?? new Date().toISOString()
    };
    if (!existing) {
      users.push(record);
      changed = true;
    } else if (JSON.stringify({ ...existing, passwordHash: undefined }) !== JSON.stringify({ ...record, passwordHash: undefined }) || existing.passwordHash !== record.passwordHash) {
      users[index] = record;
      changed = true;
    }
  }

  return { users, changed };
}
