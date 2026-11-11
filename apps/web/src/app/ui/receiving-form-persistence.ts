import { deleteCachedValue, readCachedValue, writeCachedValue } from "./cache";

/**
 * Phase 4 A3: crash/reload guard for the in-progress receiving form.
 *
 * The receiving form's authoritative serialization already exists — the
 * draft payload built by `buildDraftPayload` in app-shell (the same
 * `formState` + `productLines` a server draft stores). This module persists
 * that payload to the app's existing IndexedDB cache store (via cache.ts)
 * as the staff member types, so a reload, tab close, or app kill no longer
 * evaporates receiving work that was never saved as a server draft.
 *
 * The storage seam is injected (`ReceivingFormStore`) so the round-trip is
 * unit-testable without IndexedDB; production uses the cache-backed store.
 */

export type ReceivingFormSnapshotPayload = {
  customerId?: string;
  customerDrNumber?: string;
  destination?: string;
  drPhotoUrl?: string;
  formState: Record<string, unknown>;
  productLines: unknown[];
};

export interface ReceivingFormSnapshot {
  version: 1;
  savedAt: string;
  /** Server draft id when the form is editing a saved draft, else "". */
  activeDraftId: string;
  activeDraftNumber: string;
  payload: ReceivingFormSnapshotPayload;
}

export interface ReceivingFormStore {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export const cacheReceivingFormStore: ReceivingFormStore = {
  read: (key) => readCachedValue(key),
  write: (key, value) => writeCachedValue(key, value),
  remove: (key) => deleteCachedValue(key)
};

export function receivingFormStorageKey(userId: string): string {
  return `receiving-form:${userId || "unknown-user"}`;
}

const CONTENT_FIELDS = [
  "selectedCustomerId",
  "customerQuery",
  "pendingCustomerName",
  "pendingContactPerson",
  "pendingCustomerPhone",
  "customerDrNumber",
  "senderName",
  "senderPhone",
  "senderCompany",
  "description",
  "consigneeName",
  "deliveryBusinessName",
  "addressLine",
  "barangay",
  "city",
  "province",
  "deliveryPhone",
  "deliveryNotes",
  "price",
  "barcode",
  "productSku",
  "drPhotoUrl",
  "receivingAmountPaid",
  "receivingPaymentReference",
  "receivingPaymentProofUrl",
  "receivingPaymentNotes"
] as const;

/**
 * True when the form holds work worth guarding. Default-valued fields
 * (quantity "1", unit "pcs", branch, condition…) do not count — an untouched
 * form must not resurrect as a "restored draft".
 */
export function receivingFormHasContent(payload: ReceivingFormSnapshotPayload): boolean {
  if (payload.productLines.length > 0) return true;
  const formState = payload.formState ?? {};
  return CONTENT_FIELDS.some((field) => {
    const value = formState[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function parseReceivingFormSnapshot(value: unknown): ReceivingFormSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ReceivingFormSnapshot>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.savedAt !== "string" || !candidate.savedAt) return null;
  const payload = candidate.payload as Partial<ReceivingFormSnapshotPayload> | undefined;
  if (!payload || typeof payload !== "object") return null;
  if (!payload.formState || typeof payload.formState !== "object" || Array.isArray(payload.formState)) return null;
  if (!Array.isArray(payload.productLines)) return null;
  return {
    version: 1,
    savedAt: candidate.savedAt,
    activeDraftId: typeof candidate.activeDraftId === "string" ? candidate.activeDraftId : "",
    activeDraftNumber: typeof candidate.activeDraftNumber === "string" ? candidate.activeDraftNumber : "",
    payload: {
      customerId: payload.customerId,
      customerDrNumber: payload.customerDrNumber,
      destination: payload.destination,
      drPhotoUrl: payload.drPhotoUrl,
      formState: payload.formState as Record<string, unknown>,
      productLines: payload.productLines
    }
  };
}

export async function saveReceivingFormSnapshot(
  store: ReceivingFormStore,
  userId: string,
  snapshot: ReceivingFormSnapshot
): Promise<void> {
  await store.write(receivingFormStorageKey(userId), snapshot);
}

export async function loadReceivingFormSnapshot(
  store: ReceivingFormStore,
  userId: string
): Promise<ReceivingFormSnapshot | null> {
  const raw = await store.read<unknown>(receivingFormStorageKey(userId));
  const snapshot = parseReceivingFormSnapshot(raw);
  if (!snapshot) return null;
  return receivingFormHasContent(snapshot.payload) ? snapshot : null;
}

export async function clearReceivingFormSnapshot(store: ReceivingFormStore, userId: string): Promise<void> {
  await store.remove(receivingFormStorageKey(userId));
}
