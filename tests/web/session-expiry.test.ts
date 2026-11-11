import { describe, expect, test } from "vitest";
import {
  classifyAuthFailure,
  isSessionExpiredError,
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError
} from "../../apps/web/src/app/ui/session-expiry";

/**
 * Phase 5 P5-5 — the web shell's session-expiry distinction, tested at
 * the seam (classifyAuthFailure over the guard's x-auth-failure header):
 * a session failure must route to the login screen; a permission
 * failure on a valid session must NOT sign the user out; anything
 * unrecognised keeps the historical generic-error behaviour.
 */
describe("classifyAuthFailure", () => {
  test("403 + x-auth-failure: session is a session failure", () => {
    expect(classifyAuthFailure(403, "session")).toBe("session");
    expect(classifyAuthFailure(401, "session")).toBe("session");
  });

  test("403 + x-auth-failure: permission is a permission failure, never a session failure", () => {
    expect(classifyAuthFailure(403, "permission")).toBe("permission");
  });

  test("no header, an unknown header value, or a non-auth status classifies as null (generic error, no logout)", () => {
    expect(classifyAuthFailure(403, null)).toBeNull();
    expect(classifyAuthFailure(403, undefined)).toBeNull();
    expect(classifyAuthFailure(403, "something-else")).toBeNull();
    expect(classifyAuthFailure(400, "session")).toBeNull();
    expect(classifyAuthFailure(500, "session")).toBeNull();
    expect(classifyAuthFailure(200, "session")).toBeNull();
  });
});

describe("SessionExpiredError", () => {
  test("carries the plain notice text and is recognisable by type", () => {
    const error = new SessionExpiredError();
    expect(error.message).toBe(SESSION_EXPIRED_MESSAGE);
    expect(SESSION_EXPIRED_MESSAGE).toBe("Session expired — please sign in again");
    expect(isSessionExpiredError(error)).toBe(true);
    expect(isSessionExpiredError(new Error(SESSION_EXPIRED_MESSAGE))).toBe(false);
    expect(isSessionExpiredError("session expired")).toBe(false);
  });
});
