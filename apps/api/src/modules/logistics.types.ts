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

export interface BillingInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  packageIds: string[];
  amountDue: number;
  amountPaid: number;
  balance: number;
  dueRule: string;
  status: "Draft" | "Issued" | "Paid" | "Overdue";
  createdAt: string;
}

export interface StaffUserRecord {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  staffCode?: string;
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
