import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { JsonStateStore, type ServiceState, type StateStore } from "../../apps/api/src/modules/state-store";
import { PrismaStateStore, type PrismaStateClient } from "../../apps/api/src/modules/prisma-state-store";
import type { Customer } from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 fix loop PR-1 — canonical finding C-B1 (Blocker).
 *
 * What is proven here:
 * - JsonStateStore.save is atomic (temp + fsync + rename) and rotates the
 *   previous durable state to `<file>.bak`; a failed save throws
 *   synchronously and leaves the previous good state file untouched.
 * - JsonStateStore.load recovers the backup when the state file is empty,
 *   truncated, or missing-but-backed-up — loudly — and refuses to boot
 *   (throws) when a corrupt state file has no usable backup, instead of
 *   silently resetting to factory defaults (L22-F1/F22-2).
 * - LogisticsService mutations fail visibly when the store cannot persist:
 *   the mutation throws, the in-memory change is rolled back to the last
 *   durable snapshot, and the record exists nowhere afterwards — including
 *   after a restart (L6-F5). A store blocked from boot fails the boot.
 * - The Prisma path's asynchronous save failures are not swallowed: the
 *   store's save() rejects, and the service fails closed on the next
 *   mutation instead of continuing to answer silent successes.
 */

type ServiceInternals = {
  customers: Customer[];
  store: StateStore;
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

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function stateFile(dir: string): string {
  return join(dir, "storage", "dev-data", "mts-lbmp.json");
}

function backupFile(dir: string): string {
  return `${stateFile(dir)}.bak`;
}

/** Boots a service against a fresh throwaway state dir. */
async function bootService(dir: string) {
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

function customerNames(service: LogisticsService): string[] {
  return internals(service).customers.map((customer) => customer.businessName);
}

function minimalState(businessName: string): ServiceState {
  return {
    sequences: [],
    customers: [{ id: "cust_test", businessName, status: "Active", contacts: [] }],
    receivingRecords: [],
    receivingDrafts: [],
    receivingIntakeTasks: [],
    packages: [],
    productMasters: [],
    trucks: [],
    trips: [],
    deliveries: [],
    payments: [],
    expenses: [],
    returnRecords: [],
    billingInvoices: [],
    notifications: [],
    auditLogs: [],
    descriptionBarcodes: [],
    messages: [],
    operationChatThreads: [],
    hardwareTests: [],
    printLogs: [],
    customUsers: [],
    idempotencyRecords: [],
    companyProfile: { companyName: "Test Co", address: "", phone: "", email: "" },
    branches: [],
    paymentMethods: [],
    expenseCategories: []
  } as unknown as ServiceState;
}

describe("JsonStateStore — atomic save", () => {
  test("save → load round-trip is unchanged, and the second save rotates the previous state to .bak", async () => {
    const dir = tempDir("mts-atomic-roundtrip-");
    const path = join(dir, "mts-lbmp.json");
    const store = new JsonStateStore(path);

    store.save(minimalState("Alpha Trading"));
    expect(await store.load()).toEqual(minimalState("Alpha Trading"));
    // Nothing existed before the first save, so there is nothing to rotate.
    expect(existsSync(`${path}.bak`)).toBe(false);

    store.save(minimalState("Beta Trading"));
    expect(await store.load()).toEqual(minimalState("Beta Trading"));
    const backup = JSON.parse(readFileSync(`${path}.bak`, "utf8")) as ServiceState;
    expect(backup.customers[0]?.businessName).toBe("Alpha Trading");
  });

  test("save throws synchronously when the write cannot land, and the previous good file is untouched", async () => {
    const dir = tempDir("mts-atomic-failure-");
    const path = join(dir, "mts-lbmp.json");
    const store = new JsonStateStore(path);
    store.save(minimalState("Alpha Trading"));
    const goodBytes = readFileSync(path, "utf8");

    // Block the temp path with a directory: the atomic write cannot start.
    mkdirSync(`${path}.tmp-${process.pid}`);
    expect(() => store.save(minimalState("Beta Trading"))).toThrow();
    expect(readFileSync(path, "utf8")).toBe(goodBytes);
    expect(await store.load()).toEqual(minimalState("Alpha Trading"));
  });

  test("save throws synchronously when the state directory path is blocked (L6 E9 shape)", () => {
    const dir = tempDir("mts-atomic-blocked-");
    // A regular file where the storage directory must be created.
    writeFileSync(join(dir, "storage"), "not a directory");
    const store = new JsonStateStore(join(dir, "storage", "dev-data", "mts-lbmp.json"));
    expect(() => store.save(minimalState("Alpha Trading"))).toThrow();
  });
});

describe("JsonStateStore — load recovery (L22-F1/F22-2)", () => {
  /** Saves Alpha then Beta, so main holds Beta and .bak holds Alpha. */
  function storeWithBackup(dir: string): JsonStateStore {
    const store = new JsonStateStore(join(dir, "mts-lbmp.json"));
    store.save(minimalState("Alpha Trading"));
    store.save(minimalState("Beta Trading"));
    return store;
  }

  test("a 0-byte state file boots with the backup's data, loudly", async () => {
    const dir = tempDir("mts-load-empty-");
    const store = storeWithBackup(dir);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      writeFileSync(join(dir, "mts-lbmp.json"), "");
      const loaded = await store.load();
      expect(loaded?.customers?.[0]?.businessName).toBe("Alpha Trading");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a truncated state file boots with the backup's data", async () => {
    const dir = tempDir("mts-load-truncated-");
    const store = storeWithBackup(dir);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const path = join(dir, "mts-lbmp.json");
      const raw = readFileSync(path, "utf8");
      writeFileSync(path, raw.slice(0, Math.floor(raw.length * 0.55)));
      const loaded = await store.load();
      expect(loaded?.customers?.[0]?.businessName).toBe("Alpha Trading");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a missing state file with a backup present recovers the backup (interrupted save)", async () => {
    const dir = tempDir("mts-load-missing-");
    const store = storeWithBackup(dir);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      rmSync(join(dir, "mts-lbmp.json"));
      const loaded = await store.load();
      expect(loaded?.customers?.[0]?.businessName).toBe("Alpha Trading");
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a corrupt state file with no usable backup fails loudly instead of resetting to defaults", async () => {
    const dir = tempDir("mts-load-corrupt-");
    const path = join(dir, "mts-lbmp.json");
    writeFileSync(path, "{ this is not json");
    await expect(new JsonStateStore(path).load()).rejects.toThrow(/Refusing to boot/);

    writeFileSync(path, "");
    await expect(new JsonStateStore(path).load()).rejects.toThrow(/Refusing to boot/);
  });

  test("no state file and no backup is a fresh install (undefined), as before", async () => {
    const dir = tempDir("mts-load-fresh-");
    await expect(new JsonStateStore(join(dir, "mts-lbmp.json")).load()).resolves.toBeUndefined();
  });
});

describe("LogisticsService — failed saves fail the mutation (L6-F5)", () => {
  test("save → restart round-trip is unchanged: created records are served after a reboot", async () => {
    const dir = tempDir("mts-service-roundtrip-");
    const first = await bootService(dir);
    first.createCustomer({ businessName: "Roundtrip Alpha" });
    first.createCustomer({ businessName: "Roundtrip Beta" });
    await first.onModuleDestroy();

    const second = await bootService(dir);
    expect(customerNames(second)).toEqual(expect.arrayContaining(["Roundtrip Alpha", "Roundtrip Beta"]));
    await second.onModuleDestroy();
  });

  test("a store that starts failing mid-run: the mutation throws, rolls back, and the record exists nowhere", async () => {
    const dir = tempDir("mts-service-blocked-");
    const service = await bootService(dir);
    service.createCustomer({ businessName: "Durable Co" });
    expect(customerNames(service)).toContain("Durable Co");

    // Block every subsequent save, L6 E9 style: the storage directory is
    // replaced by a regular file, so the store's mkdir/open fails ENOTDIR.
    renameSync(join(dir, "storage"), join(dir, "storage-good"));
    writeFileSync(join(dir, "storage"), "blocked");

    expect(() => service.createCustomer({ businessName: "Ghost Co" })).toThrow();
    // Rolled back in memory: the ghost is not served, the durable record is.
    expect(customerNames(service)).toEqual(["Durable Co"]);
    await service.onModuleDestroy();

    // Repair the path and reboot: the ghost was never persisted, and the
    // failed save left the previous good state file intact.
    rmSync(join(dir, "storage"));
    renameSync(join(dir, "storage-good"), join(dir, "storage"));
    const persisted = JSON.parse(readFileSync(stateFile(dir), "utf8")) as ServiceState;
    expect(persisted.customers.map((customer) => customer.businessName)).toEqual(["Durable Co"]);

    const rebooted = await bootService(dir);
    expect(customerNames(rebooted)).toEqual(["Durable Co"]);
    await rebooted.onModuleDestroy();
  });

  test("a torn state file at boot recovers the backup instead of wiping the dataset", async () => {
    const dir = tempDir("mts-service-torn-");
    const first = await bootService(dir);
    first.createCustomer({ businessName: "Backup Alpha" });
    first.createCustomer({ businessName: "Main Beta" });
    await first.onModuleDestroy();
    expect(existsSync(backupFile(dir))).toBe(true);

    // Tear the main file the way a killed writeFileSync used to leave it.
    const raw = readFileSync(stateFile(dir), "utf8");
    writeFileSync(stateFile(dir), raw.slice(0, Math.floor(raw.length * 0.55)));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const recovered = await bootService(dir);
      // The backup (pre-Beta state) is what boots — loudly, not silently.
      expect(customerNames(recovered)).toEqual(["Backup Alpha"]);
      expect(errorSpy).toHaveBeenCalled();
      await recovered.onModuleDestroy();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("boot fails loudly when the store is blocked from the start", async () => {
    const dir = tempDir("mts-service-bootblocked-");
    writeFileSync(join(dir, "storage"), "not a directory");
    process.env.INIT_CWD = dir;
    const service = new LogisticsService();
    await expect(service.onModuleInit()).rejects.toThrow();
  });
});

describe("Prisma path — asynchronous save failures are not swallowed", () => {
  test("PrismaStateStore.save rejects when the replace transaction fails", async () => {
    const dir = tempDir("mts-prisma-failure-");
    const boot = await bootService(dir);
    const state = internals(boot).snapshotState();
    await boot.onModuleDestroy();

    const failingClient = {
      $transaction: async () => {
        throw new Error("database unavailable");
      },
      $disconnect: async () => {}
    } as unknown as PrismaStateClient;
    const store = new PrismaStateStore(async () => failingClient);
    await expect(store.save(state)).rejects.toThrow("database unavailable");
  });

  test("after an async save failure the service fails closed: the next mutation is refused and rolled back", async () => {
    const dir = tempDir("mts-service-failclosed-");
    const service = await bootService(dir);

    // Swap the durable JSON store for an async store whose saves reject —
    // the Prisma path's failure shape — through the same internals seam
    // the other persistence tests use.
    const failingStore: StateStore = {
      load: async () => undefined,
      save: async () => {
        throw new Error("database unavailable");
      }
    };
    internals(service).store = failingStore;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The first mutation answers before its async save settles (the
      // service API is synchronous); the rejection is tracked, not lost.
      service.createCustomer({ businessName: "Unlucky Co" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(errorSpy).toHaveBeenCalled();

      // From then on the service refuses to pile writes onto a dead store:
      // the next mutation throws and everything unpersisted is rolled back
      // to the last durable (post-boot) state.
      expect(() => service.createCustomer({ businessName: "Refused Co" })).toThrow();
      expect(customerNames(service)).not.toContain("Unlucky Co");
      expect(customerNames(service)).not.toContain("Refused Co");
    } finally {
      errorSpy.mockRestore();
    }
    await service.onModuleDestroy();
  });
});
