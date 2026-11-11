import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export type AuthTokenPayload = {
  sub: string;
  role: string;
  branchAccess?: string;
  /**
   * Session version at issue time (Phase 5 P5-1). The auth guard compares
   * this against the user's current `sessionVersion`; a credential change
   * bumps the stored version and thereby revokes every outstanding token.
   * Optional because tokens minted before P5-1 carry no claim — they are
   * read as version 0, matching a never-changed account.
   */
  sv?: number;
  iat: number;
  exp: number;
};

/**
 * Token TTL policy (Phase 5 P5-5): explicit PER DOOR, env-tunable.
 * - Password door: 12 h (owner/admin working day) — AUTH_PASSWORD_TOKEN_TTL_SECONDS.
 *   The historical AUTH_TOKEN_TTL_SECONDS variable stays honoured as the
 *   fallback for this door so existing deployments keep their setting.
 * - Staff-code door: 8 h (one warehouse shift) — AUTH_STAFF_CODE_TOKEN_TTL_SECONDS.
 * Before P5-5 a single 12 h TTL (AUTH_TOKEN_TTL_SECONDS) applied to both
 * doors. Read at sign time (not module load) so the policy is testable
 * and a restart-free env change in tests is honoured; garbage values
 * (non-numeric / non-positive) fall back to the door's default rather
 * than minting already-expired or never-expiring tokens.
 */
export type AuthDoor = "password" | "staffCode";

const DEFAULT_TOKEN_TTL_SECONDS: Record<AuthDoor, number> = {
  password: 60 * 60 * 12,
  staffCode: 60 * 60 * 8
};

export function tokenTtlSeconds(door: AuthDoor, env: NodeJS.ProcessEnv = process.env): number {
  const raw =
    door === "staffCode"
      ? env.AUTH_STAFF_CODE_TOKEN_TTL_SECONDS
      : env.AUTH_PASSWORD_TOKEN_TTL_SECONDS ?? env.AUTH_TOKEN_TTL_SECONDS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TOKEN_TTL_SECONDS[door];
}
const PASSWORD_ITERATIONS = Number(process.env.PASSWORD_HASH_ITERATIONS ?? 120_000);
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";
const DEVELOPMENT_SECRET = "mts-lbmp-development-secret-change-before-production";

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function getAuthSecret() {
  const configured = process.env.JWT_SECRET || process.env.AUTH_SECRET;
  if (configured) return configured;
  // Phase 5 P5-1: the development fallback secret is printed in the source
  // tree, so any production process that silently used it would issue
  // forgeable tokens. Fail fast at boot instead.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET or AUTH_SECRET must be set when NODE_ENV=production. " +
        "Refusing to start with the development fallback secret."
    );
  }
  return DEVELOPMENT_SECRET;
}

export function hashSecret(secret: string, salt = randomBytes(16).toString("base64url")) {
  const hash = pbkdf2Sync(secret, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString("base64url");
  return `pbkdf2:${PASSWORD_ITERATIONS}:${salt}:${hash}`;
}

export function verifySecret(secret: string, storedHash: string) {
  const [algorithm, iterationsValue, salt, expectedHash] = storedHash.split(":");
  if (algorithm !== "pbkdf2" || !iterationsValue || !salt || !expectedHash) return false;
  const iterations = Number(iterationsValue);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const actual = pbkdf2Sync(secret, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST);
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function signAuthToken(input: {
  userId: string;
  role: string;
  branchAccess?: string;
  sessionVersion?: number;
  /** Which login door minted this token — sets the TTL (P5-5). Defaults to the password door. */
  door?: AuthDoor;
}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: AuthTokenPayload = {
    sub: input.userId,
    role: input.role,
    branchAccess: input.branchAccess,
    sv: input.sessionVersion ?? 0,
    iat: now,
    exp: now + tokenTtlSeconds(input.door ?? "password")
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", getAuthSecret()).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) return null;
  const expected = createHmac("sha256", getAuthSecret()).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  const payload = parseBase64UrlJson<AuthTokenPayload>(encodedPayload);
  if (!payload?.sub || !payload.role || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
