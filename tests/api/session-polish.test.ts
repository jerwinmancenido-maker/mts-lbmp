import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AUTH_FAILURE_HEADER, AuthGuard, REQUIRED_PERMISSIONS } from "../../apps/api/src/modules/auth.guard";
import { deviceLabelFromUserAgent } from "../../apps/api/src/modules/device-label";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { hashSecret, verifyAuthToken } from "../../apps/api/src/modules/security";
import type { ServiceAuditLog, StaffUserRecord } from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 5 tranche P5-5 — session & client polish, API side.
 *
 * What is proven here:
 * - Device labels are coarse (browser family + OS family only) and
 *   collapse safely to "Unknown device".
 * - Both login doors write their audit entries WITH the device label,
 *   successes and failures alike.
 * - The auth guard stamps its refusal kind on the x-auth-failure header:
 *   "session" for a missing/invalid/revoked token, "permission" for a
 *   valid session that lacks a permission. This header is the signal
 *   the web shell uses to route expired sessions to the login screen
 *   WITHOUT signing out users who merely hit a permission wall.
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  auditLogs: ServiceAuditLog[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const ENV_KEYS = ["INIT_CWD", "MTS_REPOSITORY", "ALLOW_DEMO_AUTH", "NODE_ENV", "SMOKE_EMAIL", "SMOKE_PASSWORD", "SMOKE_LIMITED_EMAIL", "SMOKE_LIMITED_PASSWORD"];
const savedEnv: Record<string, string | undefined> = {};
const tempRoots: string[] = [];

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.MTS_REPOSITORY;
  delete process.env.ALLOW_DEMO_AUTH;
  delete process.env.SMOKE_EMAIL;
  delete process.env.SMOKE_PASSWORD;
  delete process.env.SMOKE_LIMITED_EMAIL;
  delete process.env.SMOKE_LIMITED_PASSWORD;
  if (process.env.NODE_ENV === "production") delete process.env.NODE_ENV;
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

async function bootService() {
  const dir = mkdtempSync(join(tmpdir(), "mts-session-polish-"));
  tempRoots.push(dir);
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

const CHROME_WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("deviceLabelFromUserAgent", () => {
  test("labels are coarse browser + OS families", () => {
    expect(deviceLabelFromUserAgent(CHROME_WINDOWS_UA)).toBe("Chrome on Windows");
    expect(deviceLabelFromUserAgent(SAFARI_IPHONE_UA)).toBe("Safari on iOS");
    expect(
      deviceLabelFromUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36")
    ).toBe("Samsung Internet on Android");
    expect(
      deviceLabelFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0")
    ).toBe("Firefox on macOS");
    expect(
      deviceLabelFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0")
    ).toBe("Edge on Windows");
  });

  test("missing or unrecognised agents collapse to Unknown device", () => {
    expect(deviceLabelFromUserAgent(undefined)).toBe("Unknown device");
    expect(deviceLabelFromUserAgent("")).toBe("Unknown device");
    expect(deviceLabelFromUserAgent("curl/8.5.0")).toBe("Unknown device");
  });
});

describe("login audit device labels", () => {
  test("both doors record the device label on success, and failures carry it too", async () => {
    const service = await bootService();
    internals(service).customUsers.push({
      id: "user_device",
      name: "Device Label Staff",
      email: "device@mts.local",
      role: "Receiving Staff",
      status: "Active",
      passwordHash: hashSecret("device-pw-1"),
      staffCodeHash: hashSecret("2468")
    });

    service.login({ email: "device@mts.local", password: "device-pw-1", userAgent: CHROME_WINDOWS_UA });
    const passwordLogin = internals(service).auditLogs.find((entry) => entry.action === "auth.login");
    expect(passwordLogin?.reason).toBe("door=password; device=Chrome on Windows");

    service.loginWithStaffCode({ staffCode: "2468", userAgent: SAFARI_IPHONE_UA });
    const codeLogin = internals(service).auditLogs.find((entry) => entry.action === "auth.staffCodeLogin");
    expect(codeLogin?.reason).toBe("door=staffCode; device=Safari on iOS");

    expect(() => service.login({ email: "device@mts.local", password: "wrong", userAgent: CHROME_WINDOWS_UA })).toThrow("Invalid email or password");
    const failure = internals(service).auditLogs.find((entry) => entry.action === "auth.loginFailed");
    expect(failure?.reason).toContain("device=Chrome on Windows");

    await service.onModuleDestroy();
  });

  test("the staff-code door mints the 8 h token and the password door the 12 h token", async () => {
    const service = await bootService();
    internals(service).customUsers.push({
      id: "user_ttl",
      name: "TTL Staff",
      email: "ttl@mts.local",
      role: "Receiving Staff",
      status: "Active",
      passwordHash: hashSecret("ttl-pw-123"),
      staffCodeHash: hashSecret("1357")
    });

    const byPassword = service.login({ email: "ttl@mts.local", password: "ttl-pw-123" });
    const passwordPayload = verifyAuthToken(byPassword.token);
    expect((passwordPayload?.exp ?? 0) - (passwordPayload?.iat ?? 0)).toBe(12 * 60 * 60);

    const byCode = service.loginWithStaffCode({ staffCode: "1357" });
    const codePayload = verifyAuthToken(byCode.token);
    expect((codePayload?.exp ?? 0) - (codePayload?.iat ?? 0)).toBe(8 * 60 * 60);

    await service.onModuleDestroy();
  });
});

describe("auth guard refusal-kind header (x-auth-failure)", () => {
  function guardFor(service: LogisticsService, requiredPermissions?: string[]) {
    // The reflector must answer per metadata key: the required
    // permissions only for REQUIRED_PERMISSIONS, undefined otherwise
    // (returning the array for IS_PUBLIC_ROUTE would mark every route
    // public and the guard would never run).
    const reflector = {
      getAllAndOverride: (key: string) => (key === REQUIRED_PERMISSIONS ? requiredPermissions : undefined)
    };
    const jwt = {
      verify: (token: string) => {
        const payload = verifyAuthToken(token);
        if (!payload) throw new Error("invalid token");
        return payload;
      }
    };
    return new AuthGuard(reflector as never, service, jwt as never);
  }

  function contextFor(token: string | undefined) {
    const stamped: Record<string, string> = {};
    const request: { headers: Record<string, string>; user?: unknown; path: string } = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      path: "/expenses/approve"
    };
    const response = {
      setHeader: (name: string, value: string) => {
        stamped[name] = value;
      }
    };
    return {
      context: {
        getHandler: () => null,
        getClass: () => null,
        switchToHttp: () => ({ getRequest: () => request, getResponse: () => response })
      },
      stamped
    };
  }

  test("a missing or garbage token is a SESSION failure", async () => {
    const service = await bootService();
    const guard = guardFor(service);

    const missing = contextFor(undefined);
    expect(guard.canActivate(missing.context as never)).toBe(false);
    expect(missing.stamped[AUTH_FAILURE_HEADER]).toBe("session");

    const garbage = contextFor("not-a-real-token");
    expect(guard.canActivate(garbage.context as never)).toBe(false);
    expect(garbage.stamped[AUTH_FAILURE_HEADER]).toBe("session");

    await service.onModuleDestroy();
  });

  test("a valid session lacking the permission is a PERMISSION failure — not a session failure", async () => {
    const service = await bootService();
    internals(service).customUsers.push({
      id: "user_delivery",
      name: "Delivery Only",
      email: "delivery.only@mts.local",
      role: "Delivery Staff",
      status: "Active",
      passwordHash: hashSecret("delivery-pw-1")
    });
    const { token } = service.login({ email: "delivery.only@mts.local", password: "delivery-pw-1" });

    // Delivery Staff's preset has no expenses.approve.
    const guard = guardFor(service, ["expenses.approve"]);
    const denied = contextFor(token);
    expect(guard.canActivate(denied.context as never)).toBe(false);
    expect(denied.stamped[AUTH_FAILURE_HEADER]).toBe("permission");

    // The same token passes an endpoint with no required permissions and
    // stamps nothing.
    const openGuard = guardFor(service);
    const allowed = contextFor(token);
    expect(openGuard.canActivate(allowed.context as never)).toBe(true);
    expect(allowed.stamped[AUTH_FAILURE_HEADER]).toBeUndefined();

    await service.onModuleDestroy();
  });
});
