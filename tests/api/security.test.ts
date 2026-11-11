import { afterEach, describe, expect, test } from "vitest";
import { getAuthSecret, hashSecret, signAuthToken, verifyAuthToken, verifySecret } from "../../apps/api/src/modules/security";

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
