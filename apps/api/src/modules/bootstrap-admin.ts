import { hashSecret } from "./security.js";
import type { StaffUserRecord } from "./logistics.types.js";

/**
 * Phase 5 tranche P5-2 — first-boot provisioning of the initial admin.
 *
 * P5-2 deletes the six hard-coded demo accounts, so a fresh deployment
 * starts with ZERO users and no way to sign in. This hook closes that
 * gap without reintroducing a default credential:
 *
 * - It runs once at API boot, only when the user collection is empty.
 * - It creates exactly ONE System Admin account from operator-supplied
 *   environment values:
 *     MTS_BOOTSTRAP_EMAIL    (required) sign-in email for the admin
 *     MTS_BOOTSTRAP_PASSWORD (required) one-time temporary password
 *     MTS_BOOTSTRAP_NAME     (optional) display name
 * - The password is stored only as a PBKDF2 hash (hashSecret) and the
 *   account is created with mustChangePassword set, so the temporary
 *   password works exactly once: the first sign-in is gated to the
 *   change-password endpoint until the admin replaces it.
 * - If the env values are absent, NOTHING is created and the caller logs
 *   a clear warning. There is no fallback/default credential anywhere —
 *   an API with zero users simply has no sign-in until an operator
 *   provisions one (this hook) or restores real data.
 *
 * This is deliberately separate from the ALLOW_DEMO_AUTH smoke seeding
 * (smoke-seed.ts): that hook is test-only and refused in production;
 * this one is the production first-run path and is honoured in every
 * environment, including production — it is safe there precisely
 * because the credential comes from the operator's own environment and
 * is single-use.
 */
export interface BootstrapAdminConfig {
  email: string;
  password: string;
  name: string;
}

export type BootstrapAdminResolution =
  | { kind: "not-needed" }
  | { kind: "missing-env" }
  | { kind: "provision"; config: BootstrapAdminConfig };

/**
 * Decides what first-boot provisioning should do. Pure: the caller owns
 * applying the outcome (creating the record, logging the warning).
 */
export function resolveBootstrapAdmin(
  userCount: number,
  env: NodeJS.ProcessEnv = process.env
): BootstrapAdminResolution {
  if (userCount > 0) return { kind: "not-needed" };
  const email = env.MTS_BOOTSTRAP_EMAIL?.trim();
  const password = env.MTS_BOOTSTRAP_PASSWORD;
  if (!email || !password) return { kind: "missing-env" };
  return {
    kind: "provision",
    config: {
      email,
      password,
      name: env.MTS_BOOTSTRAP_NAME?.trim() || "Initial Administrator"
    }
  };
}

/** Builds the initial admin record for a resolved bootstrap config. */
export function buildBootstrapAdminRecord(config: BootstrapAdminConfig, id: string): StaffUserRecord {
  return {
    id,
    name: config.name,
    email: config.email,
    role: "System Admin",
    branchAccess: "All branches",
    permissionPreset: "System Admin",
    canApprove: ["System configuration", "All branch support"],
    passwordHash: hashSecret(config.password),
    mustChangePassword: true,
    sessionVersion: 0,
    status: "Active",
    createdAt: new Date().toISOString()
  };
}

export const BOOTSTRAP_MISSING_ENV_WARNING =
  "[bootstrap] No user accounts exist and MTS_BOOTSTRAP_EMAIL / MTS_BOOTSTRAP_PASSWORD are not set, " +
  "so no initial admin was provisioned. Nobody can sign in. Set both variables and restart the API " +
  "to create the first admin account (its password must be changed at first sign-in).";
