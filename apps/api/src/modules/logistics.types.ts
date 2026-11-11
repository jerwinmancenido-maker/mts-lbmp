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
  /**
   * HISTORICAL PER-CALL value (Phase 6 audit §2.3.1): computed at record
   * time from THIS payment alone (max(amountDue − amountPaid, 0)). It is
   * NOT the package's remaining balance — with instalments it can even
   * exceed an earlier payment's value. Displays must show the cumulative
   * figure instead (price − all payments for the package); this field is
   * kept as the record of what that one call computed.
   */
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
  /**
   * Phase 6 P6-4 — due-reminder markers (server bookkeeping; stripped
   * from every read model by deriveBillingInvoice). Each holds the
   * Manila due-date key (YYYY-MM-DD) that reminder state last fired
   * FOR; absent = the state has never fired for any date. The due scan
   * fires a state only when its marker differs from the invoice's
   * current due-date key, so each state notifies exactly once per due
   * date — and a moved due date starts a fresh cycle instead of being
   * suppressed by a reminder sent for the old date. The markers live on
   * the invoice record itself so they persist with it on BOTH stores
   * (JSON field / Prisma column) and the scan's state machine stays a
   * pure function of the record.
   */
  dueSoonReminderForDate?: string;
  overdueReminderForDate?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Phase 6 P6-4 — the due scan's outcome for one run: how many open
 * invoices were examined and which invoices each reminder state newly
 * fired for (empty arrays = the run changed nothing).
 */
export interface DueReminderScanResult {
  scannedInvoices: number;
  dueSoonNotified: string[];
  overdueNotified: string[];
}

/**
 * Phase 6 P6-4 — one row of the Due/Overdue worklist
 * (GET /billing/due-worklist). Amounts are the LIVE derivation (the same
 * figures as the invoice list/detail); `dueDate` is the Manila business
 * date (YYYY-MM-DD). An invoice appears only while it has a balance AND
 * a due date that is overdue or at most 3 days away.
 */
export interface DueWorklistRow {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  /** Handling branch of the invoice's first package (destination as fallback) — the branch the reminder addresses. */
  branchName?: string;
  amountDue: number;
  amountPaid: number;
  balance: number;
  /** The derived invoice status at read time (Overdue / Partially Paid / Issued). */
  status: BillingInvoiceStatus;
  dueDate: string;
  state: "DueSoon" | "Overdue";
  /** Whole Manila days until the due date; 0 once overdue. */
  daysUntilDue: number;
  /** Whole Manila days past the due date; 0 while still due soon. */
  daysOverdue: number;
}

/**
 * Phase 6 P6-4 — one entry of a customer's reminder history
 * (GET /customers/:id/reminder-history), read from the audit trail:
 * manual reminders staff sent from the customer view (action
 * billing.reminder) and the due scan's automatic notices for the
 * customer's invoices (billing.reminder.dueSoon / .overdue).
 */
export interface CustomerReminderHistoryEntry {
  id: string;
  kind: "manual" | "dueSoon" | "overdue";
  invoiceId?: string;
  invoiceNumber?: string;
  reason?: string;
  createdAt: string;
}

/**
 * Phase 6 P6-2 — aging buckets for a customer's outstanding package
 * balances, classified by whole Manila calendar days past the package's
 * due date (due date itself = "current", the same boundary
 * deriveBillingInvoice uses for Overdue). Two buckets exist so an amount
 * is never silently guessed into aging: "termsNotSet" (the customer has
 * no structured billing term, so no due date can be derived) and
 * "notDelivered" (a term exists but the package has no delivery yet, so
 * its due date does not exist yet either).
 */
export type AgingBucket =
  | "current"
  | "overdue1To30"
  | "overdue31To60"
  | "overdue61To90"
  | "overdue90Plus"
  | "termsNotSet"
  | "notDelivered";

/** One owing package on a CustomerBalance: priced, with money still outstanding. Fully-paid packages never appear. */
export interface CustomerBalancePackage {
  packageId: string;
  packageNumber: string;
  status: CargoPackage["status"];
  price: number;
  amountPaid: number;
  outstanding: number;
  /** Manila business date (YYYY-MM-DD) of the delivery the due date anchors on; absent until the package is delivered. */
  deliveredDate?: string;
  /** Manila business date (YYYY-MM-DD) the amount falls due: deliveredDate + the customer's term days. Absent when no due date can be derived. */
  dueDate?: string;
  /** Whole Manila days past dueDate; 0 whenever the amount is not overdue (including when no due date exists). */
  daysOverdue: number;
  agingBucket: AgingBucket;
}

export interface CustomerBalanceAgingCell {
  amount: number;
  count: number;
}

/**
 * Phase 6 P6-2 — THE server-side customer balance (GET /balances,
 * GET /customers/:id/balance). Computed live from packages + payments by
 * LogisticsService.buildCustomerBalance — the one place this math lives,
 * so the Customers list, the customer detail and any future surface can
 * never disagree the way the retired client-side copies could.
 *
 * Scope note: figures cover the customer's packages VISIBLE to the
 * caller under the Phase 5 P5-3 branch rule. An unrestricted caller sees
 * the customer's full position; a branch-scoped caller sees their
 * branches' slice of it.
 */
export interface CustomerBalance {
  customerId: string;
  customerName: string;
  /** The customer's structured term (fixed-list day count), or null when unset. */
  billingTermDays: number | null;
  /** Σ price over the customer's priced (visible) packages. */
  totalDue: number;
  /** Σ payments over the customer's visible packages. */
  totalCollected: number;
  /** Σ per-package outstanding (each clamped at 0) — the collectible truth; equals totalDue − totalCollected unless a package was overpaid. */
  outstanding: number;
  /** Earliest dueDate (YYYY-MM-DD) among owing packages that have one; absent when nothing owing has a due date. */
  oldestDueDate?: string;
  /** Owing packages only, oldest due date first (rows without a due date last, by delivery then creation). */
  packages: CustomerBalancePackage[];
  aging: Record<AgingBucket, CustomerBalanceAgingCell>;
}

/**
 * Phase 6 P6-5 — expense trip discipline (settled owner answer, audit §9
 * Q6): an expense in one of these categories is a trip cost, so it MUST
 * name the trip it belongs to. Enforced in createExpense (the only
 * expense write path — there is no expense edit endpoint) with a 400,
 * and required in the web expense form for the same categories.
 * Categories are a settings-editable free-text list, so matching is
 * trim + case-insensitive against these canonical names; historical
 * records are NOT migrated — an old unlinked Fuel expense stays
 * unlinked and surfaces in the profitability report's explicit
 * "unallocated" bucket instead of being silently spread or dropped.
 */
export const TRIP_REQUIRED_EXPENSE_CATEGORIES = ["Fuel", "Toll", "Truck Rental"] as const;

export function expenseCategoryRequiresTrip(category: string | undefined | null): boolean {
  const clean = category?.trim().toLowerCase();
  if (!clean) return false;
  return TRIP_REQUIRED_EXPENSE_CATEGORIES.some((entry) => entry.toLowerCase() === clean);
}

export type ProfitabilityGroupBy = "trip" | "route" | "customer" | "branch";

export interface ProfitabilityCategoryTotal {
  category: string;
  amount: number;
}

/** One row of the profitability report: a trip, a route, a customer, or a branch. */
export interface ProfitabilityGroup {
  /** Stable row key: the trip id, "origin → destination", the customer id, or the branch name ("no-trip" for cargo with no trip on trip/route views). */
  key: string;
  label: string;
  tripId?: string;
  tripNumber?: string;
  origin?: string;
  destination?: string;
  customerId?: string;
  branch?: string;
  /** Σ price of this group's packages DELIVERED in the period (delivery date, Asia/Manila). */
  billed: number;
  /** Σ payments RECEIVED in the period for this group's packages (payment date, Asia/Manila). */
  collected: number;
  /** Still-unpaid balance (as of the report run) of the packages billed in this period. */
  outstanding: number;
  /** How many priced packages were billed in this group + period. */
  packageCount: number;
  /** Σ APPROVED expenses recorded in the period and linked to this group (0 on the customer view — see `margin`). */
  linkedExpenses: number;
  linkedExpensesByCategory: ProfitabilityCategoryTotal[];
  /** billed − linkedExpenses. Null on the customer view: no expense is recorded against a customer, so no margin is shown rather than a fake one. */
  margin: number | null;
}

export interface ProfitabilityExpenseBucket {
  total: number;
  count: number;
  byCategory: ProfitabilityCategoryTotal[];
}

/**
 * Phase 6 P6-5 — GET /reports/profitability, the system's first
 * date-ranged report. Built by LogisticsService.getProfitabilityReport —
 * the one place this math lives. Every figure is defined in
 * `definition`, which the web prints verbatim above the table: no
 * number on this report has an implicit meaning.
 */
export interface ProfitabilityReport {
  period: { from: string; to: string };
  groupBy: ProfitabilityGroupBy;
  definition: string;
  groups: ProfitabilityGroup[];
  /** APPROVED expenses recorded in the period with NO trip link. Always present, never spread across groups. */
  unallocatedExpenses: ProfitabilityExpenseBucket;
  /** APPROVED expenses recorded in the period that ARE linked to a trip (the sum of the groups' linkedExpenses on trip/route/branch views). */
  tripLinkedExpenses: ProfitabilityExpenseBucket;
  totals: {
    billed: number;
    collected: number;
    outstanding: number;
    /** linked + unallocated approved expenses in the period. */
    approvedExpenses: number;
    /** billed − trip-linked expenses; null on the customer view (see ProfitabilityGroup.margin). */
    margin: number | null;
  };
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
