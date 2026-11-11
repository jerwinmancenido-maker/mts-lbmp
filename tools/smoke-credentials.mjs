/**
 * Smoke-gate credentials (Phase 5 tranche P5-0).
 *
 * The smoke scripts no longer log in as the hard-coded demo accounts. They
 * use two dedicated smoke accounts that the API provisions for test runs:
 *
 *   - Admin-level account  — runs the full business journey (smoke-test.mjs)
 *                            and the positive permission checks.
 *   - Limited account      — a Delivery Staff account used by
 *                            permission-smoke-test.mjs for the negative
 *                            (must-be-403) permission checks.
 *
 * Credentials come from the environment:
 *
 *   SMOKE_EMAIL / SMOKE_PASSWORD                 admin-level account
 *   SMOKE_LIMITED_EMAIL / SMOKE_LIMITED_PASSWORD limited account
 *
 * Provisioning: when the API boots with ALLOW_DEMO_AUTH=true and NODE_ENV is
 * not "production", a test-only seed hook (apps/api/src/modules/smoke-seed.ts)
 * upserts these accounts into the ordinary custom-user store before serving.
 * They are real accounts that sign in through the real POST /auth/login path;
 * with the flag off (and always in production) the hook does nothing and the
 * accounts do not exist. For a local gate run:
 *
 *   ALLOW_DEMO_AUTH=true npm run dev:api   (one terminal)
 *   npm run smoke && npm run smoke:permissions   (another)
 *
 * The defaults below let a fresh clone pass with zero setup. They are
 * throwaway credentials for throwaway accounts in throwaway state, on the
 * non-routable .test TLD. The default password is the shared demo password
 * because, until P5-1 lands per-user password hashes, login() verifies every
 * account against that one shared hash — the seeded accounts already carry a
 * real per-user PBKDF2 hash of the configured password, so after P5-1 the
 * env values (or a new default here) become the accounts' actual passwords.
 *
 * Keep these defaults in sync with SMOKE_SEED_DEFAULTS in
 * apps/api/src/modules/smoke-seed.ts.
 */
export const SMOKE_CREDENTIAL_DEFAULTS = {
  email: "smoke.admin@mts-smoke.test",
  password: "password",
  limitedEmail: "smoke.delivery@mts-smoke.test",
  limitedPassword: "password"
};

export function resolveSmokeCredentials(env = process.env) {
  return {
    email: env.SMOKE_EMAIL?.trim() || SMOKE_CREDENTIAL_DEFAULTS.email,
    password: env.SMOKE_PASSWORD || SMOKE_CREDENTIAL_DEFAULTS.password,
    limitedEmail: env.SMOKE_LIMITED_EMAIL?.trim() || SMOKE_CREDENTIAL_DEFAULTS.limitedEmail,
    limitedPassword: env.SMOKE_LIMITED_PASSWORD || SMOKE_CREDENTIAL_DEFAULTS.limitedPassword
  };
}
