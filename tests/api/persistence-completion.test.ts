import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type { StaffUserRecord } from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 5 tranche P5-4 — parked-gap persistence completion.
 *
 * What is proven here:
 * - The Phase 2 §4.1 regression as a permanent test at the mapping/service
 *   seam: a staff member CREATED through the service (staff code + password
 *   set at creation) still signs in after their record travels the full
 *   Prisma-shaped path — service state → stateToRows → rowsToState →
 *   a freshly booted service. Before P5-1's columns this round-trip erased
 *   the staff code and Door 2 stopped working for created staff.
 * - CR-007: branchAccess on the user record is the single source of
 *   truth. updateUserBranchAccess writes the record (not a side map), the
 *   value is what stateToRows persists, and a legacy state file carrying
 *   the deleted `userBranchAccessOverrides` map loads without crashing —
 *   its values are folded into the records and the map is dropped from
 *   the next persisted snapshot.
 */

type ServiceInternals = {
  customUsers: StaffUserRecord[];
  snapshotState: () => ServiceState;
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

/** Boots a service against a fresh throwaway state dir. */
async function bootService(options: { seedState?: unknown } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mts-persistence-completion-"));
  tempRoots.push(dir);
  if (options.seedState !== undefined) {
    const dataDir = join(dir, "storage", "dev-data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "mts-lbmp.json"), JSON.stringify(options.seedState, null, 2));
  }
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return { service, dir };
}

/** saveData() persists fire-and-forget; poll until the write lands. */
async function readPersistedState(dir: string, marker: string) {
  const path = join(dir, "storage", "dev-data", "mts-lbmp.json");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8");
      if (raw.includes(marker)) return raw;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Persisted state file never contained ${marker}`);
}

describe("§4.1 regression — created staff survive the Prisma-shaped round-trip", () => {
  test("create with a staff code → stateToRows → rowsToState → reboot → staff-code login still verifies", async () => {
    const { service: first } = await bootService();
    const created = first.createStaffUser({
      name: "Round Trip Receiver",
      email: "roundtrip.receiver@mts.local",
      role: "Receiving Staff",
      branchAccess: "Daet",
      staffCode: "4321",
      password: "receiver-initial-1"
    });
    expect(created.id).toBeTruthy();

    // The Prisma path, shaped exactly as PrismaStateStore drives it:
    // the live service state becomes rows, the rows become a fresh state.
    const prismaShapedState = rowsToState(stateToRows(internals(first).snapshotState()));
    const reloadedUser = prismaShapedState.customUsers?.find((entry) => entry.id === created.id);
    expect(reloadedUser).toBeDefined();
    expect(reloadedUser?.staffCodeHash).toBeTruthy();
    expect(reloadedUser?.passwordHash).toBeTruthy();
    expect(reloadedUser?.branchId).toBeUndefined(); // never set on this account — stays unset, not invented
    await first.onModuleDestroy();

    // A fresh service booted from the round-tripped state: both doors
    // verify against the round-tripped hashes (this is the §4.1 failure
    // mode — the code door silently dying across a restart).
    const { service: second } = await bootService({ seedState: prismaShapedState });
    const byCode = second.loginWithStaffCode({ staffCode: "4321" });
    expect(byCode.user.id).toBe(created.id);
    const byPassword = second.login({ email: "roundtrip.receiver@mts.local", password: "receiver-initial-1" });
    expect(byPassword.user.id).toBe(created.id);
    await second.onModuleDestroy();
  });
});

describe("CR-007 — branchAccess on the record is the single source of truth", () => {
  test("updateUserBranchAccess writes the record itself, and stateToRows persists that value", async () => {
    const { service, dir } = await bootService();
    const created = service.createStaffUser({
      name: "Branch Mover",
      email: "branch.mover@mts.local",
      role: "Delivery Staff",
      branchAccess: "Daet",
      staffCode: "7777"
    });

    const updated = service.updateUserBranchAccess(created.id, { branchAccess: "Naga" });
    expect(updated.branchAccess).toBe("Naga");
    const record = internals(service).customUsers.find((entry) => entry.id === created.id);
    expect(record?.branchAccess).toBe("Naga");

    // The Prisma path persists the record's own value — no side map.
    const rows = stateToRows(internals(service).snapshotState());
    expect(rows.users.find((entry) => entry.id === created.id)?.branchAccess).toBe("Naga");

    // And the JSON snapshot carries the value on the record.
    const persisted = await readPersistedState(dir, '"branchAccess": "Naga"');
    expect(persisted).not.toContain("userBranchAccessOverrides");
    await service.onModuleDestroy();
  });

  test("a legacy state file with userBranchAccessOverrides loads, folds, and drops the map", async () => {
    const legacyState = {
      customUsers: [
        {
          id: "user_legacy",
          name: "Legacy Branch User",
          email: "legacy@mts.local",
          role: "Receiving Staff",
          branchAccess: "Daet",
          status: "Active"
        }
      ],
      // Pre-P5-4 shape: the admin's later change lived ONLY in this map.
      userBranchAccessOverrides: { user_legacy: "Naga" }
    };
    const { service, dir } = await bootService({ seedState: legacyState });

    // No crash, and the override value wins — folded onto the record,
    // exactly the effective value the old code would have presented.
    const record = internals(service).customUsers.find((entry) => entry.id === "user_legacy");
    expect(record?.branchAccess).toBe("Naga");

    // The migrated state is persisted back WITHOUT the map.
    const persisted = await readPersistedState(dir, '"branchAccess": "Naga"');
    expect(persisted).not.toContain("userBranchAccessOverrides");
    await service.onModuleDestroy();
  });
});
