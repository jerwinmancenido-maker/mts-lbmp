import type {
  BillingInvoice,
  Branch,
  CargoPackage,
  CompanyProfile,
  Customer,
  CustomerContact,
  DeliveryRecord,
  DescriptionBarcode,
  ExpenseRecord,
  HardwareTestRecord,
  OperationChatMessage,
  OperationChatThread,
  PackageMessage,
  PaymentRecord,
  PrintLog,
  ProductMaster,
  ReceivingDraft,
  ReceivingIntakeTask,
  ReceivingRecord,
  ReturnRecord,
  ServiceAuditLog,
  ServiceNotification,
  StaffUserRecord,
  Trip,
  TruckRecord
} from "./logistics.types.js";
import type { LoadedServiceState, ServiceState } from "./state-store.js";

/**
 * Pure translations between LogisticsService's ServiceState and the row
 * shapes of packages/database/prisma/schema.prisma.
 *
 * These functions deliberately know nothing about PrismaClient. Decimal
 * values may arrive as numbers, strings, or Prisma Decimal objects; dates
 * may arrive as Date instances or ISO strings. Keeping the translation pure
 * makes every collection round-trippable in unit tests without a database.
 */

export type DecimalValue = number | string | { toNumber(): number } | { toString(): string };
export type DateValue = Date | string;

export interface BranchRow extends Omit<Branch, "address"> {
  address: string | null;
}

export interface CompanySettingsRow {
  id: string;
  companyName: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string | null;
  paymentMethods: string[];
  expenseCategories: string[];
}

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystemDefault: boolean;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  status: string;
  roleId: string | null;
  customerId: string | null;
  branchAccess: string | null;
  lastLoginAt: DateValue | null;
  createdAt?: DateValue;
  deletedAt: DateValue | null;
}

export interface CustomerRow {
  id: string;
  businessName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  tin: string | null;
  companyPhone: string | null;
  billingTerm: string;
  status: string;
  notes: string | null;
  createdFromReceivingId: string | null;
  finalizedAt: DateValue | null;
  finalizedBy: string | null;
}

export interface CustomerContactRow extends Omit<CustomerContact, "role" | "phone" | "email" | "address" | "billingAddress" | "shippingAddress" | "notes" | "createdAt"> {
  customerId: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  notes: string | null;
  createdAt: DateValue;
}

export interface ProductMasterRow extends Omit<ProductMaster, "sku" | "barcode" | "brand" | "category" | "defaultPrice" | "notes" | "photoUrl" | "createdAt"> {
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  category: string | null;
  defaultPrice: DecimalValue | null;
  notes: string | null;
  photoUrl: string | null;
  createdAt: DateValue;
}

export interface ItemDescriptionRow {
  id: string;
  customerId: string;
  description: string;
  category: string | null;
  barcode: string | null;
  lastPrice: DecimalValue | null;
  isFavorite: boolean;
}

export interface ReceivingRecordRow {
  id: string;
  recordNumber: string;
  customerId: string;
  customerName: string;
  senderId: string | null;
  consigneeId: string | null;
  sender: string | null;
  consignee: string | null;
  customerDrNumber: string | null;
  customerDrPhotoUrl: string | null;
  drPhotoAttachedAt: DateValue | null;
  drPhotoAttachReason: string | null;
  originBranchId: string | null;
  destination: string | null;
  status: string;
  receivedById: string | null;
  receivedAt: DateValue;
  createdAt: DateValue;
}

export interface CargoPackageRow {
  id: string;
  packageNumber: string;
  receivingRecordId: string;
  customerId: string;
  customerName: string;
  productId: string | null;
  productBarcode: string | null;
  itemDescriptionId: string | null;
  description: string;
  quantity: number;
  unit: string;
  destination: string;
  handlingBranchId: string;
  handlingBranchName: string;
  deliveryType: string;
  consigneeName: string | null;
  deliveryBusinessName: string | null;
  addressLine: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  landmark: string | null;
  deliveryPhone: string | null;
  deliveryNotes: string | null;
  condition: string;
  conditionNotes: string | null;
  weight: DecimalValue | null;
  weightUnit: string | null;
  length: DecimalValue | null;
  width: DecimalValue | null;
  height: DecimalValue | null;
  dimensionUnit: string | null;
  unitPrice: DecimalValue | null;
  price: DecimalValue | null;
  priceChangeReason: string | null;
  qrValue: string;
  status: string;
  createdAt: DateValue;
}

export interface PhotoRow {
  id: string;
  cargoPackageId: string | null;
  type: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  uploadedById: string | null;
  createdAt: DateValue;
}

export interface TruckRecordRow extends Omit<TruckRecord, "driverName" | "contactNumber" | "ownerName" | "createdAt" | "updatedAt"> {
  driverName: string | null;
  contactNumber: string | null;
  ownerName: string | null;
  createdAt: DateValue;
  updatedAt?: DateValue;
}

export interface TripRow {
  id: string;
  tripNumber: string;
  origin: string;
  destination: string;
  isMixedTrip: boolean;
  truckId: string | null;
  plateNumber: string | null;
  vehicleType: string | null;
  vehicleDescription: string | null;
  driverName: string | null;
  driverContactNumber: string | null;
  truckOwnerName: string | null;
  providerName: string | null;
  loadingPhotoUrl: string | null;
  loadingPhotoAttachedAt: DateValue | null;
  mixedTripApprovalStatus: string | null;
  mixedTripApprovalNotes: string | null;
  status: string;
  plannedDepartureAt: DateValue | null;
  departedAt: DateValue | null;
  arrivedAt: DateValue | null;
  completedAt: DateValue | null;
  createdAt: DateValue;
}

export interface TripCargoRow {
  id: string;
  tripId: string;
  cargoPackageId: string;
  loadedAt: DateValue | null;
  unloadedAt: DateValue | null;
  status: string;
  exception: string | null;
}

export interface DeliveryRecordRow {
  id: string;
  cargoPackageId: string;
  deliveryType: string;
  status: string;
  deliveredTo: string | null;
  deliveredAt: DateValue | null;
  deliveredById: string | null;
  signatureUrl: string | null;
  deliveryPhotoUrl: string | null;
  failedReason: string | null;
  notes: string | null;
  nextAction: string | null;
  customerAcceptedDamage: boolean;
  createdAt: DateValue;
}

export interface ReturnRecordRow extends Omit<ReturnRecord, "notes" | "photoUrl" | "createdAt"> {
  notes: string | null;
  photoUrl: string | null;
  createdAt: DateValue;
}

export interface PaymentRow {
  id: string;
  cargoPackageId: string | null;
  amountDue: DecimalValue;
  amountPaid: DecimalValue;
  balance: DecimalValue;
  method: string;
  collectionPoint: string;
  collectedByUserId: string | null;
  collectedByName: string | null;
  collectedByRole: string | null;
  branchId: string | null;
  branchName: string | null;
  status: string;
  proofUrl: string | null;
  recordedById: string | null;
  verifiedById: string | null;
  notes: string | null;
  createdAt: DateValue;
}

export interface ExpenseRow {
  id: string;
  tripId: string | null;
  branchId: string | null;
  category: string;
  amount: DecimalValue;
  description: string | null;
  receiptUrl: string | null;
  status: string;
  createdById: string | null;
  approvedById: string | null;
  createdAt: DateValue;
}

export interface BillingInvoiceRow {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amountDue: DecimalValue;
  amountPaid: DecimalValue;
  balance: DecimalValue;
  dueRule: string;
  status: string;
  createdAt: DateValue;
}

export interface BillingInvoicePackageRow {
  id: string;
  billingInvoiceId: string;
  cargoPackageId: string;
}

export interface ReceivingDraftRow extends Omit<ReceivingDraft, "customerId" | "customerNameSnapshot" | "customerStatusSnapshot" | "customerDrNumber" | "destination" | "drPhotoUrl" | "finalizedReceivingId" | "createdAt" | "updatedAt"> {
  customerId: string | null;
  customerNameSnapshot: string | null;
  customerStatusSnapshot: string | null;
  customerDrNumber: string | null;
  destination: string | null;
  drPhotoUrl: string | null;
  finalizedReceivingId: string | null;
  createdAt: DateValue;
  updatedAt: DateValue;
}

export interface ReceivingIntakeTaskRow extends Omit<ReceivingIntakeTask, "customerId" | "customerDrNumber" | "dropOffPerson" | "dropOffPhone" | "consigneeName" | "destinationBranch" | "deliveryArea" | "productId" | "itemDescription" | "quantity" | "unit" | "drPhotoUrl" | "notes" | "convertedReceivingId" | "createdAt" | "updatedAt"> {
  customerId: string | null;
  customerDrNumber: string | null;
  dropOffPerson: string | null;
  dropOffPhone: string | null;
  consigneeName: string | null;
  destinationBranch: string | null;
  deliveryArea: string | null;
  productId: string | null;
  itemDescription: string | null;
  quantity: number | null;
  unit: string | null;
  drPhotoUrl: string | null;
  notes: string | null;
  convertedReceivingId: string | null;
  createdAt: DateValue;
  updatedAt: DateValue;
}

export interface HardwareTestRecordRow extends Omit<HardwareTestRecord, "notes" | "createdAt"> {
  notes: string | null;
  createdAt: DateValue;
}

export interface PrintLogRow extends Omit<PrintLog, "reason" | "deviceName" | "outcome" | "createdAt"> {
  reason: string | null;
  deviceName: string | null;
  outcome: string;
  createdAt: DateValue;
}

export interface OperationChatThreadRow {
  id: string;
  scope: string;
  title: string;
  branchName: string | null;
  cargoPackageId: string | null;
  packageNumber: string | null;
  customerName: string | null;
  description: string | null;
  status: string;
  actionType: string | null;
  proposedPrice: DecimalValue | null;
  approvedPrice: DecimalValue | null;
  requestedByName: string | null;
  requestedByRole: string | null;
  createdAt: DateValue;
  updatedAt: DateValue;
}

export interface OperationChatMessageRow extends Omit<OperationChatMessage, "senderUserId" | "system" | "createdAt"> {
  threadId: string;
  senderUserId: string | null;
  system: boolean;
  createdAt: DateValue;
}

export interface DocumentSequenceRow {
  id: string;
  documentType: string;
  lastSequence: number;
}

export interface NotificationRow {
  id: string;
  userId: string | null;
  title: string;
  message: string;
  priority: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  readAt: DateValue | null;
  createdAt: DateValue;
}

export interface MessageThreadRow {
  id: string;
  cargoPackageId: string | null;
  subject: string;
  status: string;
  createdAt: DateValue;
  updatedAt: DateValue;
}

export interface MessageRow {
  id: string;
  threadId: string;
  senderId: string | null;
  senderName: string | null;
  body: string;
  createdAt: DateValue;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: DateValue;
}

export interface PrismaStateRows {
  branches: BranchRow[];
  companySettings: CompanySettingsRow[];
  documentSequences: DocumentSequenceRow[];
  roles: RoleRow[];
  users: UserRow[];
  customers: CustomerRow[];
  customerContacts: CustomerContactRow[];
  productMasters: ProductMasterRow[];
  itemDescriptions: ItemDescriptionRow[];
  trucks: TruckRecordRow[];
  receivingRecords: ReceivingRecordRow[];
  cargoPackages: CargoPackageRow[];
  photos: PhotoRow[];
  trips: TripRow[];
  tripCargo: TripCargoRow[];
  deliveries: DeliveryRecordRow[];
  returnRecords: ReturnRecordRow[];
  payments: PaymentRow[];
  expenses: ExpenseRow[];
  billingInvoices: BillingInvoiceRow[];
  billingInvoicePackages: BillingInvoicePackageRow[];
  receivingDrafts: ReceivingDraftRow[];
  receivingIntakeTasks: ReceivingIntakeTaskRow[];
  hardwareTests: HardwareTestRecordRow[];
  printLogs: PrintLogRow[];
  operationChatThreads: OperationChatThreadRow[];
  operationChatMessages: OperationChatMessageRow[];
  notifications: NotificationRow[];
  messageThreads: MessageThreadRow[];
  messages: MessageRow[];
  auditLogs: AuditLogRow[];
}

export const COMPANY_SETTINGS_ROW_ID = "company_settings";

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function toIso(value: DateValue): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function decimalToNumber(value: DecimalValue | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof (value as { toNumber?: unknown }).toNumber === "function") {
    return (value as { toNumber(): number }).toNumber();
  }
  return Number(value.toString());
}

function requiredDecimal(value: DecimalValue): number {
  return decimalToNumber(value) ?? 0;
}

function roleIdForName(roleName: string): string {
  return `role_${roleName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "staff"}`;
}

function groupBy<T>(items: T[], keyFor: (item: T) => string | null | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) existing.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}

export function stateToRows(state: ServiceState): PrismaStateRows {
  const receivingIdByNumber = new Map(state.receivingRecords.map((record) => [record.recordNumber, record.id]));
  const productIds = new Set(state.productMasters.map((product) => product.id));
  const packageNumberById = new Map(state.packages.map((pkg) => [pkg.id, pkg.packageNumber]));

  const rolesByName = new Map<string, RoleRow>();
  for (const user of state.customUsers) {
    if (!rolesByName.has(user.role)) {
      rolesByName.set(user.role, {
        id: roleIdForName(user.role),
        name: user.role,
        description: null,
        isSystemDefault: false
      });
    }
  }

  const messageThreads: MessageThreadRow[] = [];
  const messages: MessageRow[] = [];
  const messagesByPackage = groupBy(state.messages, (message) => message.cargoPackageId);
  for (const [cargoPackageId, packageMessages] of messagesByPackage) {
    const sorted = [...packageMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) continue;
    const threadId = `thread_${cargoPackageId}`;
    messageThreads.push({
      id: threadId,
      cargoPackageId,
      subject: packageNumberById.get(cargoPackageId) ?? cargoPackageId,
      status: "Open",
      createdAt: new Date(first.createdAt),
      updatedAt: new Date(last.createdAt)
    });
    for (const message of sorted) {
      messages.push({
        id: message.id,
        threadId,
        // senderId must reference a User row and message senders are not
        // necessarily users, so it stays null; the display name persists in
        // the dedicated senderName column (Phase 2 step 4 — this closes
        // known mapping gap #1 from PR #11).
        senderId: null,
        senderName: message.senderName,
        body: message.body,
        createdAt: new Date(message.createdAt)
      });
    }
  }

  return {
    branches: state.branches.map((branch) => ({ ...branch, address: branch.address ?? null })),
    companySettings: [
      {
        id: COMPANY_SETTINGS_ROW_ID,
        companyName: state.companyProfile.companyName,
        address: state.companyProfile.address,
        phone: state.companyProfile.phone,
        email: state.companyProfile.email,
        logoUrl: state.companyProfile.logoUrl ?? null,
        paymentMethods: [...state.paymentMethods],
        expenseCategories: [...state.expenseCategories]
      }
    ],
    documentSequences: state.sequences.map(([documentType, lastSequence]) => ({
      id: `sequence_${documentType}`,
      documentType,
      lastSequence
    })),
    roles: [...rolesByName.values()],
    users: state.customUsers.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email ?? `${user.id}@mts.local`,
      phone: user.phone ?? null,
      // Phase 5 owns real credentials. The schema requires a value, so the
      // repository writes the agreed placeholder rather than a staff code or
      // any other reusable secret.
      passwordHash: "",
      status: user.status ?? "Active",
      roleId: roleIdForName(user.role),
      customerId: null,
      // The service has both a per-user branchAccess and a separate override
      // map, but User has one branchAccess column. Persist the effective
      // value so behaviour is preserved; the distinction is a known gap.
      branchAccess: state.userBranchAccessOverrides[user.id] ?? user.branchAccess ?? null,
      lastLoginAt: null,
      createdAt: user.createdAt ? new Date(user.createdAt) : undefined,
      deletedAt: null
    })),
    customers: state.customers.map((customer) => ({
      id: customer.id,
      businessName: customer.businessName,
      contactPerson: customer.contactPerson ?? null,
      phone: customer.phone ?? null,
      email: null,
      address: customer.address ?? null,
      billingAddress: customer.billingAddress ?? null,
      shippingAddress: customer.shippingAddress ?? null,
      tin: customer.tin ?? null,
      companyPhone: customer.companyPhone ?? null,
      billingTerm: customer.billingTerm,
      status: customer.status,
      notes: customer.notes ?? null,
      createdFromReceivingId: customer.createdFromReceivingId ?? null,
      finalizedAt: toDate(customer.finalizedAt),
      finalizedBy: customer.finalizedBy ?? null
    })),
    customerContacts: state.customers.flatMap((customer) =>
      (customer.contacts ?? []).map((contact) => ({
        ...contact,
        customerId: customer.id,
        role: contact.role ?? null,
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        address: contact.address ?? null,
        billingAddress: contact.billingAddress ?? null,
        shippingAddress: contact.shippingAddress ?? null,
        notes: contact.notes ?? null,
        createdAt: new Date(contact.createdAt)
      }))
    ),
    productMasters: state.productMasters.map((product) => ({
      ...product,
      sku: product.sku ?? null,
      barcode: product.barcode ?? null,
      brand: product.brand ?? null,
      category: product.category ?? null,
      defaultPrice: product.defaultPrice ?? null,
      notes: product.notes ?? null,
      photoUrl: product.photoUrl ?? null,
      createdAt: new Date(product.createdAt)
    })),
    itemDescriptions: state.descriptionBarcodes.map((entry) => ({
      id: entry.id,
      customerId: entry.customerId,
      description: entry.description,
      category: null,
      barcode: entry.barcode,
      lastPrice: null,
      isFavorite: false
    })),
    trucks: state.trucks.map((truck) => ({
      ...truck,
      driverName: truck.driverName ?? null,
      contactNumber: truck.contactNumber ?? null,
      ownerName: truck.ownerName ?? null,
      createdAt: new Date(truck.createdAt),
      updatedAt: truck.updatedAt ? new Date(truck.updatedAt) : undefined
    })),
    receivingRecords: state.receivingRecords.map((record) => ({
      id: record.id,
      recordNumber: record.recordNumber,
      customerId: record.customerId,
      customerName: record.customerName,
      senderId: null,
      consigneeId: null,
      sender: record.sender ?? null,
      consignee: record.consignee ?? null,
      customerDrNumber: record.customerDrNumber ?? null,
      customerDrPhotoUrl: record.drPhotoUrl ?? null,
      drPhotoAttachedAt: toDate(record.drPhotoAttachedAt),
      drPhotoAttachReason: record.drPhotoAttachReason ?? null,
      originBranchId: null,
      destination: record.destination,
      status: "Received",
      receivedById: null,
      receivedAt: new Date(record.createdAt),
      createdAt: new Date(record.createdAt)
    })),
    cargoPackages: state.packages.map((pkg) => ({
      id: pkg.id,
      packageNumber: pkg.packageNumber,
      receivingRecordId: receivingIdByNumber.get(pkg.receivingRecordNumber) ?? "",
      customerId: pkg.customerId,
      customerName: pkg.customerName,
      productId: productIds.has(pkg.productId) ? pkg.productId : null,
      productBarcode: pkg.productBarcode ?? null,
      itemDescriptionId: null,
      description: pkg.description,
      quantity: pkg.quantity,
      unit: pkg.unit,
      destination: pkg.destination,
      handlingBranchId: pkg.handlingBranchId,
      handlingBranchName: pkg.handlingBranchName,
      deliveryType: pkg.deliveryType,
      consigneeName: pkg.consigneeName ?? null,
      deliveryBusinessName: pkg.deliveryBusinessName ?? null,
      addressLine: pkg.addressLine ?? null,
      barangay: pkg.barangay ?? null,
      city: pkg.city ?? null,
      province: pkg.province ?? null,
      landmark: pkg.landmark ?? null,
      deliveryPhone: pkg.deliveryPhone ?? null,
      deliveryNotes: pkg.deliveryNotes ?? null,
      condition: pkg.condition,
      conditionNotes: pkg.conditionNotes ?? null,
      weight: pkg.weight ?? null,
      weightUnit: pkg.weightUnit ?? null,
      length: pkg.length ?? null,
      width: pkg.width ?? null,
      height: pkg.height ?? null,
      dimensionUnit: pkg.dimensionUnit ?? null,
      unitPrice: pkg.unitPrice ?? null,
      price: pkg.price,
      priceChangeReason: pkg.priceChangeReason ?? null,
      qrValue: pkg.qrValue,
      status: pkg.status,
      createdAt: new Date(pkg.createdAt)
    })),
    photos: state.packages.flatMap((pkg) =>
      pkg.photoUrls.map((fileUrl, index) => ({
        id: `${pkg.id}:photo:${index}`,
        cargoPackageId: pkg.id,
        type: "Package",
        fileUrl,
        thumbnailUrl: null,
        uploadedById: null,
        createdAt: new Date(pkg.createdAt)
      }))
    ),
    trips: state.trips.map((trip) => ({
      id: trip.id,
      tripNumber: trip.tripNumber,
      origin: trip.origin,
      destination: trip.destination,
      isMixedTrip: trip.isMixedTrip,
      truckId: trip.truckId ?? null,
      plateNumber: trip.plateNumber ?? null,
      vehicleType: null,
      vehicleDescription: trip.vehicleDescription ?? null,
      driverName: trip.driverName ?? null,
      driverContactNumber: trip.driverContactNumber ?? null,
      truckOwnerName: trip.truckOwnerName ?? null,
      providerName: null,
      loadingPhotoUrl: trip.loadingPhotoUrl ?? null,
      loadingPhotoAttachedAt: toDate(trip.loadingPhotoAttachedAt),
      mixedTripApprovalStatus: trip.mixedTripApprovalStatus ?? null,
      mixedTripApprovalNotes: trip.mixedTripApprovalNotes ?? null,
      status: trip.status,
      plannedDepartureAt: null,
      departedAt: null,
      arrivedAt: null,
      completedAt: null,
      createdAt: new Date(trip.createdAt)
    })),
    tripCargo: state.trips.flatMap((trip) =>
      trip.cargoPackageIds.map((cargoPackageId) => ({
        id: `${trip.id}:${cargoPackageId}`,
        tripId: trip.id,
        cargoPackageId,
        loadedAt: null,
        unloadedAt: null,
        status: "Assigned",
        exception: null
      }))
    ),
    deliveries: state.deliveries.map((delivery) => ({
      id: delivery.id,
      cargoPackageId: delivery.cargoPackageId,
      deliveryType: "Branch Delivery",
      status: delivery.status,
      deliveredTo: delivery.deliveredTo ?? null,
      deliveredAt: new Date(delivery.createdAt),
      deliveredById: null,
      signatureUrl: delivery.signatureUrl ?? null,
      deliveryPhotoUrl: delivery.deliveryPhotoUrl ?? null,
      failedReason: delivery.failedReason ?? null,
      notes: delivery.notes ?? null,
      nextAction: delivery.nextAction ?? null,
      customerAcceptedDamage: false,
      createdAt: new Date(delivery.createdAt)
    })),
    returnRecords: state.returnRecords.map((record) => ({
      ...record,
      notes: record.notes ?? null,
      photoUrl: record.photoUrl ?? null,
      createdAt: new Date(record.createdAt)
    })),
    payments: state.payments.map((payment) => ({
      id: payment.id,
      cargoPackageId: payment.cargoPackageId,
      amountDue: payment.amountDue,
      amountPaid: payment.amountPaid,
      balance: payment.balance,
      method: payment.method,
      collectionPoint: payment.collectionPoint,
      collectedByUserId: payment.collectedByUserId ?? null,
      collectedByName: payment.collectedByName ?? null,
      collectedByRole: payment.collectedByRole ?? null,
      branchId: payment.branchId ?? null,
      branchName: payment.branchName ?? null,
      status: payment.status,
      proofUrl: payment.proofUrl ?? null,
      recordedById: null,
      verifiedById: null,
      notes: payment.notes ?? null,
      createdAt: new Date(payment.createdAt)
    })),
    expenses: state.expenses.map((expense) => ({
      id: expense.id,
      tripId: expense.tripId ?? null,
      branchId: null,
      category: expense.category,
      amount: expense.amount,
      description: expense.description ?? null,
      receiptUrl: expense.receiptUrl ?? null,
      status: expense.status,
      createdById: null,
      approvedById: null,
      createdAt: new Date(expense.createdAt)
    })),
    billingInvoices: state.billingInvoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      amountDue: invoice.amountDue,
      amountPaid: invoice.amountPaid,
      balance: invoice.balance,
      dueRule: invoice.dueRule,
      status: invoice.status,
      createdAt: new Date(invoice.createdAt)
    })),
    billingInvoicePackages: state.billingInvoices.flatMap((invoice) =>
      invoice.packageIds.map((cargoPackageId) => ({
        id: `${invoice.id}:${cargoPackageId}`,
        billingInvoiceId: invoice.id,
        cargoPackageId
      }))
    ),
    receivingDrafts: state.receivingDrafts.map((draft) => ({
      ...draft,
      customerId: draft.customerId ?? null,
      customerNameSnapshot: draft.customerNameSnapshot ?? null,
      customerStatusSnapshot: draft.customerStatusSnapshot ?? null,
      customerDrNumber: draft.customerDrNumber ?? null,
      destination: draft.destination ?? null,
      drPhotoUrl: draft.drPhotoUrl ?? null,
      finalizedReceivingId: draft.finalizedReceivingId ?? null,
      createdAt: new Date(draft.createdAt),
      updatedAt: new Date(draft.updatedAt)
    })),
    receivingIntakeTasks: state.receivingIntakeTasks.map((task) => ({
      ...task,
      customerId: task.customerId ?? null,
      customerDrNumber: task.customerDrNumber ?? null,
      dropOffPerson: task.dropOffPerson ?? null,
      dropOffPhone: task.dropOffPhone ?? null,
      consigneeName: task.consigneeName ?? null,
      destinationBranch: task.destinationBranch ?? null,
      deliveryArea: task.deliveryArea ?? null,
      productId: task.productId ?? null,
      itemDescription: task.itemDescription ?? null,
      quantity: task.quantity ?? null,
      unit: task.unit ?? null,
      drPhotoUrl: task.drPhotoUrl ?? null,
      notes: task.notes ?? null,
      convertedReceivingId: task.convertedReceivingId ?? null,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date(task.updatedAt)
    })),
    hardwareTests: state.hardwareTests.map((test) => ({
      ...test,
      notes: test.notes ?? null,
      createdAt: new Date(test.createdAt)
    })),
    printLogs: state.printLogs.map((log) => ({
      ...log,
      reason: log.reason ?? null,
      deviceName: log.deviceName ?? null,
      createdAt: new Date(log.createdAt)
    })),
    operationChatThreads: state.operationChatThreads.map((thread) => ({
      id: thread.id,
      scope: thread.scope,
      title: thread.title,
      branchName: thread.branchName ?? null,
      cargoPackageId: thread.cargoPackageId ?? null,
      packageNumber: thread.packageNumber ?? null,
      customerName: thread.customerName ?? null,
      description: thread.description ?? null,
      status: thread.status,
      actionType: thread.actionType ?? null,
      proposedPrice: thread.proposedPrice ?? null,
      approvedPrice: thread.approvedPrice ?? null,
      requestedByName: thread.requestedByName ?? null,
      requestedByRole: thread.requestedByRole ?? null,
      createdAt: new Date(thread.createdAt),
      updatedAt: new Date(thread.updatedAt)
    })),
    operationChatMessages: state.operationChatThreads.flatMap((thread) =>
      thread.messages.map((message) => ({
        ...message,
        threadId: thread.id,
        senderUserId: message.senderUserId ?? null,
        system: message.system ?? false,
        createdAt: new Date(message.createdAt)
      }))
    ),
    notifications: state.notifications.map((notification) => ({
      id: notification.id,
      userId: null,
      title: notification.title,
      message: notification.message,
      priority: notification.priority,
      // Notification.type is required by the schema but absent from the
      // service's slim notification shape; use a stable generic value.
      type: "Service",
      entityType: null,
      entityId: null,
      readAt: null,
      createdAt: new Date(notification.createdAt)
    })),
    messageThreads,
    messages,
    auditLogs: state.auditLogs.map((log) => ({
      id: log.id,
      actorId: null,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      beforeJson: null,
      afterJson: null,
      reason: log.reason ?? null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(log.createdAt)
    }))
  };
}

function cargoRowToState(
  row: CargoPackageRow,
  receivingRecordNumber: string,
  photoUrls: string[]
): CargoPackage {
  return {
    id: row.id,
    packageNumber: row.packageNumber,
    receivingRecordNumber,
    customerId: row.customerId,
    customerName: row.customerName,
    productId: row.productId ?? "",
    productBarcode: row.productBarcode ?? undefined,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    destination: row.destination,
    handlingBranchId: row.handlingBranchId,
    handlingBranchName: row.handlingBranchName,
    deliveryType: row.deliveryType as CargoPackage["deliveryType"],
    consigneeName: row.consigneeName ?? undefined,
    deliveryBusinessName: row.deliveryBusinessName ?? undefined,
    addressLine: row.addressLine ?? undefined,
    barangay: row.barangay ?? undefined,
    city: row.city ?? undefined,
    province: row.province ?? undefined,
    landmark: row.landmark ?? undefined,
    deliveryPhone: row.deliveryPhone ?? undefined,
    deliveryNotes: row.deliveryNotes ?? undefined,
    condition: row.condition as CargoPackage["condition"],
    conditionNotes: row.conditionNotes ?? undefined,
    status: row.status as CargoPackage["status"],
    unitPrice: decimalToNumber(row.unitPrice),
    price: decimalToNumber(row.price),
    priceChangeReason: row.priceChangeReason ?? undefined,
    weight: decimalToNumber(row.weight),
    weightUnit: row.weightUnit ?? undefined,
    length: decimalToNumber(row.length),
    width: decimalToNumber(row.width),
    height: decimalToNumber(row.height),
    dimensionUnit: row.dimensionUnit ?? undefined,
    qrValue: row.qrValue,
    photoUrls,
    createdAt: toIso(row.createdAt)
  };
}

export function rowsToState(rows: PrismaStateRows): LoadedServiceState {
  const contactsByCustomer = groupBy(rows.customerContacts, (contact) => contact.customerId);
  const photosByPackage = groupBy(
    rows.photos.filter((photo) => photo.type === "Package"),
    (photo) => photo.cargoPackageId
  );
  const receivingNumberById = new Map(rows.receivingRecords.map((record) => [record.id, record.recordNumber]));
  const tripCargoByTrip = groupBy(rows.tripCargo, (entry) => entry.tripId);
  const billingPackagesByInvoice = groupBy(rows.billingInvoicePackages, (entry) => entry.billingInvoiceId);
  const operationMessagesByThread = groupBy(rows.operationChatMessages, (message) => message.threadId);
  const messagesByThread = groupBy(rows.messages, (message) => message.threadId);
  const roleNameById = new Map(rows.roles.map((role) => [role.id, role.name]));

  const packages = rows.cargoPackages.map((row) =>
    cargoRowToState(
      row,
      receivingNumberById.get(row.receivingRecordId) ?? "",
      (photosByPackage.get(row.id) ?? []).map((photo) => photo.fileUrl)
    )
  );
  const packagesByReceivingId = groupBy(rows.cargoPackages, (row) => row.receivingRecordId);

  const settings = rows.companySettings[0];
  const companyProfile: CompanyProfile | undefined = settings
    ? {
        companyName: settings.companyName,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        logoUrl: settings.logoUrl ?? undefined
      }
    : undefined;

  const messages: PackageMessage[] = [];
  for (const thread of rows.messageThreads) {
    if (!thread.cargoPackageId) continue;
    for (const message of messagesByThread.get(thread.id) ?? []) {
      messages.push({
        id: message.id,
        cargoPackageId: thread.cargoPackageId,
        // Rows written before the senderName column existed load with a
        // null name; keep the stable placeholder for those instead of
        // leaking a database identifier into the UI.
        senderName: message.senderName ?? "Unknown sender",
        body: message.body,
        createdAt: toIso(message.createdAt)
      });
    }
  }

  return {
    sequences: rows.documentSequences.map((row) => [row.documentType, row.lastSequence] as [string, number]),
    customers: rows.customers.map((customer) => ({
      id: customer.id,
      businessName: customer.businessName,
      status: customer.status as Customer["status"],
      tin: customer.tin ?? undefined,
      companyPhone: customer.companyPhone ?? undefined,
      contactPerson: customer.contactPerson ?? undefined,
      phone: customer.phone ?? undefined,
      address: customer.address ?? undefined,
      billingAddress: customer.billingAddress ?? undefined,
      shippingAddress: customer.shippingAddress ?? undefined,
      contacts: (contactsByCustomer.get(customer.id) ?? []).map((contact) => ({
        id: contact.id,
        name: contact.name,
        role: contact.role ?? undefined,
        phone: contact.phone ?? undefined,
        email: contact.email ?? undefined,
        address: contact.address ?? undefined,
        billingAddress: contact.billingAddress ?? undefined,
        shippingAddress: contact.shippingAddress ?? undefined,
        isPrimary: contact.isPrimary,
        status: contact.status as CustomerContact["status"],
        notes: contact.notes ?? undefined,
        createdAt: toIso(contact.createdAt)
      })),
      billingTerm: customer.billingTerm,
      notes: customer.notes ?? undefined,
      createdFromReceivingId: customer.createdFromReceivingId ?? undefined,
      finalizedAt: customer.finalizedAt ? toIso(customer.finalizedAt) : undefined,
      finalizedBy: customer.finalizedBy ?? undefined
    })),
    receivingRecords: rows.receivingRecords.map((record) => ({
      id: record.id,
      recordNumber: record.recordNumber,
      customerId: record.customerId,
      customerName: record.customerName,
      customerDrNumber: record.customerDrNumber ?? undefined,
      sender: record.sender ?? undefined,
      consignee: record.consignee ?? undefined,
      destination: record.destination ?? "",
      drPhotoUrl: record.customerDrPhotoUrl ?? undefined,
      drPhotoAttachedAt: record.drPhotoAttachedAt ? toIso(record.drPhotoAttachedAt) : undefined,
      drPhotoAttachReason: record.drPhotoAttachReason ?? undefined,
      packages: (packagesByReceivingId.get(record.id) ?? []).map((row) =>
        cargoRowToState(row, record.recordNumber, (photosByPackage.get(row.id) ?? []).map((photo) => photo.fileUrl))
      ),
      createdAt: toIso(record.createdAt)
    })),
    receivingDrafts: rows.receivingDrafts.map((draft) => ({
      ...draft,
      customerId: draft.customerId ?? undefined,
      customerNameSnapshot: draft.customerNameSnapshot ?? undefined,
      customerStatusSnapshot: (draft.customerStatusSnapshot ?? undefined) as ReceivingDraft["customerStatusSnapshot"],
      customerDrNumber: draft.customerDrNumber ?? undefined,
      destination: draft.destination ?? undefined,
      drPhotoUrl: draft.drPhotoUrl ?? undefined,
      finalizedReceivingId: draft.finalizedReceivingId ?? undefined,
      createdAt: toIso(draft.createdAt),
      updatedAt: toIso(draft.updatedAt)
    })),
    receivingIntakeTasks: rows.receivingIntakeTasks.map((task) => ({
      ...task,
      status: task.status as ReceivingIntakeTask["status"],
      source: task.source as ReceivingIntakeTask["source"],
      customerId: task.customerId ?? undefined,
      customerDrNumber: task.customerDrNumber ?? undefined,
      dropOffPerson: task.dropOffPerson ?? undefined,
      dropOffPhone: task.dropOffPhone ?? undefined,
      consigneeName: task.consigneeName ?? undefined,
      destinationBranch: task.destinationBranch ?? undefined,
      deliveryArea: task.deliveryArea ?? undefined,
      productId: task.productId ?? undefined,
      itemDescription: task.itemDescription ?? undefined,
      quantity: task.quantity ?? undefined,
      unit: task.unit ?? undefined,
      drPhotoUrl: task.drPhotoUrl ?? undefined,
      notes: task.notes ?? undefined,
      convertedReceivingId: task.convertedReceivingId ?? undefined,
      createdAt: toIso(task.createdAt),
      updatedAt: toIso(task.updatedAt)
    })),
    packages,
    productMasters: rows.productMasters.map((product) => ({
      ...product,
      sku: product.sku ?? undefined,
      barcode: product.barcode ?? undefined,
      brand: product.brand ?? undefined,
      category: product.category ?? undefined,
      defaultPrice: decimalToNumber(product.defaultPrice),
      notes: product.notes ?? undefined,
      photoUrl: product.photoUrl ?? undefined,
      status: product.status as ProductMaster["status"],
      createdAt: toIso(product.createdAt)
    })),
    trucks: rows.trucks.map((truck) => ({
      id: truck.id,
      plateNumber: truck.plateNumber,
      driverName: truck.driverName ?? undefined,
      contactNumber: truck.contactNumber ?? undefined,
      ownerName: truck.ownerName ?? undefined,
      status: truck.status as TruckRecord["status"],
      createdAt: toIso(truck.createdAt),
      updatedAt: truck.updatedAt ? toIso(truck.updatedAt) : undefined
    })),
    trips: rows.trips.map((trip) => ({
      id: trip.id,
      tripNumber: trip.tripNumber,
      origin: trip.origin,
      destination: trip.destination,
      status: trip.status as Trip["status"],
      isMixedTrip: trip.isMixedTrip,
      truckId: trip.truckId ?? undefined,
      plateNumber: trip.plateNumber ?? undefined,
      vehicleDescription: trip.vehicleDescription ?? undefined,
      driverName: trip.driverName ?? undefined,
      driverContactNumber: trip.driverContactNumber ?? undefined,
      truckOwnerName: trip.truckOwnerName ?? undefined,
      loadingPhotoUrl: trip.loadingPhotoUrl ?? undefined,
      loadingPhotoAttachedAt: trip.loadingPhotoAttachedAt ? toIso(trip.loadingPhotoAttachedAt) : undefined,
      mixedTripApprovalStatus: (trip.mixedTripApprovalStatus ?? undefined) as Trip["mixedTripApprovalStatus"],
      mixedTripApprovalNotes: trip.mixedTripApprovalNotes ?? undefined,
      cargoPackageIds: (tripCargoByTrip.get(trip.id) ?? []).map((entry) => entry.cargoPackageId),
      createdAt: toIso(trip.createdAt)
    })),
    deliveries: rows.deliveries.map((delivery) => ({
      id: delivery.id,
      cargoPackageId: delivery.cargoPackageId,
      status: delivery.status as DeliveryRecord["status"],
      deliveredTo: delivery.deliveredTo ?? undefined,
      signatureUrl: delivery.signatureUrl ?? undefined,
      deliveryPhotoUrl: delivery.deliveryPhotoUrl ?? undefined,
      failedReason: delivery.failedReason ?? undefined,
      notes: delivery.notes ?? undefined,
      nextAction: delivery.nextAction ?? undefined,
      createdAt: toIso(delivery.createdAt)
    })),
    payments: rows.payments.map((payment) => ({
      id: payment.id,
      cargoPackageId: payment.cargoPackageId ?? "",
      amountDue: requiredDecimal(payment.amountDue),
      amountPaid: requiredDecimal(payment.amountPaid),
      balance: requiredDecimal(payment.balance),
      method: payment.method,
      collectionPoint: payment.collectionPoint as PaymentRecord["collectionPoint"],
      collectedByUserId: payment.collectedByUserId ?? undefined,
      collectedByName: payment.collectedByName ?? undefined,
      collectedByRole: payment.collectedByRole ?? undefined,
      branchId: payment.branchId ?? undefined,
      branchName: payment.branchName ?? undefined,
      status: payment.status as PaymentRecord["status"],
      proofUrl: payment.proofUrl ?? undefined,
      notes: payment.notes ?? undefined,
      createdAt: toIso(payment.createdAt)
    })),
    expenses: rows.expenses.map((expense) => ({
      id: expense.id,
      tripId: expense.tripId ?? undefined,
      category: expense.category,
      amount: requiredDecimal(expense.amount),
      description: expense.description ?? undefined,
      receiptUrl: expense.receiptUrl ?? undefined,
      status: expense.status as ExpenseRecord["status"],
      createdAt: toIso(expense.createdAt)
    })),
    returnRecords: rows.returnRecords.map((record) => ({
      id: record.id,
      cargoPackageId: record.cargoPackageId,
      reason: record.reason,
      nextAction: record.nextAction as ReturnRecord["nextAction"],
      notes: record.notes ?? undefined,
      photoUrl: record.photoUrl ?? undefined,
      status: record.status as ReturnRecord["status"],
      createdAt: toIso(record.createdAt)
    })),
    billingInvoices: rows.billingInvoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      packageIds: (billingPackagesByInvoice.get(invoice.id) ?? []).map((entry) => entry.cargoPackageId),
      amountDue: requiredDecimal(invoice.amountDue),
      amountPaid: requiredDecimal(invoice.amountPaid),
      balance: requiredDecimal(invoice.balance),
      dueRule: invoice.dueRule,
      status: invoice.status as BillingInvoice["status"],
      createdAt: toIso(invoice.createdAt)
    })),
    notifications: rows.notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      message: notification.message,
      priority: notification.priority,
      createdAt: toIso(notification.createdAt)
    })),
    auditLogs: rows.auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      reason: log.reason ?? undefined,
      createdAt: toIso(log.createdAt)
    })),
    descriptionBarcodes: rows.itemDescriptions
      .filter((entry) => entry.barcode !== null)
      .map((entry) => ({
        id: entry.id,
        customerId: entry.customerId,
        barcode: entry.barcode as string,
        description: entry.description
      })),
    messages,
    operationChatThreads: rows.operationChatThreads.map((thread) => ({
      id: thread.id,
      scope: thread.scope as OperationChatThread["scope"],
      title: thread.title,
      branchName: thread.branchName ?? undefined,
      cargoPackageId: thread.cargoPackageId ?? undefined,
      packageNumber: thread.packageNumber ?? undefined,
      customerName: thread.customerName ?? undefined,
      description: thread.description ?? undefined,
      status: thread.status as OperationChatThread["status"],
      actionType: (thread.actionType ?? undefined) as OperationChatThread["actionType"],
      proposedPrice: decimalToNumber(thread.proposedPrice),
      approvedPrice: decimalToNumber(thread.approvedPrice),
      requestedByName: thread.requestedByName ?? undefined,
      requestedByRole: thread.requestedByRole ?? undefined,
      createdAt: toIso(thread.createdAt),
      updatedAt: toIso(thread.updatedAt),
      messages: (operationMessagesByThread.get(thread.id) ?? []).map((message) => ({
        id: message.id,
        senderUserId: message.senderUserId ?? undefined,
        senderName: message.senderName,
        senderRole: message.senderRole,
        body: message.body,
        system: message.system,
        createdAt: toIso(message.createdAt)
      }))
    })),
    hardwareTests: rows.hardwareTests.map((test) => ({
      ...test,
      scannerResult: test.scannerResult as HardwareTestRecord["scannerResult"],
      printerResult: test.printerResult as HardwareTestRecord["printerResult"],
      cameraResult: test.cameraResult as HardwareTestRecord["cameraResult"],
      signatureResult: test.signatureResult as HardwareTestRecord["signatureResult"],
      pwaResult: test.pwaResult as HardwareTestRecord["pwaResult"],
      notes: test.notes ?? undefined,
      createdAt: toIso(test.createdAt)
    })),
    printLogs: rows.printLogs.map((log) => ({
      ...log,
      action: log.action as PrintLog["action"],
      reason: log.reason ?? undefined,
      outcome: (log.outcome as PrintLog["outcome"]) ?? "HandedOff",
      deviceName: log.deviceName ?? undefined,
      layout: log.layout as PrintLog["layout"],
      createdAt: toIso(log.createdAt)
    })),
    customUsers: rows.users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? undefined,
      role: user.roleId ? roleNameById.get(user.roleId) ?? "" : "",
      branchAccess: user.branchAccess ?? undefined,
      status: user.status as StaffUserRecord["status"],
      createdAt: user.createdAt ? toIso(user.createdAt) : undefined
    })),
    companyProfile,
    branches: rows.branches.map((branch) => ({
      ...branch,
      address: branch.address ?? undefined,
      status: branch.status as Branch["status"]
    })),
    paymentMethods: settings ? [...settings.paymentMethods] : undefined,
    expenseCategories: settings ? [...settings.expenseCategories] : undefined,
    // The override map cannot be reconstructed separately from the single
    // User.branchAccess column; stateToRows already persisted the effective
    // value onto each custom user. See the PR's known mapping gaps.
    userBranchAccessOverrides: {}
  };
}
