import type { CargoStatus, PackageCondition, PaymentStatus, TripStatus } from "@mts-lbmp/shared";

export interface CustomerContact {
  id: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  address?: string;
  billingAddress?: string;
  shippingAddress?: string;
  isPrimary: boolean;
  status: "Active" | "Inactive";
  notes?: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  businessName: string;
  status: "Pending" | "Active" | "Archived";
  tin?: string;
  companyPhone?: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  billingAddress?: string;
  shippingAddress?: string;
  contacts?: CustomerContact[];
  billingTerm: string;
  /**
   * Phase 6 P6-1: the structured billing term — a day count from the fixed
   * BILLING_TERM_OPTIONS list (due-on-delivery / Net 7 / 15 / 30). This is
   * the value due dates and (from P6-2) aging are computed from. The
   * free-text `billingTerm` above stays as a display note only and is never
   * parsed for dates. Null/absent = no structured term set, so invoices
   * for the customer carry no due date and can never derive "Overdue".
   */
  billingTermDays?: number | null;
  notes?: string;
  createdFromReceivingId?: string;
  finalizedAt?: string;
  finalizedBy?: string;
}

export interface CompanyProfile {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  logoUrl?: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string;
  canReceive: boolean;
  canDispatch: boolean;
  canDeliver: boolean;
  canReturn: boolean;
  canStage: boolean;
  status: "Active" | "Inactive";
}

export interface ProductMaster {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  brand?: string;
  category?: string;
  defaultUnit: string;
  defaultPrice?: number | null;
  notes?: string;
  photoUrl?: string;
  status: "Active" | "Archived";
  createdAt: string;
}

export interface HardwareTestRecord {
  id: string;
  deviceName: string;
  scannerResult: "Pass" | "Fail" | "Not Tested";
  printerResult: "Pass" | "Fail" | "Not Tested";
  cameraResult: "Pass" | "Fail" | "Not Tested";
  signatureResult: "Pass" | "Fail" | "Not Tested";
  pwaResult: "Pass" | "Fail" | "Not Tested";
  notes?: string;
  createdAt: string;
}

export interface CargoPackage {
  id: string;
  packageNumber: string;
  receivingRecordNumber: string;
  customerId: string;
  customerName: string;
  productId: string;
  productBarcode?: string;
  description: string;
  quantity: number;
  unit: string;
  destination: string;
  handlingBranchId: string;
  handlingBranchName: string;
  deliveryType: "Deliver to consignee" | "Customer pickup at branch" | "Hold at branch" | "Return cargo";
  consigneeName?: string;
  deliveryBusinessName?: string;
  addressLine?: string;
  barangay?: string;
  city?: string;
  province?: string;
  landmark?: string;
  deliveryPhone?: string;
  deliveryNotes?: string;
  condition: PackageCondition;
  conditionNotes?: string;
  status: CargoStatus;
  unitPrice?: number | null;
  price: number | null;
  priceChangeReason?: string;
  weight?: number | null;
  weightUnit?: string;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  dimensionUnit?: string;
  qrValue: string;
  photoUrls: string[];
  createdAt: string;
}

export interface ReceivingRecord {
  id: string;
  recordNumber: string;
  customerId: string;
  customerName: string;
  customerDrNumber?: string;
  sender?: string;
  consignee?: string;
  destination: string;
  drPhotoUrl?: string;
  drPhotoAttachedAt?: string;
  drPhotoAttachReason?: string;
  packages: CargoPackage[];
  createdAt: string;
}

export interface ReceivingDraft {
  id: string;
  draftNumber: string;
  status: "Draft" | "Finalized" | "Cancelled";
  customerId?: string;
  customerNameSnapshot?: string;
  customerStatusSnapshot?: Customer["status"];
  customerDrNumber?: string;
  destination?: string;
  drPhotoUrl?: string;
  formState: Record<string, unknown>;
  productLines: Array<Record<string, unknown>>;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  finalizedReceivingId?: string;
}

/**
 * The normalized payload of one duplicate wall-QR intake submission, kept on
 * the surviving task's duplicateNotes so a merged duplicate never silently
 * discards item/quantity/consignee data (Phase 4 audit B5).
 */
export interface ReceivingIntakeDuplicateSubmission {
  customerName?: string;
  customerDrNumber?: string;
  dropOffPerson?: string;
  dropOffPhone?: string;
  consigneeName?: string;
  destinationBranch?: string;
  deliveryArea?: string;
  itemDescription?: string;
  quantity?: number;
  unit?: string;
}

export interface ReceivingIntakeDuplicateNote {
  id: string;
  note?: string;
  photoUrl?: string;
  /** Set when the duplicate's DR photo is still queued on the device; cleared and replaced by photoUrl when the queued photo uploads and resolves. */
  photoLocalId?: string;
  submission?: ReceivingIntakeDuplicateSubmission;
  createdAt: string;
}

export interface ReceivingIntakeTask {
  id: string;
  intakeNumber: string;
  status: "Pending Review" | "In Review" | "Converted" | "Cancelled";
  source: "Wall QR";
  warehouseCode: string;
  duplicateKey: string;
  duplicateCount: number;
  customerId?: string;
  customerNameTyped: string;
  customerMatched: boolean;
  customerDrNumber?: string;
  dropOffPerson?: string;
  dropOffPhone?: string;
  consigneeName?: string;
  receiverMatched: boolean;
  destinationBranch?: string;
  deliveryArea?: string;
  productId?: string;
  productMatched: boolean;
  itemDescription?: string;
  quantity?: number;
  unit?: string;
  drPhotoUrl?: string;
  /**
   * Pending reference to a DR photo that is still queued on the submitting
   * device (`local-photo://…` URLs are never stored in drPhotoUrl). Cleared
   * when the queued photo uploads and `resolveReceivingIntakeQueuedPhoto`
   * attaches the server URL.
   */
  drPhotoLocalId?: string;
  extraPhotoUrls: string[];
  notes?: string;
  duplicateNotes: ReceivingIntakeDuplicateNote[];
  convertedReceivingId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PrintLog {
  id: string;
  documentType: string;
  documentNumber: string;
  relatedEntityType: string;
  relatedEntityId: string;
  action: "Printed" | "Reprinted";
  reason?: string;
  /**
   * Client-reported outcome of the print hand-off this row records. Rows are
   * written when the client attempts the hand-off (never at render time):
   * "HandedOff" = the native gateway intent launched or the browser print
   * fallback was invoked; "Failed" = the hand-off threw/returned not-ok, in
   * which case `reason` carries the client-reported error text.
   */
  outcome: "HandedOff" | "Failed";
  printedByName: string;
  deviceName?: string;
  layout: "58mm" | "80mm" | "A4";
  copyNumber: number;
  createdAt: string;
}

/**
 * One processed client idempotency key (Phase 4 B1). The web clients send an
 * `Idempotency-Key` header on every queueable write: the offline queue
 * record's id for queued actions (identical on the first attempt and on every
 * replay), or a per-intent id for direct submits. The service stores the key
 * with the exact result the first execution returned; a repeat of the same
 * key against the same endpoint returns that stored result and re-executes
 * nothing, so a lost response, a retry, or a double-tap can never apply a
 * payment/delivery/expense twice. Only successful executions are recorded —
 * a submission that fails validation does not burn its key. Records are
 * pruned lazily after a 7-day retention window (see LogisticsService).
 */
export interface IdempotencyRecord {
  id: string;
  key: string;
  /** Logical endpoint the key was processed against, e.g. "POST /payments". Keys are scoped per endpoint. */
  endpoint: string;
  /** The first execution's result, kept JSON-serializable so it round-trips through both state stores verbatim. */
  result: unknown;
  createdAt: string;
}

export interface TruckRecord {
  id: string;
  plateNumber: string;
  driverName?: string;
  contactNumber?: string;
  ownerName?: string;
  status: "Active" | "Inactive";
  createdAt: string;
  updatedAt?: string;
}

export interface Trip {
  id: string;
  tripNumber: string;
  origin: string;
  destination: string;
  status: TripStatus;
  isMixedTrip: boolean;
  truckId?: string;
  plateNumber?: string;
  vehicleDescription?: string;
  driverName?: string;
  driverContactNumber?: string;
  truckOwnerName?: string;
  loadingPhotoUrl?: string;
  loadingPhotoAttachedAt?: string;
  mixedTripApprovalStatus?: "Not Required" | "Notified" | "Approved" | "Rejected";
  mixedTripApprovalNotes?: string;
  cargoPackageIds: string[];
  createdAt: string;
}

export interface DeliveryRecord {
  id: string;
  cargoPackageId: string;
  status: "Delivered" | "Failed Delivery";
  deliveredTo?: string;
  signatureUrl?: string;
  deliveryPhotoUrl?: string;
  failedReason?: string;
  notes?: string;
  nextAction?: string;
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  cargoPackageId: string;
  amountDue: number;
  amountPaid: number;
  balance: number;
  method: string;
  collectionPoint: "Receiving" | "Delivery" | "Owner" | "Online" | "Other";
  collectedByUserId?: string;
  collectedByName?: string;
  collectedByRole?: string;
  branchId?: string;
  branchName?: string;
  status: PaymentStatus;
  proofUrl?: string;
  notes?: string;
  createdAt: string;
}

export interface ExpenseRecord {
  id: string;
  tripId?: string;
  category: string;
  amount: number;
  description?: string;
  receiptUrl?: string;
  status: "Submitted" | "Approved" | "Rejected";
  createdAt: string;
}

export interface ReturnRecord {
  id: string;
  cargoPackageId: string;
  reason: string;
  nextAction: "Return to Sender" | "Return to Origin" | "Hold at Branch" | "Reschedule";
  notes?: string;
  photoUrl?: string;
  status: "Requested" | "In Transit" | "Returned" | "Cancelled";
  createdAt: string;
}

/**
 * Phase 6 P6-1: billing terms are a FIXED LIST, stored as a day count on
 * the customer (`Customer.billingTermDays`). The day count is data — due
 * dates are computed as anchor + days for any entry, never by branching on
 * which term it is. Jerwin can extend the list later by adding an entry.
 */
export const BILLING_TERM_OPTIONS = [
  { days: 0, label: "Due on delivery" },
  { days: 7, label: "Net 7" },
  { days: 15, label: "Net 15" },
  { days: 30, label: "Net 30" }
] as const;

export type BillingTermDays = (typeof BILLING_TERM_OPTIONS)[number]["days"];

export function isBillingTermDays(value: unknown): value is BillingTermDays {
  return typeof value === "number" && BILLING_TERM_OPTIONS.some((option) => option.days === value);
}

export function billingTermLabel(days: number | null | undefined): string | undefined {
  if (days == null) return undefined;
  return BILLING_TERM_OPTIONS.find((option) => option.days === days)?.label ?? `Net ${days}`;
}

/**
 * Invoice statuses. "Draft" and "Issued" are the stored WORKFLOW states
 * (plus "Void", the stored terminal state set by the void endpoint).
 * "Paid", "Partially Paid" and "Overdue" are DERIVED at read time by
 * LogisticsService.deriveBillingInvoice from live payments + dueDate —
 * they are never stored. Keeping the derivation in one place is what makes
 * list, detail and statement agree.
 */
export type BillingInvoiceStatus = "Draft" | "Issued" | "Partially Paid" | "Paid" | "Overdue" | "Void";

export interface BillingInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  packageIds: string[];
  /**
   * CREATION SNAPSHOTS on the persisted record: the amounts computed from
   * the packages and payments at the moment the invoice was created. They
   * go stale the moment a later payment lands, so no read path may present
   * them as current — every read (list, detail, create response, void
   * response, statement) returns deriveBillingInvoice's live values in
   * these fields instead. The snapshots survive only so the stored record
   * shows what the invoice said when it was issued.
   */
  amountDue: number;
  amountPaid: number;
  balance: number;
  dueRule: string;
  status: BillingInvoiceStatus;
  /** ISO date the invoice falls due (anchor delivery date + term days); absent when the customer has no structured term. */
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffUserRecord {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  /**
   * Per-user PBKDF2 password hash (security.ts format). Seeded onto the
   * smoke-test accounts in P5-0; login() verifies against it since P5-1.
   * An account with no hash set cannot sign in with a password at all
   * (fail closed) — initial-password provisioning is P5-2. Never
   * serialized into API responses — every user-returning site strips it
   * alongside the other credential/security fields.
   */
  passwordHash?: string;
  /**
   * Per-user PBKDF2 hash of the staff sign-in code (Phase 5 P5-1). Staff
   * codes are never stored in plaintext: createStaffUser/updateStaffUser
   * hash on set, and records persisted before P5-1 are migrated on load
   * (their plaintext `staffCode` field is hashed and dropped by
   * LogisticsService.loadData). An account with no hash set cannot sign
   * in through the staff-code door (fail closed).
   */
  staffCodeHash?: string;
  /**
   * Phase 5 P5-2: true while the account's password is a temporary one
   * set by an admin (initial provisioning, admin reset) or by the
   * first-boot bootstrap. Login responses surface it, and the auth guard
   * refuses every endpoint except POST /auth/change-password until the
   * user sets their own password (changeOwnPassword clears it).
   */
  mustChangePassword?: boolean;
  /**
   * Token revocation watermark (Phase 5 P5-1). Issued JWTs carry this
   * value as their `sv` claim; the auth guard rejects a token whose claim
   * no longer matches. Bumped whenever a credential is set or changed.
   */
  sessionVersion?: number;
  /**
   * Per-account login throttle state (Phase 5 P5-1), shared by both login
   * doors: consecutive failure count, and the ISO timestamp until which
   * sign-in is locked once the failure threshold trips. A successful
   * sign-in clears both. Never serialized into API responses.
   */
  failedLoginAttempts?: number;
  loginLockedUntil?: string;
  branchId?: string;
  branchAccess?: string;
  permissionPreset?: string;
  canApprove?: string[];
  status?: "Active" | "Inactive";
  createdAt?: string;
}

export interface OperationChatMessage {
  id: string;
  senderUserId?: string;
  senderName: string;
  senderRole: string;
  body: string;
  system?: boolean;
  createdAt: string;
}

export interface OperationChatThread {
  id: string;
  scope: "Global" | "Package" | "Pricing";
  title: string;
  branchName?: string;
  cargoPackageId?: string;
  packageNumber?: string;
  customerName?: string;
  description?: string;
  status: "Open" | "Needs Approval" | "Approved" | "Rejected";
  actionType?: "PriceApproval" | "General";
  proposedPrice?: number | null;
  approvedPrice?: number | null;
  requestedByName?: string;
  requestedByRole?: string;
  createdAt: string;
  updatedAt: string;
  messages: OperationChatMessage[];
}

export interface DescriptionBarcode {
  id: string;
  customerId: string;
  barcode: string;
  description: string;
}

export interface PackageMessage {
  id: string;
  cargoPackageId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface ServiceNotification {
  id: string;
  title: string;
  message: string;
  priority: string;
  createdAt: string;
}

export interface ServiceAuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  createdAt: string;
}
