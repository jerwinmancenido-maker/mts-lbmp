/**
 * Session-expiry seam (Phase 5 P5-5), kept pure and dependency-free so
 * the distinction is unit-testable without a DOM or the API client.
 *
 * The API's auth guard refuses requests for two very different reasons
 * and Nest renders both as the same 403 status:
 * - "session": no token, or the token is expired / invalid / revoked /
 *   gated behind a forced password change. The session is OVER — the
 *   shell must return to the login screen.
 * - "permission": the session is valid; the account simply lacks the
 *   permission for that endpoint. An ordinary error — the user must NOT
 *   be signed out.
 * The guard stamps the kind on the `x-auth-failure` response header
 * (auth.guard.ts, CORS-exposed in main.ts); classifyAuthFailure is the
 * one place the shell interprets it. A response with no header (older
 * API, proxy interference) classifies as null and keeps the historical
 * generic-error behaviour — never a surprise logout.
 */
export const SESSION_EXPIRED_MESSAGE = "Session expired — please sign in again";

export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = "SessionExpiredError";
  }
}

export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof SessionExpiredError;
}

export type AuthFailureKind = "session" | "permission";

export function classifyAuthFailure(status: number, failureHeader: string | null | undefined): AuthFailureKind | null {
  if (status !== 401 && status !== 403) return null;
  if (failureHeader === "session") return "session";
  if (failureHeader === "permission") return "permission";
  return null;
}
