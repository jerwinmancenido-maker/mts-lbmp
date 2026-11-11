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

const TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 12);
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

export function signAuthToken(input: { userId: string; role: string; branchAccess?: string; sessionVersion?: number }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: AuthTokenPayload = {
    sub: input.userId,
    role: input.role,
    branchAccess: input.branchAccess,
    sv: input.sessionVersion ?? 0,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
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
