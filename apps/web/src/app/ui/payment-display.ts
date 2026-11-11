import type { CargoPackage, PaymentRecord } from "./types";

/**
 * Payment display helpers (Phase 6 P6-2 — the §2.3.1 honest-balance fix).
 *
 * The stored `PaymentRecord.balance` is a HISTORICAL PER-CALL value:
 * `recordPayment` computes it from that one payment alone
 * (max(amountDue − amountPaid, 0)), so for a package paid in two
 * instalments the second payment's stored balance can be HIGHER than
 * the first's — it is not a remaining balance and must never be
 * displayed as one. What a person means by "balance" is cumulative:
 * the package price minus ALL payments recorded for that package —
 * the same arithmetic the package read model (packageBalance) uses.
 * These helpers exist so every display surface (global search, payment
 * history, receipts) computes it one way. The stored field stays in
 * the data; only its presentation changes.
 */

/** Total actually paid toward one package across all its payments. */
export function paidTotalForPackage(payments: PaymentRecord[], packageId: string): number {
  return payments
    .filter((payment) => payment.cargoPackageId === packageId)
    .reduce((sum, payment) => sum + payment.amountPaid, 0);
}

/** The real remaining balance of a package: price minus all payments. */
export function remainingBalanceForPackage(pkg: CargoPackage, payments: PaymentRecord[]): number {
  return Math.max(Number(pkg.price ?? 0) - paidTotalForPackage(payments, pkg.id), 0);
}

/**
 * The `details` line for a payment in global search. Shows the
 * cumulative remaining balance of the payment's package — never the
 * stored per-call value. When the package is unknown or out of the
 * caller's scope there is nothing honest to compute, so the stored
 * per-call value is shown as the last resort it is.
 */
export function paymentSearchDetails(
  payment: PaymentRecord,
  pkg: CargoPackage | undefined,
  payments: PaymentRecord[]
): string {
  const balance = pkg ? remainingBalanceForPackage(pkg, payments) : payment.balance;
  return `${payment.method} - paid PHP ${payment.amountPaid.toLocaleString()} - balance PHP ${balance.toLocaleString()}`;
}
