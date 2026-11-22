import "reflect-metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../apps/api/src/modules/app.module";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type { ServiceState, StateStore } from "../../apps/api/src/modules/state-store";
import type { CargoPackage, Customer, ExpenseRecord, PaymentRecord, ReceivingDraft } from "../../apps/api/src/modules/logistics.types";

/**
 * FU-1 route (a) — awaited saves (follow-up to Round 1 finding C-B1).
 *
 * FU1-DISCHARGE.md proved the defect live on the Prisma path: a mutation
 * answered HTTP 201 while its asynchronous save was still in flight; when
 * the save failed, the acknowledged record stayed readable as a phantom
 * for the rest of the run and vanished at restart. The service layer is
 * synchronous by architecture, so the fix holds the answer at the HTTP
 * boundary instead: PersistenceFlushInterceptor checkpoints the service
 * before a mutating handler runs and awaits
 * LogisticsService.flushPersistence() before the response is sent.
 *
 * What is proven here:
 * - With a store whose saves reject, the flush throws the fail-closed
 *   500 for a customer, an expense (the discharge's ₱777 leg), and a
 *   payment; the record is absent from memory immediately afterwards —
 *   no readable phantom — and absent after a simulated reload.
 * - With a save that resolves slowly, the flush does not settle before
 *   the save does (the response is held, not merely eventually checked).
 * - The state a save receives is frozen at its own saveData call: a
 *   mutation that lands while an earlier save is still queued does not
 *   leak into that earlier save's snapshot.
 * - Healthy-path parity: mutations flush cleanly and persist; a request
 *   that queued no save pays nothing, even against a now-failing store.
 * - Idempotency (PR-7c's rule at this layer): a keyed create whose flush
 *   fails leaves no idempotency record anywhere, so the same key retried
 *   after a restart executes fresh and applies exactly once; a replay on
 *   the healthy path still returns the stored result with no new save.
 * - Over real HTTP through the Nest app: a POST against a failing store
 *   answers 500 (not 201) and the record is not served afterwards; the
 *   same POST against a healthy store answers 201 and is served.
 */

type ServiceInternals = {
  customers: Customer[];
  expenses: ExpenseRecord[];
  payments: PaymentRecord[];
  packages: CargoPackage[];
  receivingDrafts: ReceivingDraft[];
  idempotencyRecords: unknown[];
  store: StateStore;
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

/**
 * An asynchronous store double with the Prisma path's shape: save()
 * returns a promise that settles later. Records every snapshot it was
 * handed (attempts) and the last one that actually landed (durable) —
 * the stand-in for "what a restart would load".
 */
class AsyncStoreDouble implements StateStore {
  attempts: ServiceState[] = [];
  durable: ServiceState | undefined;
  failure: Error | undefined;
  gate: Promise<void> | undefined;

  async load(): Promise<ServiceState | undefined> {
    return this.durable ? (JSON.parse(JSON.stringify(this.durable)) as ServiceState) : undefined;
  }

  save(state: ServiceState): Promise<void> {
    this.attempts.push(state);
    return (async () => {
      if (this.gate) await this.gate;
      if (this.failure) throw this.failure;
      this.durable = state;
    })();
  }
}

const ENV_KEYS = [
  "INIT_CWD",
  "MTS_REPOSITORY",
  "ALLOW_DEMO_AUTH",
  "NODE_ENV",
  "JWT_SECRET",
  "AUTH_SECRET",
  "SMOKE_EMAIL",
  "SMOKE_PASSWORD",
  "SMOKE_LIMITED_EMAIL",
  "SMOKE_LIMITED_PASSWORD"
];
const savedEnv: Record<string, string | undefined> = {};
const tempRoots: string[] = [];

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.MTS_REPOSITORY;
  delete process.env.ALLOW_DEMO_AUTH;
  delete process.env.JWT_SECRET;
  delete process.env.AUTH_SECRET;
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

/** Boots a service on the JSON store against a fresh throwaway state dir. */
async function bootService(dir: string) {
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

/** Boots a fresh service whose store is the given double — a simulated restart. */
async function bootFromStore(dir: string, store: StateStore) {
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  internals(service).store = store;
  await service.onModuleInit();
  return service;
}

function customerNames(service: LogisticsService): string[] {
  return internals(service).customers.map((customer) => customer.businessName);
}

/** Runs one mutation the way the HTTP boundary does: checkpoint, mutate, flush. */
async function mutateAndFlush<T>(service: LogisticsService, mutate: () => T): Promise<T> {
  const checkpoint = service.persistenceCheckpoint();
  const result = mutate();
  await service.flushPersistence(checkpoint);
  return result;
}

describe("flushPersistence — a rejected save fails the mutation and leaves no phantom", () => {
  test("customer: flush throws the fail-closed 500, the record is nowhere afterwards", async () => {
    const dir = tempDir("mts-fu1-customer-");
    const service = await bootService(dir);
    service.createCustomer({ businessName: "Durable Co" });

    const store = new AsyncStoreDouble();
    store.failure = new Error("database unavailable");
    internals(service).store = store;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const checkpoint = service.persistenceCheckpoint();
      // The service API is synchronous: the record exists in memory at
      // this instant — that is precisely the window FU-1 measured. The
      // flush is what must close it before any answer is sent.
      service.createCustomer({ businessName: "Phantom Co" });
      expect(customerNames(service)).toContain("Phantom Co");
      await expect(service.flushPersistence(checkpoint)).rejects.toThrow(/Failed to persist logistics state/);
    } finally {
      errorSpy.mockRestore();
    }

    // Rollback parity with the synchronous store: no phantom readable,
    // the previously durable record untouched, nothing ever landed.
    expect(customerNames(service)).toEqual(["Durable Co"]);
    expect(store.durable).toBeUndefined();
    await service.onModuleDestroy();

    // Simulated reload: a fresh service over whatever the store holds.
    const reloaded = await bootFromStore(tempDir("mts-fu1-customer-reload-"), store);
    expect(customerNames(reloaded)).not.toContain("Phantom Co");
    await reloaded.onModuleDestroy();
  });

  test("expense: the discharge's ₱777 leg now fails instead of answering success", async () => {
    const dir = tempDir("mts-fu1-expense-");
    const service = await bootService(dir);

    const store = new AsyncStoreDouble();
    store.failure = new Error("database unavailable");
    internals(service).store = store;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const checkpoint = service.persistenceCheckpoint();
      service.createExpense({ category: "Meals", amount: 777, description: "FU-1 discharge leg" });
      await expect(service.flushPersistence(checkpoint)).rejects.toThrow(/Failed to persist logistics state/);
    } finally {
      errorSpy.mockRestore();
    }

    expect(internals(service).expenses).toEqual([]);
    expect(store.durable).toBeUndefined();
    await service.onModuleDestroy();

    const reloaded = await bootFromStore(tempDir("mts-fu1-expense-reload-"), store);
    expect(internals(reloaded).expenses).toEqual([]);
    await reloaded.onModuleDestroy();
  });

  test("payment: a collected payment whose save fails is refused and collected nowhere", async () => {
    const dir = tempDir("mts-fu1-payment-");
    const service = await bootService(dir);

    // Seed a priced package and make it durable through the healthy
    // double first, so the rollback target legitimately contains it.
    const store = new AsyncStoreDouble();
    internals(service).store = store;
    internals(service).packages.push({
      id: "pkg_fu1",
      packageNumber: "PKG-2026-11-000777",
      receivingRecordNumber: "RR-2026-11-000777",
      customerId: "cust_fu1",
      customerName: "FU-1 Fixture Customer",
      description: "Rice sacks",
      quantity: 1,
      unit: "sack",
      destination: "Daet",
      handlingBranchId: "daet",
      handlingBranchName: "Daet",
      deliveryType: "Door-to-door delivery",
      condition: "Good",
      status: "Out for Delivery",
      price: 350,
      qrValue: "MTS:PKG:PKG-2026-11-000777",
      photoUrls: [],
      createdAt: "2026-11-22T00:00:00.000Z"
    } as CargoPackage);
    await mutateAndFlush(service, () => service.createCustomer({ businessName: "Payer Co" }));
    expect(store.durable?.packages.map((pkg) => pkg.id)).toContain("pkg_fu1");

    store.failure = new Error("database unavailable");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const checkpoint = service.persistenceCheckpoint();
      service.recordPayment({ cargoPackageId: "pkg_fu1", method: "Cash", collectionPoint: "Delivery", amountPaid: 100 });
      await expect(service.flushPersistence(checkpoint)).rejects.toThrow(/Failed to persist logistics state/);
    } finally {
      errorSpy.mockRestore();
    }

    // The payment exists nowhere; the durable package survives intact.
    expect(internals(service).payments).toEqual([]);
    expect(internals(service).packages.map((pkg) => pkg.id)).toContain("pkg_fu1");
    expect(store.durable?.payments).toEqual([]);
    await service.onModuleDestroy();

    const reloaded = await bootFromStore(tempDir("mts-fu1-payment-reload-"), store);
    expect(internals(reloaded).payments).toEqual([]);
    expect(internals(reloaded).packages.map((pkg) => pkg.id)).toContain("pkg_fu1");
    await reloaded.onModuleDestroy();
  });
});

describe("flushPersistence — ordering and snapshot shape", () => {
  test("a slow save holds the flush until it resolves; the record is durable only then", async () => {
    const dir = tempDir("mts-fu1-slow-");
    const service = await bootService(dir);

    const store = new AsyncStoreDouble();
    internals(service).store = store;
    let releaseGate!: () => void;
    store.gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const checkpoint = service.persistenceCheckpoint();
    service.createCustomer({ businessName: "Slow Co" });
    let settled = false;
    const flushing = service.flushPersistence(checkpoint).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    // The answer is genuinely held: flush unsettled, nothing durable yet.
    expect(settled).toBe(false);
    expect(store.durable).toBeUndefined();

    releaseGate();
    await flushing;
    expect(settled).toBe(true);
    expect(store.durable?.customers.map((customer) => customer.businessName)).toContain("Slow Co");
    expect(customerNames(service)).toContain("Slow Co");
    await service.onModuleDestroy();
  });

  test("a queued save carries the state at its own call — later mutations do not leak into it", async () => {
    const dir = tempDir("mts-fu1-frozen-");
    const service = await bootService(dir);

    const store = new AsyncStoreDouble();
    internals(service).store = store;
    let releaseGate!: () => void;
    store.gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    // Mutation A queues its save behind the gate; mutation B lands while
    // A's save is still waiting (the discharge's burst shape).
    const checkpoint = service.persistenceCheckpoint();
    service.createCustomer({ businessName: "First Co" });
    service.createCustomer({ businessName: "Second Co" });
    releaseGate();
    await service.flushPersistence(checkpoint);

    // The first save's snapshot holds First Co only; the second holds
    // both. Pre-fix, both attempts received the live arrays and the first
    // save would have carried Second Co too.
    expect(store.attempts).toHaveLength(2);
    expect(store.attempts[0]?.customers.map((customer) => customer.businessName)).toContain("First Co");
    expect(store.attempts[0]?.customers.map((customer) => customer.businessName)).not.toContain("Second Co");
    expect(store.attempts[1]?.customers.map((customer) => customer.businessName)).toEqual(
      expect.arrayContaining(["First Co", "Second Co"])
    );
    await service.onModuleDestroy();
  });
});

describe("flushPersistence — healthy parity and the no-save free pass", () => {
  test("mutations flush cleanly and persist; a checkpoint with no new save never throws", async () => {
    const dir = tempDir("mts-fu1-healthy-");
    const service = await bootService(dir);

    const store = new AsyncStoreDouble();
    internals(service).store = store;

    await mutateAndFlush(service, () => service.createCustomer({ businessName: "Healthy Co" }));
    await mutateAndFlush(service, () => service.createExpense({ category: "Meals", amount: 75, description: "Crew meals" }));
    expect(customerNames(service)).toContain("Healthy Co");
    expect(store.durable?.customers.map((customer) => customer.businessName)).toContain("Healthy Co");
    expect(store.durable?.expenses.map((expense) => expense.amount)).toContain(75);

    // A request that queued no save (a read, a replay) pays nothing —
    // even if the store has since died, there is nothing of its own to
    // hold or to fail.
    store.failure = new Error("database unavailable");
    await expect(service.flushPersistence(service.persistenceCheckpoint())).resolves.toBeUndefined();
    await service.onModuleDestroy();
  });
});

describe("flushPersistence — idempotency across a failed save (PR-7c's rule at this layer)", () => {
  test("a keyed create whose flush fails records nothing; the same key after a restart applies exactly once", async () => {
    const dir = tempDir("mts-fu1-idem-");
    const service = await bootService(dir);

    const store = new AsyncStoreDouble();
    store.failure = new Error("database unavailable");
    internals(service).store = store;

    const input = { formState: { senderName: "FU-1 Sender" }, productLines: [], idempotencyKey: "fu1-draft-key" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const checkpoint = service.persistenceCheckpoint();
      service.createReceivingDraft(input);
      await expect(service.flushPersistence(checkpoint)).rejects.toThrow(/Failed to persist logistics state/);
    } finally {
      errorSpy.mockRestore();
    }

    // Neither the draft nor its idempotency record survived the rollback:
    // the failed attempt is not a stored success a retry would replay.
    expect(internals(service).receivingDrafts).toEqual([]);
    expect(internals(service).idempotencyRecords).toEqual([]);
    expect(store.durable).toBeUndefined();
    await service.onModuleDestroy();

    // Restart against a healthy store: the same key executes fresh…
    const healthy = new AsyncStoreDouble();
    healthy.durable = store.durable;
    const reloaded = await bootFromStore(tempDir("mts-fu1-idem-reload-"), healthy);
    const created = await mutateAndFlush(reloaded, () => reloaded.createReceivingDraft(input));
    expect(internals(reloaded).receivingDrafts).toHaveLength(1);

    // …and a replay of that key returns the stored result, applies
    // nothing twice, and queues no new save (PR-7c's pins, async path).
    const attemptsBefore = healthy.attempts.length;
    const replayed = await mutateAndFlush(reloaded, () => reloaded.createReceivingDraft(input));
    expect(replayed.id).toBe(created.id);
    expect(internals(reloaded).receivingDrafts).toHaveLength(1);
    expect(healthy.attempts).toHaveLength(attemptsBefore);
    await reloaded.onModuleDestroy();
  });
});

describe("HTTP boundary — the interceptor holds the response (real Nest app)", () => {
  const httpEmail = "fu1.admin@mts-smoke.test";
  const httpPassword = "fu1-throwaway-password";

  async function bootApp() {
    const dir = tempDir("mts-fu1-http-");
    process.env.INIT_CWD = dir;
    process.env.ALLOW_DEMO_AUTH = "true";
    process.env.SMOKE_EMAIL = httpEmail;
    process.env.SMOKE_PASSWORD = httpPassword;
    process.env.SMOKE_LIMITED_EMAIL = "fu1.limited@mts-smoke.test";
    process.env.SMOKE_LIMITED_PASSWORD = "fu1-throwaway-limited";
    const app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    const url = await app.getUrl();
    return { app, url };
  }

  async function login(url: string): Promise<string> {
    const response = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: httpEmail, password: httpPassword })
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { token: string };
    return body.token;
  }

  test(
    "POST against a failing store answers 500, not 201, and the record is never served",
    async () => {
      const { app, url } = await bootApp();
      try {
        const token = await login(url);
        const service = app.get(LogisticsService);
        const store = new AsyncStoreDouble();
        store.failure = new Error("database unavailable");
        internals(service).store = store;

        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        let response: Response;
        try {
          response = await fetch(`${url}/customers`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ businessName: "HTTP Phantom Co" })
          });
        } finally {
          errorSpy.mockRestore();
        }
        expect(response.status).toBe(500);
        const body = (await response.json()) as { message?: string };
        expect(body.message).toMatch(/Failed to persist logistics state/);

        // Reads serve memory — and memory was rolled back, so the
        // phantom is not readable either (the discharge's other half).
        const bootstrap = await fetch(`${url}/bootstrap`, { headers: { authorization: `Bearer ${token}` } });
        expect(bootstrap.status).toBe(200);
        expect(await bootstrap.text()).not.toContain("HTTP Phantom Co");
      } finally {
        await app.close();
      }
    },
    60_000
  );

  test(
    "POST against a healthy store answers 201 and the record is served and durable",
    async () => {
      const { app, url } = await bootApp();
      try {
        const token = await login(url);
        const service = app.get(LogisticsService);
        const store = new AsyncStoreDouble();
        internals(service).store = store;

        const response = await fetch(`${url}/customers`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ businessName: "HTTP Healthy Co" })
        });
        expect(response.status).toBe(201);

        const bootstrap = await fetch(`${url}/bootstrap`, { headers: { authorization: `Bearer ${token}` } });
        expect(bootstrap.status).toBe(200);
        expect(await bootstrap.text()).toContain("HTTP Healthy Co");
        expect(store.durable?.customers.map((customer) => customer.businessName)).toContain("HTTP Healthy Co");
      } finally {
        await app.close();
      }
    },
    60_000
  );
});
