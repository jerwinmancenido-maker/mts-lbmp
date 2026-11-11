import type { OfflineQueueRecord } from "./cache";

/**
 * Phase 4 A7: per-item view models for the offline action queue, plus the
 * single-record sync attempt shared by the Device Setup queue list's Retry
 * action. Pure logic only — IndexedDB and HTTP access are injected by the
 * caller — so the derivation and the retry semantics are unit-testable.
 */

/**
 * Auto-replay stops after this many attempts. A Failed record that reaches
 * the cap is "parked": it stays visible in the Device Setup queue list with
 * its last error until staff retry it by hand or discard it, instead of
 * being retried on every sync trigger forever.
 */
export const OFFLINE_QUEUE_MAX_AUTO_ATTEMPTS = 5;

export type QueueItemView = {
  id: string;
  /** Human label for what the queued action is, e.g. "Payment collection". */
  label: string;
  /** Target/record detail, e.g. a DR number, draft path, or amount. */
  detail: string;
  status: OfflineQueueRecord["status"];
  statusLabel: string;
  /** Relative age of the record, e.g. "5m ago". */
  ageLabel: string;
  attempts: number;
  lastError?: string;
  /** True when the record is parked after too many failed auto attempts. */
  parked: boolean;
  canRetry: boolean;
  canDiscard: boolean;
  createdAt: string;
};

function bodyField(body: unknown, field: string): unknown {
  if (body && typeof body === "object" && field in body) {
    return (body as Record<string, unknown>)[field];
  }
  return undefined;
}

function bodyText(body: unknown, field: string): string {
  const value = bodyField(body, field);
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function describeQueueRecord(record: OfflineQueueRecord): { label: string; detail: string } {
  const path = record.path;
  let label: string;
  if (record.type === "payment") {
    label = "Payment collection";
  } else if (record.type === "expense") {
    label = "Expense record";
  } else if (record.type === "photo") {
    label = path.includes("loading-photo") ? "Trip loading photo" : "DR photo attachment";
  } else if (record.type === "delivery") {
    if (path.startsWith("/returns")) label = "Return record";
    else if (path.startsWith("/deliveries/complete")) label = "Delivery completed";
    else if (path.startsWith("/deliveries/fail")) label = "Delivery failed attempt";
    else label = "Delivery update";
  } else if (record.type === "receivingDraft") {
    label = record.method === "PATCH" ? "Receiving draft update" : "Receiving draft (new)";
  } else {
    label = "Queued action";
  }

  const detailParts: string[] = [];
  const drNumber = bodyText(record.body, "customerDrNumber");
  if (drNumber) detailParts.push(`DR ${drNumber}`);
  const amount = bodyField(record.body, "amountPaid") ?? bodyField(record.body, "amount");
  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
    detailParts.push(`PHP ${amount.toLocaleString()}`);
  } else if (typeof amount === "string" && amount.trim()) {
    detailParts.push(`PHP ${amount.trim()}`);
  }
  const category = bodyText(record.body, "category");
  if (category) detailParts.push(category);
  if (!detailParts.length) detailParts.push(path);
  return { label, detail: detailParts.join(" · ") };
}

export function formatQueueAge(createdAtIso: string, now: Date = new Date()): string {
  const createdMs = new Date(createdAtIso).getTime();
  if (!Number.isFinite(createdMs)) return "unknown age";
  const diffMs = Math.max(0, now.getTime() - createdMs);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function shouldAutoRetryQueueRecord(record: OfflineQueueRecord): boolean {
  if (record.status === "Pending") return true;
  if (record.status === "Failed") return record.attempts < OFFLINE_QUEUE_MAX_AUTO_ATTEMPTS;
  return false;
}

export function queueItemView(record: OfflineQueueRecord, now: Date = new Date()): QueueItemView {
  const { label, detail } = describeQueueRecord(record);
  const parked = record.status === "Failed" && !shouldAutoRetryQueueRecord(record);
  const statusLabel =
    record.status === "Failed"
      ? parked
        ? "Failed — needs attention"
        : "Failed"
      : record.status;
  return {
    id: record.id,
    label,
    detail,
    status: record.status,
    statusLabel,
    ageLabel: formatQueueAge(record.createdAt, now),
    attempts: record.attempts,
    lastError: record.lastError,
    parked,
    canRetry: record.status === "Pending" || record.status === "Failed",
    canDiscard: record.status !== "Syncing",
    createdAt: record.createdAt
  };
}

/** Failed items first (they need attention), then oldest pending first. */
export function sortQueueItemViews(views: QueueItemView[]): QueueItemView[] {
  const rank = (view: QueueItemView) => (view.status === "Failed" ? 0 : view.status === "Syncing" ? 1 : view.status === "Pending" ? 2 : 3);
  return [...views].sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
}

export type QueueRecordSender = (
  method: OfflineQueueRecord["method"],
  path: string,
  body: unknown,
  idempotencyKey: string
) => Promise<unknown>;

/**
 * One sync attempt for one queue record. The record's id is sent as the
 * idempotency key — the same key the original attempt and every replay use
 * (Phase 4 B1) — so a manual retry after a lost response returns the
 * server's original result instead of applying the action twice. Returns
 * the updated record; the caller persists it.
 */
export async function attemptQueueRecordSync(record: OfflineQueueRecord, send: QueueRecordSender): Promise<OfflineQueueRecord> {
  const attempted: OfflineQueueRecord = { ...record, status: "Syncing", attempts: record.attempts + 1, lastError: undefined };
  try {
    await send(record.method, record.path, record.body, record.id);
    return { ...attempted, status: "Synced" };
  } catch (error) {
    return {
      ...attempted,
      status: "Failed",
      lastError: error instanceof Error ? error.message : "Sync failed"
    };
  }
}
