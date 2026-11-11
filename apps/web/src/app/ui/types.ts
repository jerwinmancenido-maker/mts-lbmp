export interface DashboardData {
  cargoWaiting: number;
  cargoWithoutPrice: number;
  pendingCustomers: number;
  activeTrips: number;
  delivered: number;
  failedDeliveries: number;
  paymentsCollected?: number;
  expensesAwaitingApproval?: number;
  estimatedProfit?: number;
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
  amountDue: number;
  amountPaid: number;
  balance: number;
  dueRule: string;
  status: "Draft" | "Issued" | "Paid" | "Overdue";
  createdAt: string;
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
