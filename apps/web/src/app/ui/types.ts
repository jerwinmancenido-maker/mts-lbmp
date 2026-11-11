export interface DashboardData {
  cargoWaiting: number;
  cargoWithoutPrice: number;
  pendingCustomers: number;
  activeTrips: number;
  delivered: number;
  failedDeliveries: number;
  paymentsCollected?: number;
  expensesAwaitingApproval?: number;
  /** @deprecated Phase 6 P6-5: all-time delivered revenue − all-time approved expenses. Kept in the API response for one release; the tile reads profitThisMonth. */
  estimatedProfit?: number;
  /** Phase 6 P6-5: this calendar month's (Asia/Manila) delivered revenue − this month's approved expenses. */
  profitThisMonth?: number;
  /** The YYYY-MM (Asia/Manila) profitThisMonth covers. */
  profitThisMonthPeriod?: string;
  branchScope?: string;
  notifications: Array<{ id: string; title: string; message: string; priority: string; createdAt: string }>;
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
  contacts?: Array<{
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
  }>;
  billingTerm?: string;
  /** Phase 6 P6-1: structured term from the fixed list (0/7/15/30 days); the free-text billingTerm above is a display note only. */
  billingTermDays?: number | null;
}

/** Phase 6 P6-1: the fixed billing-term list — day counts are data, labels are display. Mirrors the API's BILLING_TERM_OPTIONS. */
export const BILLING_TERM_OPTIONS = [
  { days: 0, label: "Due on delivery" },
  { days: 7, label: "Net 7" },
  { days: 15, label: "Net 15" },
  { days: 30, label: "Net 30" }
] as const;

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

export interface BootstrapData {
  customers: Customer[];
  defaultPaymentMethods: string[];
  defaultExpenseCategories: string[];
  trucks?: TruckRecord[];
  users: Array<{
    id: string;
    name: string;
    email?: string;
    phone?: string;
    role: string;
    branchId?: string;
    branchAccess?: string;
    permissionPreset?: string;
    canApprove?: string[];
    status?: "Active" | "Inactive";
    hasStaffCode?: boolean;
    /** Phase 5 P5-2: mirrors the API's safe-user shape (login responses included). */
    hasPassword?: boolean;
    mustChangePassword?: boolean;
    lastLogin?: string;
  }>;
  companyProfile: CompanyProfile;
  branches: Branch[];
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

export interface CargoPackage {
  id: string;
  packageNumber: string;
  receivingRecordNumber: string;
  customerName: string;
  productId?: string;
  productBarcode?: string;
  description: string;
  quantity?: number;
  unit?: string;
  destination: string;
  handlingBranchName?: string;
  consigneeName?: string;
  addressLine?: string;
  barangay?: string;
  deliveryType?: string;
  city?: string;
  province?: string;
  deliveryPhone?: string;
  condition: string;
  unitPrice?: number | null;
  status: string;
  price: number | null;
  weight?: number | null;
  weightUnit?: string;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  dimensionUnit?: string;
  qrValue: string;
  createdAt: string;
}

export interface Trip {
  id: string;
  tripNumber: string;
  origin: string;
  destination: string;
  status: string;
  isMixedTrip: boolean;
  mixedTripApprovalStatus?: "Not Required" | "Notified" | "Approved" | "Rejected";
  mixedTripApprovalNotes?: string;
  cargoPackageIds: string[];
  truckId?: string;
  plateNumber?: string;
  vehicleDescription?: string;
  driverName?: string;
  driverContactNumber?: string;
  truckOwnerName?: string;
  loadingPhotoUrl?: string;
  loadingPhotoAttachedAt?: string;
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  cargoPackageId: string;
  amountDue: number;
  amountPaid: number;
  /**
   * Historical PER-CALL value (audit §2.3.1) — what that one
   * recordPayment call computed from its own amount alone. NOT the
   * package's remaining balance; displays use the cumulative figure
   * from payment-display.ts instead.
   */
  balance: number;
  method: string;
  collectionPoint?: "Receiving" | "Delivery" | "Owner" | "Online" | "Other";
  collectedByUserId?: string;
  collectedByName?: string;
  collectedByRole?: string;
  branchId?: string;
  branchName?: string;
  status: string;
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
  status: string;
  createdAt: string;
}

export interface BillingInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  packageIds: string[];
  /** Live-derived amounts from the API (packages + payments at read time) — never creation snapshots. */
  amountDue: number;
  amountPaid: number;
  balance: number;
  dueRule: string;
  status: "Draft" | "Issued" | "Partially Paid" | "Paid" | "Overdue" | "Void";
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Phase 6 P6-2 — mirrors of the API's balance read model
 * (GET /balances, GET /customers/:id/balance). Server-computed from
 * packages + payments; the web never recomputes these figures.
 */
export type AgingBucket =
  | "current"
  | "overdue1To30"
  | "overdue31To60"
  | "overdue61To90"
  | "overdue90Plus"
  | "termsNotSet"
  | "notDelivered";

export interface CustomerBalancePackage {
  packageId: string;
  packageNumber: string;
  status: string;
  price: number;
  amountPaid: number;
  outstanding: number;
  /** Manila business date (YYYY-MM-DD) of delivery; absent until delivered. */
  deliveredDate?: string;
  /** Manila business date (YYYY-MM-DD) the amount falls due; absent when no due date can be derived. */
  dueDate?: string;
  daysOverdue: number;
  agingBucket: AgingBucket;
}

export interface CustomerBalance {
  customerId: string;
  customerName: string;
  billingTermDays: number | null;
  totalDue: number;
  totalCollected: number;
  outstanding: number;
  oldestDueDate?: string;
  packages: CustomerBalancePackage[];
  aging: Record<AgingBucket, { amount: number; count: number }>;
}

/**
 * Phase 6 P6-4 — mirrors of the API's due-reminder read models
 * (GET /billing/due-worklist, GET /customers/:id/reminder-history).
 * Amounts are server-derived; reminders are in-app only.
 */
export interface DueWorklistRow {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  branchName?: string;
  amountDue: number;
  amountPaid: number;
  balance: number;
  status: BillingInvoice["status"];
  /** Manila business date (YYYY-MM-DD). */
  dueDate: string;
  state: "DueSoon" | "Overdue";
  daysUntilDue: number;
  daysOverdue: number;
}

export interface CustomerReminderHistoryEntry {
  id: string;
  kind: "manual" | "dueSoon" | "overdue";
  invoiceId?: string;
  invoiceNumber?: string;
  reason?: string;
  createdAt: string;
}

/**
 * Phase 6 P6-5 — expense trip discipline, mirroring the API's
 * TRIP_REQUIRED_EXPENSE_CATEGORIES: Fuel / Toll / Truck Rental are trip
 * costs and must name their trip, in the form and on the server.
 */
export const TRIP_REQUIRED_EXPENSE_CATEGORIES = ["Fuel", "Toll", "Truck Rental"] as const;

export function expenseCategoryRequiresTrip(category: string | undefined | null): boolean {
  const clean = category?.trim().toLowerCase();
  if (!clean) return false;
  return TRIP_REQUIRED_EXPENSE_CATEGORIES.some((entry) => entry.toLowerCase() === clean);
}

/** Phase 6 P6-5 — mirrors of the API's profitability report (GET /reports/profitability). */
export type ProfitabilityGroupBy = "trip" | "route" | "customer" | "branch";

export interface ProfitabilityCategoryTotal {
  category: string;
  amount: number;
}

export interface ProfitabilityGroup {
  key: string;
  label: string;
  tripId?: string;
  tripNumber?: string;
  origin?: string;
  destination?: string;
  customerId?: string;
  branch?: string;
  billed: number;
  collected: number;
  outstanding: number;
  packageCount: number;
  linkedExpenses: number;
  linkedExpensesByCategory: ProfitabilityCategoryTotal[];
  /** Null on the customer view: no expense is recorded against a customer, so no margin is shown. */
  margin: number | null;
}

export interface ProfitabilityExpenseBucket {
  total: number;
  count: number;
  byCategory: ProfitabilityCategoryTotal[];
}

export interface ProfitabilityReport {
  period: { from: string; to: string };
  groupBy: ProfitabilityGroupBy;
  /** The report's own definitions, printed verbatim above the table. */
  definition: string;
  groups: ProfitabilityGroup[];
  unallocatedExpenses: ProfitabilityExpenseBucket;
  tripLinkedExpenses: ProfitabilityExpenseBucket;
  totals: {
    billed: number;
    collected: number;
    outstanding: number;
    approvedExpenses: number;
    margin: number | null;
  };
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
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
  messages: Array<{
    id: string;
    senderUserId?: string;
    senderName: string;
    senderRole: string;
    body: string;
    system?: boolean;
    createdAt: string;
  }>;
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
  status: string;
}

/**
 * Identity of a rendered document as returned by the API next to the text.
 * The client passes it back to POST /printing/handoffs after attempting the
 * print hand-off, so the PrintLog row names the real document, user, device
 * and outcome instead of being written at render time.
 */
export interface PrintDocumentMeta {
  documentType: string;
  documentNumber: string;
  relatedEntityType: string;
  relatedEntityId: string;
  layout: "58mm" | "80mm" | "A4";
}

export interface RenderedDocumentResponse {
  text: string;
  print: PrintDocumentMeta;
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
