import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type {
  CargoPackage,
  DeliveryRecord,
  ExpenseRecord,
  IdempotencyRecord,
  PaymentRecord,
  ReturnRecord
} from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 4 PR 2 — B1 idempotency end-to-end + B3 transition guards.
 *
 * B1: queueable write handlers accept an idempotency key (the web clients
 * send the offline queue record's id as the `Idempotency-Key` header — the
 * same key on the first online attempt and on every queued replay). The
 * first successful execution stores its result; a repeat with the same key
 * returns the stored result and re-executes nothing. Only successful
 * executions are recorded, so a validation failure does not burn the key.
 *
 * B3 (defense in depth, independent of keys): completing an already
 * Delivered package returns the existing delivery instead of a second
 * DeliveryRecord; failing a Delivered package is a conflict; failing an
 * already-Failed package returns the existing failure; a package can hold
 * only one open return request; a collection against an already fully paid
 * package is rejected unless it is a keyed replay (which B1 answers first).
 *
 * Each test builds a fresh LogisticsService against a throwaway INIT_CWD so
 * the JSON state store writes into a temp dir, not the repo's dev data.
 */

type ServiceInternals = {
  packages: CargoPackage[];
  payments: PaymentRecord[];
  deliveries: DeliveryRecord[];
  expenses: ExpenseRecord[];
  returnRecords: ReturnRecord[];
  idempotencyRecords: IdempotencyRecord[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const cargo: CargoPackage = {
  id: "pkg_phase4_pr2",
  packageNumber: "PKG-2026-11-000202",
  receivingRecordNumber: "RR-2026-11-000202",
  customerId: "cust_phase4_pr2",
  customerName: "Phase4 PR2 Fixture Customer",
  description: "Rice sacks",
  quantity: 2,
  unit: "sack",
  destination: "Daet",
  handlingBranchId: "daet",
  handlingBranchName: "Daet",
  deliveryType: "Door-to-door delivery",
  condition: "Good",
  status: "Out for Delivery",
  price: 350,
  qrValue: "MTS:PKG:PKG-2026-11-000202",
  photoUrls: [],
  createdAt: "2026-11-12T00:00:00.000Z"
};

function seededService() {
  const service = new LogisticsService();
  internals(service).packages.push({ ...cargo });
  return service;
}

const paymentInput = {
  cargoPackageId: cargo.id,
  amountPaid: 350,
  method: "Cash",
  collectionPoint: "Delivery" as const
};

const deliveryInput = {
  cargoPackageId: cargo.id,
  deliveredTo: "Fixture Receiver"
};

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-phase4-pr2-"));
  previousInitCwd = process.env.INIT_CWD;
  previousRepository = process.env.MTS_REPOSITORY;
  process.env.INIT_CWD = tempRoot;
  delete process.env.MTS_REPOSITORY;
});

afterAll(() => {
  if (previousInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = previousInitCwd;
  if (previousRepository === undefined) delete process.env.MTS_REPOSITORY;
  else process.env.MTS_REPOSITORY = previousRepository;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("B1 — idempotency keys", () => {
  test("same key submitted twice records one payment and returns the original result", () => {
    const service = seededService();

    const first = service.recordPayment({ ...paymentInput, idempotencyKey: "queue_1730000000000_pay1" });
    const second = service.recordPayment({ ...paymentInput, idempotencyKey: "queue_1730000000000_pay1" });

    expect(internals(service).payments).toHaveLength(1);
    expect(second).toEqual(first);
    expect(second.id).toBe(first.id);
    expect(second).not.toBe(first);
    expect(internals(service).idempotencyRecords).toHaveLength(1);
    expect(internals(service).idempotencyRecords[0]).toMatchObject({
      key: "queue_1730000000000_pay1",
      endpoint: "POST /payments"
    });
  });

  test("queued replay simulation: submit, response lost, retry with the queue key applies nothing twice", () => {
    const service = seededService();
    const queueKey = "queue_1730000001234_replay";

    // The client enqueues the delivery completion offline (record id =
    // queueKey), comes back online and submits; the write commits but the
    // response is lost in transit, so the queue keeps the record and the
    // replayer submits it again with the same key.
    const first = service.completeDelivery({ ...deliveryInput, idempotencyKey: queueKey });
    const replayed = service.completeDelivery({ ...deliveryInput, idempotencyKey: queueKey });

    expect(replayed).toEqual(first);
    expect(internals(service).deliveries).toHaveLength(1);
    expect(internals(service).packages[0]?.status).toBe("Delivered");

    // Same story for the payment collected at the door.
    const payKey = "queue_1730000001234_pay";
    const payment = service.recordPayment({ ...paymentInput, idempotencyKey: payKey });
    const paymentReplay = service.recordPayment({ ...paymentInput, idempotencyKey: payKey });
    expect(paymentReplay).toEqual(payment);
    expect(internals(service).payments).toHaveLength(1);
  });

  test("the same key value on different endpoints does not collide", () => {
    const service = seededService();
    const sharedKey = "shared-key-value";

    // P6-5: Fuel now requires a trip link; the sample expense here uses
    // a non-trip category — what is being proven is the key, not the category.
    service.createExpense({ category: "Meals", amount: 500, idempotencyKey: sharedKey });
    service.recordPayment({ ...paymentInput, amountPaid: 100, idempotencyKey: sharedKey });

    expect(internals(service).expenses).toHaveLength(1);
    expect(internals(service).payments).toHaveLength(1);
    expect(internals(service).idempotencyRecords).toHaveLength(2);
  });

  test("expense with the same key twice records one expense", () => {
    const service = seededService();

    const first = service.createExpense({ category: "Meals", amount: 500, idempotencyKey: "queue_exp_1" });
    const second = service.createExpense({ category: "Meals", amount: 500, idempotencyKey: "queue_exp_1" });

    expect(second).toEqual(first);
    expect(internals(service).expenses).toHaveLength(1);
  });

  test("a failed execution does not burn the key — the corrected retry succeeds", () => {
    const service = seededService();
    const key = "queue_1730000009999_fixme";

    expect(() =>
      service.recordPayment({ ...paymentInput, proofUrl: "local-photo://local-photo-1", idempotencyKey: key })
    ).toThrow(/local-photo/);
    expect(internals(service).idempotencyRecords).toHaveLength(0);

    const fixed = service.recordPayment({ ...paymentInput, proofUrl: "/uploads/proof.jpg", idempotencyKey: key });
    expect(fixed.status).toBe("Paid");
    expect(internals(service).payments).toHaveLength(1);
  });

  test("submissions without a key keep working (one execution per call)", () => {
    const service = seededService();

    service.createExpense({ category: "Meals", amount: 100 });
    service.createExpense({ category: "Meals", amount: 100 });

    expect(internals(service).expenses).toHaveLength(2);
    expect(internals(service).idempotencyRecords).toHaveLength(0);
  });
});

describe("B3 — transition guards", () => {
  test("double completeDelivery under different keys still yields exactly one DeliveryRecord", () => {
    const service = seededService();

    const first = service.completeDelivery({ ...deliveryInput, idempotencyKey: "key-first" });
    const second = service.completeDelivery({ ...deliveryInput, idempotencyKey: "key-second" });
    const third = service.completeDelivery({ ...deliveryInput });

    expect(internals(service).deliveries).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(internals(service).packages[0]?.status).toBe("Delivered");
  });

  test("payment against a fully paid package is rejected without a replay key — and with a fresh one", () => {
    const service = seededService();
    service.recordPayment({ ...paymentInput, idempotencyKey: "queue_full_1" });

    expect(() => service.recordPayment({ ...paymentInput })).toThrow(/already fully collected/);
    expect(() => service.recordPayment({ ...paymentInput, idempotencyKey: "queue_some_other_key" })).toThrow(
      /already fully collected/
    );
    expect(internals(service).payments).toHaveLength(1);

    // The keyed replay of the original collection still returns it.
    const replay = service.recordPayment({ ...paymentInput, idempotencyKey: "queue_full_1" });
    expect(replay.amountPaid).toBe(350);
    expect(internals(service).payments).toHaveLength(1);
  });

  test("partial payments stay open until the balance is covered, then close", () => {
    const service = seededService();

    const partial = service.recordPayment({ ...paymentInput, amountPaid: 200, idempotencyKey: "queue_part_1" });
    expect(partial.status).toBe("Partially Paid");
    // The completing collection is allowed: cumulative collected (200) is
    // still below the amount due (350) when it is submitted.
    service.recordPayment({ ...paymentInput, amountPaid: 150, idempotencyKey: "queue_part_2" });
    expect(internals(service).payments).toHaveLength(2);
    expect(internals(service).payments.reduce((sum, payment) => sum + payment.amountPaid, 0)).toBe(350);

    expect(() => service.recordPayment({ ...paymentInput, amountPaid: 50 })).toThrow(/already fully collected/);
    expect(internals(service).payments).toHaveLength(2);
  });

  test("failDelivery: same key replays once, a second key returns the open failure, Delivered is a conflict", () => {
    const service = seededService();
    const failInput = {
      cargoPackageId: cargo.id,
      failedReason: "Customer Not Available",
      nextAction: "Reschedule"
    };

    const first = service.failDelivery({ ...failInput, idempotencyKey: "queue_fail_1" });
    const replay = service.failDelivery({ ...failInput, idempotencyKey: "queue_fail_1" });
    const secondKey = service.failDelivery({ ...failInput, idempotencyKey: "queue_fail_2" });

    expect(replay).toEqual(first);
    expect(secondKey.id).toBe(first.id);
    expect(internals(service).deliveries).toHaveLength(1);
    expect(internals(service).packages[0]?.status).toBe("Failed Delivery");

    const deliveredService = seededService();
    deliveredService.completeDelivery({ ...deliveryInput });
    expect(() => deliveredService.failDelivery({ ...failInput })).toThrow(/already delivered/);
    expect(internals(deliveredService).deliveries).toHaveLength(1);
  });

  test("a duplicate return request returns the open return instead of stacking a second one", () => {
    const service = seededService();
    const returnInput = {
      cargoPackageId: cargo.id,
      reason: "Wrong item",
      nextAction: "Return to sender" as const
    };

    const first = service.createReturnRecord({ ...returnInput, idempotencyKey: "queue_ret_1" });
    const duplicate = service.createReturnRecord({ ...returnInput, idempotencyKey: "queue_ret_2" });

    expect(duplicate.id).toBe(first.id);
    expect(internals(service).returnRecords).toHaveLength(1);
  });
});

describe("B1 storage — Prisma mapping round-trip", () => {
  test("idempotency records survive stateToRows → rowsToState with result and timestamp intact", () => {
    const record: IdempotencyRecord = {
      id: "idem_rt_1",
      key: "queue_1730000000000_rt",
      endpoint: "POST /payments",
      result: { id: "pay_rt", amountPaid: 350, status: "Paid", nested: { ok: true } },
      createdAt: "2026-11-12T01:02:03.000Z"
    };
    const state = {
      sequences: [],
      customers: [],
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
      idempotencyRecords: [record],
      companyProfile: {
        companyName: "Mancenido Trucking Services",
        address: "Configured by owner",
        phone: "Configured by owner",
        email: "Configured by owner"
      },
      branches: [],
      paymentMethods: [],
      expenseCategories: [],
    } as unknown as ServiceState;

    const rows = stateToRows(state);
    expect(rows.idempotencyKeys).toHaveLength(1);
    expect(rows.idempotencyKeys[0]).toMatchObject({ id: "idem_rt_1", key: record.key, endpoint: "POST /payments" });
    expect(rows.idempotencyKeys[0]?.createdAt).toBeInstanceOf(Date);

    const restored = rowsToState(rows);
    expect(restored.idempotencyRecords).toEqual([record]);
  });
});
