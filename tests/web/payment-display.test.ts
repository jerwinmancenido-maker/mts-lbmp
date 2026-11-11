import { describe, expect, test } from "vitest";
import {
  paidTotalForPackage,
  paymentSearchDetails,
  remainingBalanceForPackage
} from "../../apps/web/src/app/ui/payment-display";
import type { CargoPackage, PaymentRecord } from "../../apps/web/src/app/ui/types";

/**
 * Phase 6 P6-2 — the §2.3.1 honest-balance display fix.
 *
 * A package priced PHP 1,000 paid in two instalments (400, then 300):
 * the SECOND payment's stored per-call balance is 700 (computed from
 * that call alone: 1000 − 300) — HIGHER than the first payment's 600 —
 * while the real remaining balance is 300. Search and history surfaces
 * must show 300; the stored field stays untouched as history.
 */

const pkg: CargoPackage = {
  id: "pkg_display_1",
  packageNumber: "PKG-2026-11-000001",
  receivingRecordNumber: "RR-2026-11-000001",
  customerName: "Display Fixture Customer",
  description: "Rebar",
  destination: "Daet",
  condition: "Good",
  status: "Delivered",
  price: 1000,
  qrValue: "MTS:PKG:PKG-2026-11-000001",
  createdAt: "2026-11-01T00:00:00.000Z"
};

function makePayment(overrides: Partial<PaymentRecord>): PaymentRecord {
  return {
    id: "pay_display_x",
    cargoPackageId: pkg.id,
    amountDue: 1000,
    amountPaid: 0,
    balance: 0,
    method: "Cash",
    status: "Partially Paid",
    createdAt: "2026-11-10T00:00:00.000Z",
    ...overrides
  };
}

const firstPayment = makePayment({ id: "pay_display_1", amountPaid: 400, balance: 600 });
const secondPayment = makePayment({ id: "pay_display_2", amountPaid: 300, balance: 700 });
const payments = [firstPayment, secondPayment];

describe("payment display helpers", () => {
  test("cumulative paid total and remaining balance span all payments", () => {
    expect(paidTotalForPackage(payments, pkg.id)).toBe(700);
    expect(remainingBalanceForPackage(pkg, payments)).toBe(300);
  });

  test("search details for the second instalment show the cumulative 300, not the stored per-call 700", () => {
    const details = paymentSearchDetails(secondPayment, pkg, payments);
    expect(details).toBe("Cash - paid PHP 300 - balance PHP 300");
    expect(details).not.toContain("700");
    // The first instalment shows the same cumulative remaining balance.
    expect(paymentSearchDetails(firstPayment, pkg, payments)).toBe("Cash - paid PHP 400 - balance PHP 300");
  });

  test("a fully paid package shows balance PHP 0", () => {
    const finalPayment = makePayment({ id: "pay_display_3", amountPaid: 300, balance: 700 });
    expect(paymentSearchDetails(finalPayment, pkg, [...payments, finalPayment])).toBe("Cash - paid PHP 300 - balance PHP 0");
  });

  test("unknown package falls back to the stored per-call value (nothing honest to compute)", () => {
    expect(paymentSearchDetails(secondPayment, undefined, payments)).toBe("Cash - paid PHP 300 - balance PHP 700");
  });
});
