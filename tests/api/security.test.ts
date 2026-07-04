import { describe, expect, test } from "vitest";
import { hashSecret, signAuthToken, verifyAuthToken, verifySecret } from "../../apps/api/src/modules/security";

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
