import { afterEach, describe, expect, test } from "vitest";
import { getAuthSecret, hashSecret, signAuthToken, tokenTtlSeconds, verifyAuthToken, verifySecret } from "../../apps/api/src/modules/security";

describe("API security helpers", () => {
  test("hashes and verifies secrets without storing plain text", () => {
    const hash = hashSecret("password", "qa-fixed-salt");

    expect(hash).toContain("pbkdf2");
    expect(hash).not.toContain("password");
    expect(verifySecret("password", hash)).toBe(true);
    expect(verifySecret("wrong-password", hash)).toBe(false);
  });

  test("signs auth tokens that can be verified", () => {
    const token = signAuthToken({
      userId: "qa-user",
      role: "System Admin",
      branchAccess: "All branches"
    });

    expect(token.split(".")).toHaveLength(3);
    expect(verifyAuthToken(token)).toMatchObject({
      sub: "qa-user",
      role: "System Admin",
      branchAccess: "All branches"
    });
  });

  test("signed tokens carry the session version they were issued under", () => {
    const token = signAuthToken({ userId: "qa-user", role: "Receiving Staff", sessionVersion: 7 });

    expect(verifyAuthToken(token)?.sv).toBe(7);
  });

  describe("getAuthSecret production fail-fast (P5-1)", () => {
    const KEYS = ["JWT_SECRET", "AUTH_SECRET", "NODE_ENV"] as const;
    const saved = new Map<string, string | undefined>(KEYS.map((key) => [key, process.env[key]]));

    afterEach(() => {
      for (const key of KEYS) {
        const value = saved.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    test("throws at boot in production when neither JWT_SECRET nor AUTH_SECRET is set", () => {
      delete process.env.JWT_SECRET;
      delete process.env.AUTH_SECRET;
      process.env.NODE_ENV = "production";

      expect(() => getAuthSecret()).toThrow(/JWT_SECRET or AUTH_SECRET/);
    });

    test("uses the configured secret in production", () => {
      process.env.JWT_SECRET = "a-real-production-secret";
      delete process.env.AUTH_SECRET;
      process.env.NODE_ENV = "production";

      expect(getAuthSecret()).toBe("a-real-production-secret");
    });

    test("outside production the development fallback still applies", () => {
      delete process.env.JWT_SECRET;
      delete process.env.AUTH_SECRET;
      process.env.NODE_ENV = "test";

      expect(getAuthSecret()).toBeTruthy();
    });
  });

  describe("per-door token TTL (P5-5)", () => {
    const KEYS = ["AUTH_PASSWORD_TOKEN_TTL_SECONDS", "AUTH_STAFF_CODE_TOKEN_TTL_SECONDS", "AUTH_TOKEN_TTL_SECONDS"] as const;
    const saved = new Map<string, string | undefined>(KEYS.map((key) => [key, process.env[key]]));

    afterEach(() => {
      for (const key of KEYS) {
        const value = saved.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    function clearTtlEnv() {
      for (const key of KEYS) delete process.env[key];
    }

    function lifetimeOf(token: string) {
      const payload = verifyAuthToken(token);
      return (payload?.exp ?? 0) - (payload?.iat ?? 0);
    }

    test("defaults: staff-code sessions last 8 h, password sessions 12 h", () => {
      clearTtlEnv();
      expect(tokenTtlSeconds("staffCode")).toBe(8 * 60 * 60);
      expect(tokenTtlSeconds("password")).toBe(12 * 60 * 60);
      expect(lifetimeOf(signAuthToken({ userId: "qa-user", role: "Receiving Staff", door: "staffCode" }))).toBe(8 * 60 * 60);
      expect(lifetimeOf(signAuthToken({ userId: "qa-user", role: "System Admin", door: "password" }))).toBe(12 * 60 * 60);
      // No door specified = the password door (the pre-P5-5 behaviour).
      expect(lifetimeOf(signAuthToken({ userId: "qa-user", role: "System Admin" }))).toBe(12 * 60 * 60);
    });

    test("each door is env-tunable independently, and the legacy variable still feeds the password door", () => {
      clearTtlEnv();
      process.env.AUTH_STAFF_CODE_TOKEN_TTL_SECONDS = "3600";
      process.env.AUTH_PASSWORD_TOKEN_TTL_SECONDS = "7200";
      expect(tokenTtlSeconds("staffCode")).toBe(3600);
      expect(tokenTtlSeconds("password")).toBe(7200);

      delete process.env.AUTH_PASSWORD_TOKEN_TTL_SECONDS;
      process.env.AUTH_TOKEN_TTL_SECONDS = "5400";
      expect(tokenTtlSeconds("password")).toBe(5400);
      expect(tokenTtlSeconds("staffCode")).toBe(3600);
    });

    test("garbage TTL values fall back to the door default instead of minting broken tokens", () => {
      clearTtlEnv();
      process.env.AUTH_STAFF_CODE_TOKEN_TTL_SECONDS = "not-a-number";
      process.env.AUTH_PASSWORD_TOKEN_TTL_SECONDS = "-5";
      expect(tokenTtlSeconds("staffCode")).toBe(8 * 60 * 60);
      expect(tokenTtlSeconds("password")).toBe(12 * 60 * 60);
    });
  });

  test("rejects tampered auth tokens", () => {
    const token = signAuthToken({ userId: "qa-user", role: "Receiving Staff" });
    const parts = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: "qa-user", role: "System Admin", iat: 1, exp: 9_999_999_999 }),
      "utf8"
    ).toString("base64url");

    expect(verifyAuthToken(`${parts[0]}.${tamperedPayload}.${parts[2]}`)).toBeNull();
  });
});
