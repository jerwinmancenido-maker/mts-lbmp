import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type { CargoPackage, PaymentRecord } from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 PR-2 — C-M1 payment validation.
 *
 * Before this fix the payment-recording path validated nothing: ₱0 and
 * ₱−100 payments were recorded verbatim (L6-F1 / L6 E3a — the negative
 * payment inflated the package's stored balance), a single ₱500 was
 * recorded against ₱350 due and ₱200 + ₱200 collected ₱400 (L2 F-L2-2 /
 * W3a, W3b), and two simultaneous ₱300 partials collected ₱600 against
 * ₱350 (L21 F21-3). The only guard was the B3 duplicate-collection
 * refusal, which engages only after the balance is already met.
 *
 * The fix lives in recordPaymentOnce, the single choke point every
 * payment recording funnels through: amount must be positive, and a
 * payment may not take the package's collected total past its amount
 * due. Check and record happen in the same synchronous turn, so
 * simultaneous payments cannot both pass. The one deliberate exception
 * is the receiving-counter "Advance Payment" distribution (B4), which
 * parks its excess on the first package through a separate internal
 * entry — it is pinned by offline-finalize-trips.test.ts and is not
 * reachable through the public path proven here.
 *
 * Each test builds a fresh LogisticsService against a throwaway
 * INIT_CWD so the JSON state store writes into a temp dir.
 */

type ServiceInternals = {
  packages: CargoPackage[];
  payments: PaymentRecord[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const cargo: CargoPackage = {
  id: "pkg_round1_pr2",
  packageNumber: "PKG-2026-11-000350",
  receivingRecordNumber: "RR-2026-11-000350",
  customerId: "cust_round1_pr2",
  customerName: "Round1 PR2 Fixture Customer",
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
  qrValue: "MTS:PKG:PKG-2026-11-000350",
  photoUrls: [],
  createdAt: "2026-11-12T00:00:00.000Z"
};

function seededService(price = 350) {
  const service = new LogisticsService();
  internals(service).packages.push({ ...cargo, price });
  return service;
}

const paymentInput = {
  cargoPackageId: cargo.id,
  method: "Cash",
  collectionPoint: "Delivery" as const
};

function collected(service: LogisticsService) {
  return internals(service).payments.reduce((sum, payment) => sum + payment.amountPaid, 0);
}

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-round1-pr2-"));
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

describe("C-M1 — non-positive payment amounts are refused (L6 E3a)", () => {
  test("a ₱0 payment is refused and creates no record", () => {
    const service = seededService();
    expect(() => service.recordPayment({ ...paymentInput, amountPaid: 0 })).toThrow(/greater than zero/);
    expect(internals(service).payments).toHaveLength(0);
  });

  test("a ₱−100 payment is refused and creates no record (it used to inflate the balance)", () => {
    const service = seededService();
    expect(() => service.recordPayment({ ...paymentInput, amountPaid: -100 })).toThrow(/greater than zero/);
    expect(internals(service).payments).toHaveLength(0);
    expect(collected(service)).toBe(0);
  });

  test("a NaN payment amount is refused and creates no record", () => {
    const service = seededService();
    expect(() => service.recordPayment({ ...paymentInput, amountPaid: Number.NaN })).toThrow(/greater than zero/);
    expect(internals(service).payments).toHaveLength(0);
  });
});

describe("C-M1 — payments are capped at the remaining balance (L2 W3a/W3b)", () => {
  test("a single overpayment (₱500 against ₱350 due) is refused and creates no record", () => {
    const service = seededService();
    expect(() => service.recordPayment({ ...paymentInput, amountPaid: 500 })).toThrow(/exceeds the remaining balance/);
    expect(internals(service).payments).toHaveLength(0);
  });

  test("the partial that would cross the cap is refused; earlier valid partials are untouched", () => {
    const service = seededService();
    const first = service.recordPayment({ ...paymentInput, amountPaid: 200 });
    expect(first.status).toBe("Partially Paid");

    // ₱200 + ₱200 would collect ₱400 against ₱350 due — refused whole,
    // never trimmed, and the valid first partial stays as recorded.
    expect(() => service.recordPayment({ ...paymentInput, amountPaid: 200 })).toThrow(/exceeds the remaining balance/);
    expect(internals(service).payments).toHaveLength(1);
    expect(collected(service)).toBe(200);

    // The exact remainder is still accepted and completes the package.
    service.recordPayment({ ...paymentInput, amountPaid: 150 });
    expect(internals(service).payments).toHaveLength(2);
    expect(collected(service)).toBe(350);
  });

  test("a payment exactly equal to the amount due succeeds and reads Paid", () => {
    const service = seededService();
    const payment = service.recordPayment({ ...paymentInput, amountPaid: 350 });
    expect(payment.status).toBe("Paid");
    expect(collected(service)).toBe(350);
  });

  test("centavo amounts that sum exactly to the due amount are not refused on float dust", () => {
    const service = seededService(100.1);
    service.recordPayment({ ...paymentInput, amountPaid: 60.05 });
    service.recordPayment({ ...paymentInput, amountPaid: 40.05 });
    expect(collected(service)).toBeCloseTo(100.1, 2);
    expect(internals(service).payments).toHaveLength(2);
  });

  test("one centavo over the remaining balance is still refused", () => {
    const service = seededService();
    service.recordPayment({ ...paymentInput, amountPaid: 200 });
    expect(() => service.recordPayment({ ...paymentInput, amountPaid: 150.01 })).toThrow(/exceeds the remaining balance/);
    expect(collected(service)).toBe(200);
  });
});

describe("C-M1 — simultaneous payments cannot over-collect (L21 F21-3)", () => {
  test("two ₱300 partials dispatched together against ₱350 due: exactly one lands, collected never exceeds due", () => {
    const service = seededService();
    // Two staff tablets dispatch at the same moment. Each mutation runs
    // its check-and-record in one synchronous turn, so the second call
    // re-reads the payments list with the first collection already on it
    // and is refused at the cap — the outcome the L21 race never got.
    const attempt = (amountPaid: number) => {
      try {
        return { ok: true as const, payment: service.recordPayment({ ...paymentInput, amountPaid }) };
      } catch (error) {
        return { ok: false as const, error };
      }
    };
    const outcomes = [attempt(300), attempt(300)];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(1);
    expect(collected(service)).toBe(300);
    expect(collected(service)).toBeLessThanOrEqual(350);
  });
});

describe("C-M1 — behaviour that must not change", () => {
  test("after the completing payment the B3 fully-collected guard still refuses further payments", () => {
    const service = seededService();
    service.recordPayment({ ...paymentInput, amountPaid: 200 });
    service.recordPayment({ ...paymentInput, amountPaid: 150 });
    expect(() => service.recordPayment({ ...paymentInput, amountPaid: 50 })).toThrow(/already fully collected/);
    expect(internals(service).payments).toHaveLength(2);
    expect(collected(service)).toBe(350);
  });

  test("a refused overpayment does not burn its idempotency key — the corrected retry succeeds", () => {
    const service = seededService();
    expect(() => service.recordPayment({ ...paymentInput, amountPaid: 500, idempotencyKey: "queue_pay_retry" })).toThrow(
      /exceeds the remaining balance/
    );
    const corrected = service.recordPayment({ ...paymentInput, amountPaid: 350, idempotencyKey: "queue_pay_retry" });
    expect(corrected.amountPaid).toBe(350);
    expect(internals(service).payments).toHaveLength(1);
  });
});
