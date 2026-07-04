import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildPackageQrValue,
  defaultExpenseCategories,
  defaultPaymentMethods,
  documentPrefixes,
  formatDocumentNumber,
  type CargoStatus,
  type PackageCondition,
  type PaymentStatus,
  type TripStatus
} from "@mts-lbmp/shared";
import { render80mmReceipt } from "@mts-lbmp/printing";
import { renderDeliveryReceipt, renderLoadingManifest, renderQrLabel, toEscPosTextBytes } from "@mts-lbmp/printing";
import { hashSecret, signAuthToken, verifySecret } from "./security.js";
import type {
  CargoPackage,
  Customer,
  CustomerContact,
  BillingInvoice,
  DeliveryRecord,
  ExpenseRecord,
  PaymentRecord,
  PrintLog,
  ReceivingDraft,
  ReceivingIntakeTask,
  ReceivingRecord,
  ReturnRecord,
  Branch,
  CompanyProfile,
  HardwareTestRecord,
  ProductMaster,
  Trip,
  TruckRecord
} from "./logistics.types.js";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

type ListQuery = {
  limit?: string | number;
  cursor?: string;
  search?: string;
  status?: string;
  branch?: string;
};

type AuthContext = {
  id?: string;
  role?: string;
  branchAccess?: string;
};

type OperationChatMessage = {
  id: string;
  senderUserId?: string;
  senderName: string;
  senderRole: string;
  body: string;
  system?: boolean;
  createdAt: string;
};

type OperationChatThread = {
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
};

function parseLimit(value: ListQuery["limit"]) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(Math.trunc(parsed), 500);
}

function queryMatches(values: unknown[], search?: string) {
  const query = search?.trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(query));
}

function statusMatches(status: string | undefined, filter?: string) {
  const filters = filter?.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!filters.length) return true;
  return filters.includes(String(status ?? "").toLowerCase());
}

function branchMatches(branch: string | undefined, values: unknown[]) {
  const target = branch?.trim().toLowerCase();
  if (!target || target === "all branches") return true;
  return values.some((value) => String(value ?? "").toLowerCase() === target);
}

function applyCursorAndLimit<T extends { id: string }>(items: T[], query: ListQuery = {}) {
  const cursorIndex = query.cursor ? items.findIndex((item) => item.id === query.cursor) : -1;
  const afterCursor = cursorIndex >= 0 ? items.slice(cursorIndex + 1) : items;
  const limit = parseLimit(query.limit);
  return limit ? afterCursor.slice(0, limit) : afterCursor;
}

function buildPrimaryContact(input: { contactPerson?: string; phone?: string; address?: string; contactRole?: string; contactEmail?: string; contactIsPrimary?: boolean }): CustomerContact[] {
  if (!input.contactPerson?.trim() && !input.phone?.trim()) return [];
  return [
    {
      id: id("ctc"),
      name: input.contactPerson?.trim() || "Primary Contact",
      role: input.contactRole?.trim() || "Primary Contact",
      phone: input.phone?.trim() || undefined,
      email: input.contactEmail?.trim() || undefined,
      address: input.address?.trim() || undefined,
      isPrimary: input.contactIsPrimary ?? true,
      status: "Active",
      createdAt: new Date().toISOString()
    }
  ];
}

type StaffUserRecord = {
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
};

const demoPasswordHash = hashSecret("password", "mts-lbmp-demo-password-salt");

const demoUsers: StaffUserRecord[] = [
  {
    id: "user_daet_owner",
    name: "Daet Owner Demo",
    email: "daet.owner@mts.local",
    role: "Daet Owner",
    staffCode: "0000",
    branchId: "branch_daet",
    branchAccess: "Daet",
    permissionPreset: "Branch Owner",
    canApprove: ["Daet prices", "Daet expenses", "Mixed trips"],
    status: "Active"
  },
  {
    id: "user_naga_owner",
    name: "Naga Owner Demo",
    email: "naga.owner@mts.local",
    role: "Naga Owner",
    staffCode: "9999",
    branchId: "branch_naga",
    branchAccess: "Naga",
    permissionPreset: "Branch Owner",
    canApprove: ["Naga prices", "Naga expenses", "Mixed trips"],
    status: "Active"
  },
  {
    id: "user_system_admin",
    name: "System Admin Demo",
    email: "admin@mts.local",
    role: "System Admin",
    staffCode: "0001",
    branchAccess: "All branches",
    permissionPreset: "System Admin",
    canApprove: ["System configuration", "All branch support"],
    status: "Active"
  },
  {
    id: "user_receiving",
    name: "Receiving Demo",
    email: "receiving@mts.local",
    role: "Receiving Staff",
    staffCode: "1111",
    branchAccess: "Origin Warehouse",
    permissionPreset: "Receiving Staff",
    canApprove: [],
    status: "Active"
  },
  {
    id: "user_delivery",
    name: "Delivery Demo",
    email: "delivery@mts.local",
    role: "Delivery Staff",
    staffCode: "2222",
    branchAccess: "Daet / Naga",
    permissionPreset: "Delivery Staff",
    canApprove: [],
    status: "Active"
  },
  {
    id: "user_customer",
    name: "Customer Demo",
    email: "customer@mts.local",
    role: "Customer Owner",
    branchAccess: "Customer portal only",
    permissionPreset: "Customer Owner",
    canApprove: [],
    status: "Active"
  }
];

const defaultProductMasters: ProductMaster[] = [
  {
    id: "prod_angle_bar",
    name: "Angle bar",
    sku: "PROD-ANGLE-BAR",
    barcode: "MTS-PROD-ANGLE-BAR",
    brand: "Generic",
    category: "Hardware",
    defaultUnit: "length",
    defaultPrice: 120,
    notes: "Common hardware item. Confirm size and quantity during receiving.",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "prod_tubular",
    name: "Tubular steel",
    sku: "PROD-TUBULAR",
    barcode: "MTS-PROD-TUBULAR",
    brand: "Generic",
    category: "Hardware",
    defaultUnit: "length",
    defaultPrice: 150,
    notes: "Confirm length, thickness, and bundled quantity.",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "prod_plywood",
    name: "Plywood",
    sku: "PROD-PLYWOOD",
    barcode: "MTS-PROD-PLYWOOD",
    brand: "Generic",
    category: "Construction",
    defaultUnit: "pcs",
    defaultPrice: 90,
    notes: "Use product photo when unfamiliar or mixed sizes.",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "prod_assorted_box",
    name: "Assorted goods box",
    sku: "PROD-ASSORTED-BOX",
    barcode: "MTS-PROD-ASSORTED-BOX",
    brand: "No brand",
    category: "General Merchandise",
    defaultUnit: "box",
    defaultPrice: 80,
    notes: "Use when customer sends mixed items in one box.",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "prod_rice_sack",
    name: "Rice sack",
    barcode: "MTS-PROD-RICE-SACK",
    brand: "Generic",
    category: "Agricultural",
    defaultUnit: "sack",
    defaultPrice: 70,
    notes: "Check weight and condition at receiving.",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "prod_appliance",
    name: "Small appliance",
    barcode: "MTS-PROD-SMALL-APPLIANCE",
    brand: "Mixed",
    category: "Appliance",
    defaultUnit: "pcs",
    defaultPrice: 180,
    notes: "Require photo if box is damaged or wet.",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  }
];

const defaultTruckRecords: TruckRecord[] = [
  {
    id: "truck_company_001",
    plateNumber: "MTS-001",
    driverName: "Company Driver",
    contactNumber: "0917 100 0001",
    ownerName: "Mancenido Trucking Services",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "truck_rental_daet_001",
    plateNumber: "DAET-101",
    driverName: "Ramon Driver",
    contactNumber: "0917 210 0101",
    ownerName: "Daet Rental Truck Provider",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "truck_rental_naga_001",
    plateNumber: "NAGA-202",
    driverName: "Marco Driver",
    contactNumber: "0918 220 0202",
    ownerName: "Naga Partner Trucking",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "truck_partner_001",
    plateNumber: "B2B-303",
    driverName: "Luis Partner",
    contactNumber: "0919 330 0303",
    ownerName: "Partner Truck Owner",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "truck_rental_backup_001",
    plateNumber: "RENT-404",
    driverName: "Backup Driver",
    contactNumber: "0920 440 0404",
    ownerName: "Backup Rental Fleet",
    status: "Active",
    createdAt: "2026-07-01T00:00:00.000Z"
  }
];

function mergeTruckRecords(savedTrucks?: TruckRecord[]) {
  const byPlate = new Map<string, TruckRecord>();
  for (const truck of savedTrucks ?? []) {
    byPlate.set(truck.plateNumber.toUpperCase(), truck);
  }
  return Array.from(byPlate.values());
}

@Injectable()
export class LogisticsService {
  private readonly dataFile = resolve(process.env.INIT_CWD ?? process.cwd(), "storage/dev-data/mts-lbmp.json");
  private readonly uploadDir = resolve(process.env.INIT_CWD ?? process.cwd(), "storage/test-uploads");
  private companyProfile: CompanyProfile = {
    companyName: "Mancenido Trucking Services",
    address: "Configured by owner",
    phone: "Configured by owner",
    email: "Configured by owner"
  };
  private branches: Branch[] = [
    {
      id: "branch_origin",
      name: "Origin Warehouse",
      code: "ORIGIN",
      canReceive: true,
      canDispatch: true,
      canDeliver: false,
      canReturn: true,
      canStage: true,
      status: "Active"
    },
    {
      id: "branch_daet",
      name: "Daet",
      code: "DAET",
      canReceive: false,
      canDispatch: false,
      canDeliver: true,
      canReturn: true,
      canStage: true,
      status: "Active"
    },
    {
      id: "branch_naga",
      name: "Naga",
      code: "NAGA",
      canReceive: false,
      canDispatch: false,
      canDeliver: true,
      canReturn: true,
      canStage: true,
      status: "Active"
    }
  ];
  private paymentMethods: string[] = [...defaultPaymentMethods];
  private expenseCategories: string[] = [...defaultExpenseCategories];
  private sequences = new Map<string, number>();
  private customers: Customer[] = [];

  private receivingRecords: ReceivingRecord[] = [];
  private receivingDrafts: ReceivingDraft[] = [];
  private receivingIntakeTasks: ReceivingIntakeTask[] = [];
  private packages: CargoPackage[] = [];
  private productMasters: ProductMaster[] = [];
  private trucks: TruckRecord[] = mergeTruckRecords();
  private trips: Trip[] = [];
  private deliveries: DeliveryRecord[] = [];
  private payments: PaymentRecord[] = [];
  private expenses: ExpenseRecord[] = [];
  private returnRecords: ReturnRecord[] = [];
  private billingInvoices: BillingInvoice[] = [];
  private descriptionBarcodes: Array<{ id: string; customerId: string; barcode: string; description: string }> = [];
  private messages: Array<{ id: string; cargoPackageId: string; senderName: string; body: string; createdAt: string }> = [];
  private operationChatThreads: OperationChatThread[] = [];
  private hardwareTests: HardwareTestRecord[] = [];
  private printLogs: PrintLog[] = [];
  private customUsers: StaffUserRecord[] = [];
  private userBranchAccessOverrides: Record<string, string> = {};
  private notifications: Array<{ id: string; title: string; message: string; priority: string; createdAt: string }> = [];
  private auditLogs: Array<{ id: string; action: string; entityType: string; entityId: string; reason?: string; createdAt: string }> = [];

  constructor() {
    this.loadData();
    this.reconcileProductsFromCargo();
  }

  getBootstrap() {
    return {
      customers: this.customers,
      defaultPaymentMethods: this.paymentMethods,
      defaultExpenseCategories: this.expenseCategories,
      companyProfile: this.companyProfile,
      branches: this.branches,
      trucks: this.listTrucks(),
      users: this.getDemoUsers()
        .filter((user) => user.role !== "Customer Owner")
        .map(({ staffCode, ...user }) => ({
          ...user,
          hasStaffCode: Boolean(staffCode),
          lastLogin: new Date().toISOString()
        }))
    };
  }

  login(input: { email: string; password: string }) {
    const user = this.getDemoUsers().find((entry) => entry.email === input.email);
    if (!user || user.status === "Inactive" || !verifySecret(input.password ?? "", demoPasswordHash)) {
      throw new BadRequestException("Invalid demo credentials");
    }
    this.audit("auth.login", "User", user.id);
    const { staffCode, ...safeUser } = user;
    return {
      user: { ...safeUser, hasStaffCode: Boolean(staffCode), lastLogin: new Date().toISOString() },
      token: signAuthToken({ userId: user.id, role: user.role, branchAccess: user.branchAccess }),
      note: "Signed demo JWT. Configure JWT_SECRET/AUTH_SECRET before production."
    };
  }

  loginWithStaffCode(input: { staffCode: string }) {
    const cleanCode = String(input.staffCode ?? "").trim();
    const user = this.getDemoUsers().find((entry) => entry.status !== "Inactive" && entry.staffCode === cleanCode && ["System Admin", "Daet Owner", "Naga Owner", "Receiving Staff", "Delivery Staff", "Delivery Admin"].includes(entry.role));
    if (!user) {
      throw new BadRequestException("Invalid staff code");
    }
    this.audit("auth.staffCodeLogin", "User", user.id);
    const { staffCode, ...safeUser } = user;
    return {
      user: { ...safeUser, hasStaffCode: true, lastLogin: new Date().toISOString() },
      token: signAuthToken({ userId: user.id, role: user.role, branchAccess: user.branchAccess }),
      note: "Signed demo staff-code JWT. Production should hash staff PINs, lock failed attempts, and audit device/session."
    };
  }

  getDashboard(user: { role?: string; branchAccess?: string } = { role: "Daet Owner", branchAccess: "Daet" }) {
    const canViewFinancialSummary = ["System Admin", "Daet Owner", "Naga Owner"].includes(user.role ?? "");
    const branchName = user.role === "Daet Owner" ? "Daet" : user.role === "Naga Owner" ? "Naga" : undefined;
    const branchPackages = branchName ? this.packages.filter((pkg) => pkg.handlingBranchName === branchName || pkg.destination === branchName) : this.packages;
    const branchPackageIds = new Set(branchPackages.map((pkg) => pkg.id));
    const branchTrips = branchName
      ? this.trips.filter((trip) => trip.destination === branchName || trip.cargoPackageIds.some((packageId) => branchPackageIds.has(packageId)))
      : this.trips;
    const branchTripIds = new Set(branchTrips.map((trip) => trip.id));
    const cargoWaiting = branchPackages.filter((pkg) => pkg.status === "Waiting for Loading" || pkg.status === "Received").length;
    const cargoWithoutPrice = branchPackages.filter((pkg) => pkg.price == null).length;
    const delivered = branchPackages.filter((pkg) => pkg.status === "Delivered").length;
    const failedDeliveries = this.deliveries.filter((delivery) => {
      const cargo = this.packages.find((pkg) => pkg.id === delivery.cargoPackageId);
      return delivery.status === "Failed Delivery" && (!branchName || cargo?.handlingBranchName === branchName || cargo?.destination === branchName);
    }).length;
    const paymentsCollected = this.payments
      .filter((payment) => !branchName || payment.branchName === branchName || branchPackageIds.has(payment.cargoPackageId))
      .reduce((sum, payment) => sum + payment.amountPaid, 0);
    const approvedExpenses = this.expenses
      .filter((expense) => expense.status === "Approved" && (!branchName || (expense.tripId && branchTripIds.has(expense.tripId))))
      .reduce((sum, expense) => sum + expense.amount, 0);
    const deliveredRevenue = branchPackages
      .filter((pkg) => pkg.status === "Delivered")
      .reduce((sum, pkg) => sum + (pkg.price ?? 0), 0);

    return {
      cargoWaiting,
      cargoWithoutPrice,
      pendingCustomers: this.customers.filter((customer) => customer.status === "Pending").length,
      activeTrips: branchTrips.filter((trip) => !["Completed", "Cancelled"].includes(trip.status)).length,
      delivered,
      failedDeliveries,
      paymentsCollected: canViewFinancialSummary ? paymentsCollected : undefined,
      expensesAwaitingApproval: canViewFinancialSummary ? this.expenses.filter((expense) => expense.status === "Submitted" && (!branchName || (expense.tripId && branchTripIds.has(expense.tripId)))).length : undefined,
      estimatedProfit: canViewFinancialSummary ? deliveredRevenue - approvedExpenses : undefined,
      notifications: this.notifications.slice(-8).reverse(),
      branchScope: branchName ?? "All branches"
    };
  }

  listPackages(query: ListQuery = {}) {
    const records = this.packages.filter((pkg) =>
      statusMatches(pkg.status, query.status) &&
      branchMatches(query.branch, [pkg.handlingBranchName, pkg.destination]) &&
      queryMatches([
        pkg.id,
        pkg.packageNumber,
        pkg.receivingRecordNumber,
        pkg.customerName,
        pkg.description,
        pkg.consigneeName,
        pkg.destination,
        pkg.handlingBranchName,
        pkg.city,
        pkg.status,
        pkg.price
      ], query.search)
    );
    return applyCursorAndLimit(records, query);
  }

  listTrips(query: ListQuery = {}) {
    const records = this.trips.filter((trip) =>
      statusMatches(trip.status, query.status) &&
      branchMatches(query.branch, [trip.destination]) &&
      queryMatches([
        trip.id,
        trip.tripNumber,
        trip.origin,
        trip.destination,
        trip.status,
        trip.vehicleDescription,
        trip.plateNumber,
        trip.driverName,
        trip.driverContactNumber,
        trip.truckOwnerName
      ], query.search)
    );
    return applyCursorAndLimit(records, query);
  }

  listTrucks() {
    return this.trucks.filter((truck) => truck.status !== "Inactive");
  }

  saveTruck(input: { plateNumber: string; driverName?: string; contactNumber?: string; ownerName?: string }) {
    if (!input.plateNumber?.trim()) throw new BadRequestException("Plate number is required");
    const plateNumber = input.plateNumber.trim().toUpperCase();
    const existing = this.trucks.find((truck) => truck.plateNumber.toUpperCase() === plateNumber);
    const now = new Date().toISOString();
    if (existing) {
      existing.driverName = input.driverName?.trim() || existing.driverName;
      existing.contactNumber = input.contactNumber?.trim() || existing.contactNumber;
      existing.ownerName = input.ownerName?.trim() || existing.ownerName;
      existing.status = "Active";
      existing.updatedAt = now;
      this.audit("trucks.update", "Truck", existing.id, plateNumber);
      this.saveData();
      return existing;
    }
    const truck: TruckRecord = {
      id: id("truck"),
      plateNumber,
      driverName: input.driverName?.trim() || undefined,
      contactNumber: input.contactNumber?.trim() || undefined,
      ownerName: input.ownerName?.trim() || undefined,
      status: "Active",
      createdAt: now
    };
    this.trucks.push(truck);
    this.audit("trucks.create", "Truck", truck.id, plateNumber);
    this.saveData();
    return truck;
  }

  listReceivingRecords() {
    return this.receivingRecords.map((record) => this.syncReceivingRecordPackages(record));
  }

  listDeliveries() {
    return this.deliveries;
  }

  listPayments(query: ListQuery = {}) {
    const records = this.payments.filter((payment) => {
      const cargo = this.packages.find((pkg) => pkg.id === payment.cargoPackageId);
      return statusMatches(payment.status, query.status) &&
        branchMatches(query.branch, [payment.branchName, cargo?.handlingBranchName, cargo?.destination]) &&
        queryMatches([
          payment.id,
          payment.cargoPackageId,
          payment.amountDue,
          payment.amountPaid,
          payment.balance,
          payment.method,
          payment.status,
          payment.collectionPoint,
          payment.collectedByName,
          cargo?.packageNumber,
          cargo?.receivingRecordNumber,
          cargo?.customerName,
          cargo?.description
        ], query.search);
    });
    return applyCursorAndLimit(records, query);
  }

  listExpenses(query: ListQuery = {}) {
    const records = this.expenses.filter((expense) => {
      const trip = expense.tripId ? this.trips.find((entry) => entry.id === expense.tripId) : undefined;
      return statusMatches(expense.status, query.status) &&
        branchMatches(query.branch, [trip?.destination]) &&
        queryMatches([
          expense.id,
          expense.category,
          expense.amount,
          expense.description,
          expense.status,
          expense.tripId,
          trip?.tripNumber,
          trip?.destination,
          trip?.plateNumber,
          trip?.driverName
        ], query.search);
    });
    return applyCursorAndLimit(records, query);
  }

  listReturnRecords() {
    return [...this.returnRecords].reverse();
  }

  listBillingInvoices() {
    return [...this.billingInvoices].reverse();
  }

  listAuditLogs(query: ListQuery = {}) {
    const records = [...this.auditLogs].reverse().filter((log) =>
      statusMatches(log.entityType, query.status) &&
      queryMatches([log.id, log.action, log.entityType, log.entityId, log.reason, log.createdAt], query.search)
    );
    return applyCursorAndLimit(records, query);
  }

  listHardwareTests() {
    return [...this.hardwareTests].reverse();
  }

  createHardwareTest(input: Omit<HardwareTestRecord, "id" | "createdAt">) {
    const record: HardwareTestRecord = {
      id: id("hw"),
      deviceName: input.deviceName?.trim() || "NB80 Android POS",
      scannerResult: input.scannerResult,
      printerResult: input.printerResult,
      cameraResult: input.cameraResult,
      signatureResult: input.signatureResult,
      pwaResult: input.pwaResult,
      notes: input.notes,
      createdAt: new Date().toISOString()
    };
    this.hardwareTests.push(record);
    const failed = [
      ["Scanner", record.scannerResult],
      ["Printer", record.printerResult],
      ["Camera", record.cameraResult],
      ["Signature", record.signatureResult],
      ["PWA", record.pwaResult]
    ].filter(([, result]) => result === "Fail");
    if (failed.length) {
      this.notify("NB80 hardware issue", `${failed.map(([name]) => name).join(", ")} need review.`, "High");
    }
    this.audit("hardware.test.create", "HardwareTest", record.id);
    this.saveData();
    return record;
  }

  getSettings() {
    return {
      companyProfile: this.companyProfile,
      branches: this.branches,
      paymentMethods: this.paymentMethods,
      expenseCategories: this.expenseCategories
    };
  }

  updateCompanyProfile(input: Partial<CompanyProfile>) {
    this.companyProfile = {
      ...this.companyProfile,
      ...input,
      companyName: input.companyName?.trim() || this.companyProfile.companyName
    };
    this.audit("settings.company.update", "CompanyProfile", "company");
    this.saveData();
    return this.companyProfile;
  }

  createBranch(input: Omit<Branch, "id" | "status"> & { status?: "Active" | "Inactive" }) {
    if (!input.name?.trim() || !input.code?.trim()) {
      throw new BadRequestException("Branch name and code are required");
    }
    const normalizedCode = input.code.trim().toUpperCase();
    if (this.branches.some((branch) => branch.code === normalizedCode)) {
      throw new BadRequestException("Branch code already exists");
    }
    const branch: Branch = {
      id: id("branch"),
      name: input.name.trim(),
      code: normalizedCode,
      address: input.address,
      canReceive: Boolean(input.canReceive),
      canDispatch: Boolean(input.canDispatch),
      canDeliver: Boolean(input.canDeliver),
      canReturn: Boolean(input.canReturn),
      canStage: Boolean(input.canStage),
      status: input.status ?? "Active"
    };
    this.branches.push(branch);
    this.audit("settings.branch.create", "Branch", branch.id);
    this.saveData();
    return branch;
  }

  updateBranch(branchId: string, input: Partial<Branch>) {
    const branch = this.branches.find((entry) => entry.id === branchId || entry.code === branchId);
    if (!branch) throw new NotFoundException("Branch not found");
    Object.assign(branch, {
      ...input,
      code: input.code ? input.code.toUpperCase() : branch.code
    });
    this.audit("settings.branch.update", "Branch", branch.id);
    this.saveData();
    return branch;
  }

  updateUserBranchAccess(userId: string, input: { branchAccess: string }) {
    const user = this.getDemoUsers().find((entry) => entry.id === userId);
    if (!user) throw new NotFoundException("User not found");
    const branchAccess = input.branchAccess?.trim();
    if (!branchAccess) throw new BadRequestException("Branch access is required");
    this.userBranchAccessOverrides[userId] = branchAccess;
    this.audit("settings.user.branchAccess.update", "User", userId, branchAccess);
    this.saveData();
    const updated = this.getDemoUsers().find((entry) => entry.id === userId)!;
    const { staffCode, ...safeUser } = updated;
    return { ...safeUser, hasStaffCode: Boolean(staffCode), lastLogin: new Date().toISOString() };
  }

  createStaffUser(input: {
    name: string;
    phone?: string;
    email?: string;
    role: string;
    branchAccess: string;
    staffCode: string;
    status?: "Active" | "Inactive";
  }) {
    const name = input.name?.trim();
    const staffCode = input.staffCode?.trim();
    if (!name) throw new BadRequestException("Staff name is required");
    if (!staffCode) throw new BadRequestException("Staff code is required");
    if (this.getDemoUsers().some((user) => user.staffCode === staffCode)) {
      throw new BadRequestException("Staff code is already used");
    }
    const allowedRoles = ["Receiving Staff", "Delivery Staff", "Delivery Admin"];
    if (!allowedRoles.includes(input.role)) {
      throw new BadRequestException("Only receiving and delivery staff can be added here");
    }
    const user: StaffUserRecord = {
      id: id("user"),
      name,
      phone: input.phone?.trim() || undefined,
      email: input.email?.trim() || `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "staff"}@mts.local`,
      role: input.role,
      staffCode,
      branchAccess: input.branchAccess?.trim() || "Daet / Naga",
      permissionPreset: input.role,
      canApprove: [],
      status: input.status ?? "Active",
      createdAt: new Date().toISOString()
    };
    this.customUsers.push(user);
    this.audit("settings.user.create", "User", user.id, `${user.name} - ${user.role} - ${user.branchAccess}`);
    this.saveData();
    const { staffCode: hiddenCode, ...safeUser } = user;
    return { ...safeUser, hasStaffCode: Boolean(hiddenCode), lastLogin: new Date().toISOString() };
  }

  updateStaffUser(userId: string, input: Partial<Pick<StaffUserRecord, "name" | "phone" | "email" | "role" | "branchAccess" | "staffCode" | "status">>) {
    const customUser = this.customUsers.find((entry) => entry.id === userId);
    const demoUser = demoUsers.find((entry) => entry.id === userId);
    const user = customUser ?? demoUser;
    if (!user) throw new NotFoundException("User not found");

    if (input.staffCode?.trim() && input.staffCode.trim() !== user.staffCode && this.getDemoUsers().some((entry) => entry.id !== userId && entry.staffCode === input.staffCode?.trim())) {
      throw new BadRequestException("Staff code is already used");
    }

    if (customUser) {
      if (input.name?.trim()) customUser.name = input.name.trim();
      if (input.phone !== undefined) customUser.phone = input.phone.trim() || undefined;
      if (input.email !== undefined) customUser.email = input.email.trim() || undefined;
      if (input.role && ["Receiving Staff", "Delivery Staff", "Delivery Admin"].includes(input.role)) {
        customUser.role = input.role;
        customUser.permissionPreset = input.role;
      }
      if (input.staffCode?.trim()) customUser.staffCode = input.staffCode.trim();
      if (input.status) customUser.status = input.status;
    } else if (input.status) {
      user.status = input.status;
    }

    if (input.branchAccess?.trim()) {
      this.userBranchAccessOverrides[userId] = input.branchAccess.trim();
    }

    this.audit("settings.user.update", "User", userId, `${user.name} - ${input.role ?? user.role} - ${input.branchAccess ?? this.userBranchAccessOverrides[userId] ?? user.branchAccess}`);
    this.saveData();
    const updated = this.getDemoUsers().find((entry) => entry.id === userId)!;
    const { staffCode, ...safeUser } = updated;
    return { ...safeUser, hasStaffCode: Boolean(staffCode), lastLogin: new Date().toISOString() };
  }

  getAuthUserById(userId: string) {
    const user = this.getDemoUsers().find((entry) => entry.id === userId && entry.status !== "Inactive");
    if (!user) return undefined;
    return {
      id: user.id,
      role: user.role,
      branchAccess: user.branchAccess
    };
  }

  updatePaymentMethods(input: { methods: string[] }) {
    this.paymentMethods = this.cleanList(input.methods, "Payment method");
    this.audit("settings.paymentMethods.update", "Settings", "paymentMethods");
    this.saveData();
    return this.paymentMethods;
  }

  updateExpenseCategories(input: { categories: string[] }) {
    this.expenseCategories = this.cleanList(input.categories, "Expense category");
    this.audit("settings.expenseCategories.update", "Settings", "expenseCategories");
    this.saveData();
    return this.expenseCategories;
  }

  async uploadFile(input: { dataUrl: string; fileName: string; type: string; entityId?: string }) {
    const match = input.dataUrl.match(/^data:(?<mime>[-\w/+]+);base64,(?<data>.+)$/);
    if (!match?.groups?.data || !match.groups.mime) {
      throw new BadRequestException("Upload must be a base64 data URL");
    }
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(match.groups.mime)) {
      throw new BadRequestException("Only JPEG, PNG, and WebP images are accepted");
    }
    const buffer = Buffer.from(match.groups.data, "base64");
    const maxBytes = 5 * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      throw new BadRequestException("Upload exceeds 5MB maximum size");
    }
    mkdirSync(this.uploadDir, { recursive: true });
    const extension = match.groups.mime.split("/")[1] ?? "jpg";
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60);
    const storedName = `${Date.now()}-${id("upload")}-${safeName}.${extension}`;
    const storedPath = resolve(this.uploadDir, storedName);
    await writeFile(storedPath, buffer);
    const publicUrl = `/uploads/${storedName}`;
    this.audit("uploads.create", input.type, input.entityId ?? storedName);
    this.saveData();
    return {
      fileUrl: publicUrl,
      fileName: storedName,
      mimeType: match.groups.mime,
      size: buffer.byteLength,
      type: input.type
    };
  }

  trackShipment(reference: string) {
    const cargo = this.findPackage(reference);
    return {
      packageNumber: cargo.packageNumber,
      receivingRecordNumber: cargo.receivingRecordNumber,
      description: cargo.description,
      destination: cargo.destination,
      condition: cargo.condition,
      status: cargo.status,
      price: cargo.price,
      customerName: cargo.customerName,
      qrValue: cargo.qrValue,
      messages: this.messages.filter((message) => message.cargoPackageId === cargo.id)
    };
  }

  scanDescription(input: { customerId: string; barcode: string }) {
    const match = this.descriptionBarcodes.find(
      (entry) => entry.customerId === input.customerId && entry.barcode === input.barcode
    );
    return {
      found: Boolean(match),
      barcode: input.barcode,
      description: match?.description ?? null
    };
  }

  linkDescriptionBarcode(input: { customerId: string; barcode: string; description: string }) {
    const existing = this.descriptionBarcodes.find(
      (entry) => entry.customerId === input.customerId && entry.barcode === input.barcode
    );
    if (existing) {
      existing.description = input.description;
      this.saveData();
      return existing;
    }
    const record = { id: id("bar"), customerId: input.customerId, barcode: input.barcode, description: input.description };
    this.descriptionBarcodes.push(record);
    this.audit("barcode.link", "DescriptionBarcode", record.id);
    this.saveData();
    return record;
  }

  listProductMasters(query: ListQuery = {}) {
    const records = this.productMasters.filter((product) =>
      product.status !== "Archived" &&
      queryMatches([
        product.id,
        product.name,
        product.sku,
        product.barcode,
        product.category,
        product.brand,
        product.defaultUnit,
        product.defaultPrice,
        product.notes
      ], query.search)
    );
    return applyCursorAndLimit(records, query);
  }

  private normalizeProductName(value: string) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private nextProductSku() {
    const used = new Set(this.productMasters.map((product) => product.sku).filter(Boolean));
    let counter = this.productMasters.length + 1;
    let candidate = "";
    do {
      candidate = `PROD-${String(counter).padStart(6, "0")}`;
      counter += 1;
    } while (used.has(candidate));
    return candidate;
  }

  private ensureProductMasterForCargo(input: {
    description: string;
    sku?: string;
    barcode?: string;
    brand?: string;
    category?: string;
    unit?: string;
    price?: number | null;
    photoUrl?: string;
    notes?: string;
  }) {
    const name = input.description?.trim();
    if (!name) throw new BadRequestException("Product description is required");
    const sku = input.sku?.trim() || undefined;
    const barcode = input.barcode?.trim() || undefined;
    const normalized = this.normalizeProductName(name);
    const bySku = sku
      ? this.productMasters.find((entry) => entry.sku?.toLowerCase() === sku.toLowerCase() && entry.status !== "Archived")
      : undefined;
    const byBarcode = barcode
      ? this.productMasters.find((entry) => entry.barcode === barcode && entry.status !== "Archived")
      : undefined;
    const existing = bySku ?? byBarcode ?? this.productMasters.find((entry) => this.normalizeProductName(entry.name) === normalized && entry.status !== "Archived");
    if (existing) {
      existing.sku = existing.sku ?? sku ?? existing.sku;
      existing.barcode = existing.barcode ?? barcode;
      existing.brand = existing.brand ?? input.brand?.trim() ?? existing.brand;
      existing.category = existing.category ?? input.category?.trim() ?? existing.category;
      existing.defaultUnit = input.unit?.trim() || existing.defaultUnit || "pcs";
      existing.defaultPrice = existing.defaultPrice ?? input.price ?? null;
      existing.photoUrl = existing.photoUrl ?? input.photoUrl?.trim() ?? existing.photoUrl;
      return existing;
    }

    const product: ProductMaster = {
      id: id("prd"),
      name,
      sku: sku || this.nextProductSku(),
      barcode,
      brand: input.brand?.trim() || undefined,
      category: input.category?.trim() || "General Merchandise",
      defaultUnit: input.unit?.trim() || "pcs",
      defaultPrice: input.price ?? null,
      notes: input.notes?.trim() || "Created automatically from receiving/cargo history.",
      photoUrl: input.photoUrl?.trim() || undefined,
      status: "Active",
      createdAt: new Date().toISOString()
    };
    this.productMasters.push(product);
    this.audit("products.auto_create", "ProductMaster", product.id, "Created from cargo/receiving");
    return product;
  }

  scanProductMaster(input: { barcode: string }) {
    const barcode = input.barcode?.trim();
    if (!barcode) throw new BadRequestException("Product code is required");
    const normalizedCode = barcode.toLowerCase();
    const product = this.productMasters.find((entry) =>
      entry.status !== "Archived" &&
      [entry.barcode, entry.sku, entry.name].some((value) => String(value ?? "").trim().toLowerCase() === normalizedCode)
    );
    return { found: Boolean(product), product: product ?? null };
  }

  createProductMaster(input: { name: string; sku?: string; barcode?: string; brand?: string; category?: string; defaultUnit?: string; defaultPrice?: number | null; notes?: string; photoUrl?: string }) {
    if (!input.name?.trim()) throw new BadRequestException("Product name is required");
    const sku = input.sku?.trim() || undefined;
    const barcode = input.barcode?.trim() || undefined;
    const defaultPrice = input.defaultPrice == null || input.defaultPrice === undefined ? null : Number(input.defaultPrice);
    if (defaultPrice != null && (!Number.isFinite(defaultPrice) || defaultPrice < 0)) {
      throw new BadRequestException("Default price must be zero or greater");
    }
    const normalizedName = this.normalizeProductName(input.name);
    const existing = sku
      ? this.productMasters.find((entry) => entry.sku?.toLowerCase() === sku.toLowerCase() && entry.status !== "Archived")
      : barcode
        ? this.productMasters.find((entry) => entry.barcode === barcode && entry.status !== "Archived")
        : this.productMasters.find((entry) => this.normalizeProductName(entry.name) === normalizedName && entry.status !== "Archived");
    if (existing) {
      existing.name = input.name.trim();
      existing.sku = sku || existing.sku || this.nextProductSku();
      existing.barcode = barcode || existing.barcode;
      existing.brand = input.brand?.trim() || existing.brand;
      existing.category = input.category?.trim() || existing.category;
      existing.defaultUnit = input.defaultUnit?.trim() || existing.defaultUnit || "pcs";
      existing.defaultPrice = defaultPrice ?? existing.defaultPrice ?? null;
      existing.notes = input.notes?.trim() || existing.notes;
      existing.photoUrl = input.photoUrl?.trim() || existing.photoUrl;
      this.audit("products.update", "ProductMaster", existing.id, "Updated by barcode");
      this.saveData();
      return existing;
    }
    const product: ProductMaster = {
      id: id("prd"),
      name: input.name.trim(),
      sku: sku || this.nextProductSku(),
      barcode,
      brand: input.brand?.trim() || undefined,
      category: input.category?.trim() || undefined,
      defaultUnit: input.defaultUnit?.trim() || "pcs",
      defaultPrice,
      notes: input.notes?.trim() || undefined,
      photoUrl: input.photoUrl?.trim() || undefined,
      status: "Active",
      createdAt: new Date().toISOString()
    };
    this.productMasters.push(product);
    this.audit("products.create", "ProductMaster", product.id);
    this.saveData();
    return product;
  }

  suggestPrice(input: {
    customerId?: string;
    productName?: string;
    barcode?: string;
    destination?: string;
    deliveryType?: CargoPackage["deliveryType"];
  }) {
    const productName = input.productName?.trim().toLowerCase();
    const destination = input.destination?.trim().toLowerCase();
    const deliveryType = input.deliveryType;
    const product = input.barcode?.trim()
      ? this.productMasters.find((entry) => entry.barcode === input.barcode?.trim() && entry.status !== "Archived")
      : this.productMasters.find((entry) => productName && entry.name.toLowerCase() === productName && entry.status !== "Archived");
    const namesToMatch = [productName, product?.name.toLowerCase()].filter(Boolean);
    const pricedPackages = this.packages
      .filter((cargo) => cargo.price != null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const sameProduct = (cargo: CargoPackage) => namesToMatch.some((name) => cargo.description.toLowerCase() === name);
    const sameDestination = (cargo: CargoPackage) => !destination || [cargo.handlingBranchName, cargo.destination, cargo.city, cargo.province].some((value) => value?.toLowerCase() === destination);
    const sameDeliveryType = (cargo: CargoPackage) => !deliveryType || cargo.deliveryType === deliveryType;
    const historyUnitPrice = (cargo: CargoPackage) => cargo.unitPrice ?? cargo.price;

    const exact = pricedPackages.find((cargo) => cargo.customerId === input.customerId && sameProduct(cargo) && sameDestination(cargo) && sameDeliveryType(cargo));
    const exactUnitPrice = exact ? historyUnitPrice(exact) : null;
    if (exact && exactUnitPrice != null) {
      return {
        suggestedPrice: exactUnitPrice,
        confidence: "High",
        reason: `Last price for ${exact.customerName} + ${exact.description} + ${exact.handlingBranchName ?? exact.destination}`,
        source: "CustomerProductDestinationHistory",
        warnings: []
      };
    }

    const customerProduct = pricedPackages.find((cargo) => cargo.customerId === input.customerId && sameProduct(cargo));
    const customerProductUnitPrice = customerProduct ? historyUnitPrice(customerProduct) : null;
    if (customerProduct && customerProductUnitPrice != null) {
      return {
        suggestedPrice: customerProductUnitPrice,
        confidence: "Medium",
        reason: `Last price for same customer and product: ${customerProduct.description}`,
        source: "CustomerProductHistory",
        warnings: ["Destination may be different. Confirm before saving."]
      };
    }

    const productDestination = pricedPackages.find((cargo) => sameProduct(cargo) && sameDestination(cargo));
    const productDestinationUnitPrice = productDestination ? historyUnitPrice(productDestination) : null;
    if (productDestination && productDestinationUnitPrice != null) {
      return {
        suggestedPrice: productDestinationUnitPrice,
        confidence: "Medium",
        reason: `Common price for same product and destination from ${productDestination.customerName}`,
        source: "ProductDestinationHistory",
        warnings: ["Different customer. Confirm before saving."]
      };
    }

    if (product?.defaultPrice != null) {
      return {
        suggestedPrice: product.defaultPrice,
        confidence: "Low",
        reason: `Default price from product master: ${product.name}`,
        source: "ProductMasterDefaultPrice",
        warnings: ["Default product price only. Confirm customer and destination."]
      };
    }

    return {
      suggestedPrice: null,
      confidence: "None",
      reason: "No previous price found.",
      source: "None",
      warnings: ["Enter price manually or leave as waiting for price."]
    };
  }

  listMessages(cargoPackageId: string) {
    const cargo = this.findPackage(cargoPackageId);
    return this.messages.filter((message) => message.cargoPackageId === cargo.id);
  }

  createMessage(input: { cargoPackageId: string; senderName: string; body: string }) {
    const cargo = this.findPackage(input.cargoPackageId);
    const message = {
      id: id("msg"),
      cargoPackageId: cargo.id,
      senderName: input.senderName,
      body: input.body,
      createdAt: new Date().toISOString()
    };
    this.messages.push(message);
    this.notify("Shipment message received", `${cargo.packageNumber}: ${input.body}`, "Normal");
    this.audit("messages.create", "CargoPackage", cargo.id);
    this.saveData();
    return message;
  }

  listOperationChats(user?: AuthContext) {
    this.ensureGlobalOperationChat();
    return this.operationChatThreads
      .filter((thread) => this.canSeeOperationChat(thread, user))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  createOperationChatMessage(input: { threadId?: string; body: string }, user?: AuthContext) {
    const body = input.body?.trim();
    if (!body) throw new BadRequestException("Message is required");
    const sender = this.chatUser(user);
    const thread = input.threadId
      ? this.findOperationChat(input.threadId)
      : this.ensureGlobalOperationChat();
    if (!this.canSeeOperationChat(thread, user)) throw new BadRequestException("This chat is not available for your branch");
    thread.messages.push({
      id: id("chat_msg"),
      senderUserId: sender.id,
      senderName: sender.name,
      senderRole: sender.role,
      body,
      createdAt: new Date().toISOString()
    });
    thread.updatedAt = new Date().toISOString();
    this.notify("New chat message", `${sender.name}: ${body}`, "Normal");
    this.audit("chat.message.create", "OperationChat", thread.id);
    this.saveData();
    return thread;
  }

  createPriceApprovalRequest(input: { cargoPackageId: string; proposedPrice: number; note?: string }, user?: AuthContext) {
    const cargo = this.findPackage(input.cargoPackageId);
    const proposedPrice = Number(input.proposedPrice);
    if (!Number.isFinite(proposedPrice) || proposedPrice <= 0) {
      throw new BadRequestException("Valid proposed price is required");
    }
    const sender = this.chatUser(user);
    const now = new Date().toISOString();
    const existing = this.operationChatThreads.find((thread) =>
      thread.actionType === "PriceApproval" &&
      thread.cargoPackageId === cargo.id &&
      thread.status === "Needs Approval"
    );
    const note = input.note?.trim();
    if (existing) {
      existing.proposedPrice = proposedPrice;
      existing.requestedByName = sender.name;
      existing.requestedByRole = sender.role;
      existing.updatedAt = now;
      existing.messages.push({
        id: id("chat_msg"),
        senderUserId: sender.id,
        senderName: sender.name,
        senderRole: sender.role,
        body: `Updated price request to PHP ${proposedPrice.toLocaleString()}${note ? ` - ${note}` : ""}`,
        createdAt: now
      });
      this.notify("Price approval updated", `${cargo.packageNumber}: PHP ${proposedPrice.toLocaleString()}`, "High");
      this.audit("chat.price_request.update", "CargoPackage", cargo.id, note);
      this.saveData();
      return existing;
    }

    const thread: OperationChatThread = {
      id: id("chat"),
      scope: "Pricing",
      title: `Price approval - ${cargo.packageNumber}`,
      branchName: cargo.handlingBranchName ?? cargo.destination,
      cargoPackageId: cargo.id,
      packageNumber: cargo.packageNumber,
      customerName: cargo.customerName,
      description: cargo.description,
      status: "Needs Approval",
      actionType: "PriceApproval",
      proposedPrice,
      requestedByName: sender.name,
      requestedByRole: sender.role,
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: id("chat_msg"),
          senderUserId: sender.id,
          senderName: sender.name,
          senderRole: sender.role,
          body: `Requested PHP ${proposedPrice.toLocaleString()} for ${cargo.packageNumber}${note ? ` - ${note}` : ""}`,
          createdAt: now
        }
      ]
    };
    this.operationChatThreads.push(thread);
    this.notify("Price approval needed", `${cargo.packageNumber}: PHP ${proposedPrice.toLocaleString()} requested`, "High");
    this.audit("chat.price_request.create", "CargoPackage", cargo.id, note);
    this.saveData();
    return thread;
  }

  decidePriceApproval(threadId: string, input: { decision: "Approved" | "Rejected"; approvedPrice?: number; note?: string }, user?: AuthContext) {
    const thread = this.findOperationChat(threadId);
    if (thread.actionType !== "PriceApproval" || !thread.cargoPackageId) {
      throw new BadRequestException("This chat does not contain a price approval");
    }
    const actor = this.chatUser(user);
    const now = new Date().toISOString();
    const note = input.note?.trim();
    if (input.decision === "Rejected") {
      thread.status = "Rejected";
      thread.updatedAt = now;
      thread.messages.push({
        id: id("chat_msg"),
        senderUserId: actor.id,
        senderName: actor.name,
        senderRole: actor.role,
        body: `Rejected price request${note ? ` - ${note}` : ""}`,
        createdAt: now
      });
      this.notify("Price request rejected", `${thread.packageNumber ?? "Package"} price request was rejected`, "Normal");
      this.audit("chat.price_request.reject", "OperationChat", thread.id, note);
      this.saveData();
      return thread;
    }

    const approvedPrice = Number(input.approvedPrice ?? thread.proposedPrice);
    if (!Number.isFinite(approvedPrice) || approvedPrice <= 0) {
      throw new BadRequestException("Valid approved price is required");
    }
    const cargo = this.findPackage(thread.cargoPackageId);
    cargo.price = approvedPrice;
    cargo.unitPrice = approvedPrice;
    cargo.priceChangeReason = note || `Approved in chat by ${actor.name}`;
    if (cargo.status === "Waiting for Price") cargo.status = "Waiting for Loading";
    thread.status = "Approved";
    thread.approvedPrice = approvedPrice;
    thread.updatedAt = now;
    thread.messages.push({
      id: id("chat_msg"),
      senderUserId: actor.id,
      senderName: actor.name,
      senderRole: actor.role,
      body: `Approved price PHP ${approvedPrice.toLocaleString()}${note ? ` - ${note}` : ""}`,
      createdAt: now
    });
    this.notify("Price approved", `${cargo.packageNumber}: PHP ${approvedPrice.toLocaleString()}`, "Normal");
    this.audit("chat.price_request.approve", "CargoPackage", cargo.id, note);
    this.saveData();
    return thread;
  }

  createCustomer(input: { businessName: string; tin?: string; companyPhone?: string; contactPerson?: string; contactRole?: string; contactEmail?: string; contactIsPrimary?: boolean; phone?: string; address?: string; billingAddress?: string; shippingAddress?: string; billingTerm?: string }) {
    const customer: Customer = {
      id: id("cust"),
      businessName: input.businessName,
      status: "Active",
      tin: input.tin?.trim() || undefined,
      companyPhone: input.companyPhone?.trim() || undefined,
      contactPerson: input.contactPerson,
      phone: input.phone,
      address: input.address,
      billingAddress: input.billingAddress,
      shippingAddress: input.shippingAddress,
      contacts: buildPrimaryContact(input),
      billingTerm: input.billingTerm ?? "Custom"
    };
    this.customers.push(customer);
    this.audit("customers.create", "Customer", customer.id);
    this.saveData();
    return customer;
  }

  createPendingCustomer(input: { businessName: string; tin?: string; companyPhone?: string; contactPerson?: string; contactRole?: string; contactEmail?: string; contactIsPrimary?: boolean; phone?: string; address?: string; billingAddress?: string; shippingAddress?: string; reviewBranchName?: string; notes?: string }) {
    if (!input.businessName?.trim()) throw new BadRequestException("Customer name is required");
    const customer: Customer = {
      id: id("cust"),
      businessName: input.businessName.trim(),
      status: "Pending",
      tin: input.tin?.trim() || undefined,
      companyPhone: input.companyPhone?.trim() || undefined,
      contactPerson: input.contactPerson?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      address: input.address?.trim() || undefined,
      billingAddress: input.billingAddress?.trim() || undefined,
      shippingAddress: input.shippingAddress?.trim() || undefined,
      contacts: buildPrimaryContact(input),
      billingTerm: "Pending",
      notes: input.notes?.trim() || undefined
    };
    this.customers.push(customer);
    this.notify(
      input.reviewBranchName?.trim() ? `${input.reviewBranchName.trim()} customer review` : "Customer review needed",
      `${customer.businessName} was created by receiving and is pending branch owner review. Operations may continue.`,
      "Normal"
    );
    this.notify(
      "Complete company details",
      `${customer.businessName} needs full company details when staff or owner is available: TIN, contacts, billing/shipping address, and payment terms.`,
      "Normal"
    );
    this.audit("customer.pending_created", "Customer", customer.id);
    this.saveData();
    return customer;
  }

  updateCustomer(customerId: string, input: { businessName?: string; tin?: string; companyPhone?: string; contactPerson?: string; phone?: string; address?: string; billingAddress?: string; shippingAddress?: string; billingTerm?: string; status?: Customer["status"] }) {
    const customer = this.findCustomer(customerId);
    if (input.businessName !== undefined) customer.businessName = input.businessName.trim() || customer.businessName;
    if (input.tin !== undefined) customer.tin = input.tin.trim() || undefined;
    if (input.companyPhone !== undefined) customer.companyPhone = input.companyPhone.trim() || undefined;
    if (input.contactPerson !== undefined) customer.contactPerson = input.contactPerson.trim() || undefined;
    if (input.phone !== undefined) customer.phone = input.phone.trim() || undefined;
    if (input.address !== undefined) customer.address = input.address.trim() || undefined;
    if (input.billingAddress !== undefined) customer.billingAddress = input.billingAddress.trim() || undefined;
    if (input.shippingAddress !== undefined) customer.shippingAddress = input.shippingAddress.trim() || undefined;
    if (input.billingTerm !== undefined) customer.billingTerm = input.billingTerm.trim() || "Custom";
    if (input.status !== undefined) customer.status = input.status;
    this.audit("customers.update", "Customer", customer.id);
    this.saveData();
    return customer;
  }

  finalizeCustomer(customerId: string, input: { businessName?: string; contactPerson?: string; phone?: string; billingTerm?: string }) {
    const customer = this.findCustomer(customerId);
    customer.businessName = input.businessName?.trim() || customer.businessName;
    customer.contactPerson = input.contactPerson?.trim() || customer.contactPerson;
    customer.phone = input.phone?.trim() || customer.phone;
    customer.billingTerm = input.billingTerm?.trim() || "Custom";
    customer.status = "Active";
    customer.finalizedAt = new Date().toISOString();
    customer.finalizedBy = "owner";
    this.audit("customer.finalized", "Customer", customer.id);
    this.saveData();
    return customer;
  }

  addCustomerContact(customerId: string, input: { name: string; role?: string; phone?: string; email?: string; address?: string; billingAddress?: string; shippingAddress?: string; isPrimary?: boolean; notes?: string }) {
    if (!input.name?.trim()) throw new BadRequestException("Contact name is required");
    const customer = this.findCustomer(customerId);
    const contact: CustomerContact = {
      id: id("ctc"),
      name: input.name.trim(),
      role: input.role?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      email: input.email?.trim() || undefined,
      address: input.address?.trim() || undefined,
      billingAddress: input.billingAddress?.trim() || undefined,
      shippingAddress: input.shippingAddress?.trim() || undefined,
      isPrimary: Boolean(input.isPrimary),
      status: "Active",
      notes: input.notes?.trim() || undefined,
      createdAt: new Date().toISOString()
    };
    customer.contacts = customer.contacts ?? [];
    if (contact.isPrimary || !customer.contacts.some((entry) => entry.isPrimary)) {
      customer.contacts = customer.contacts.map((entry) => ({ ...entry, isPrimary: false }));
      contact.isPrimary = true;
      customer.contactPerson = contact.name;
      customer.phone = contact.phone;
    }
    customer.contacts.push(contact);
    this.audit("customer.contact_added", "Customer", customer.id, contact.name);
    this.saveData();
    return customer;
  }

  createCustomerBillingReminder(customerId: string, input: { balance?: number; dueRule?: string; branchName?: string; smsReady?: boolean }) {
    const customer = this.findCustomer(customerId);
    const balance = Number(input.balance ?? 0);
    const branchName = input.branchName?.trim() || "assigned branch";
    const smsNote = input.smsReady ? " SMS reminder is queued for future SMS API integration." : "";
    this.notify(
      "Customer billing reminder",
      `${branchName}: ${customer.businessName} has PHP ${balance.toLocaleString()} balance. Due rule: ${input.dueRule || customer.billingTerm || "Not set"}.${smsNote}`,
      balance > 0 ? "High" : "Normal"
    );
    this.audit("billing.reminder", "Customer", customer.id, `Balance PHP ${balance.toLocaleString()}`);
    this.saveData();
    return {
      ok: true,
      customerId: customer.id,
      customerName: customer.businessName,
      balance,
      smsStatus: input.smsReady ? "SMS API not integrated yet" : "Internal notification only"
    };
  }

  listReceivingDrafts() {
    return this.receivingDrafts
      .filter((draft) => draft.status === "Draft" || draft.status === "Cancelled")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  validateReceivingIntake(input: { customerName?: string; receiverName?: string; productDescription?: string; deliveryArea?: string }) {
    const customerQuery = input.customerName?.trim().toLowerCase() ?? "";
    const receiverQuery = input.receiverName?.trim().toLowerCase() ?? "";
    const productQuery = input.productDescription?.trim().toLowerCase() ?? "";
    const areaQuery = input.deliveryArea?.trim().toLowerCase() ?? "";
    const customer = customerQuery
      ? this.customers.find((entry) => entry.businessName.toLowerCase() === customerQuery)
      : undefined;
    const receiverMatched = receiverQuery
      ? this.customers.some((entry) => (entry.contacts ?? []).some((contact) => contact.name.toLowerCase() === receiverQuery))
      : false;
    const product = productQuery
      ? this.productMasters.find((entry) => entry.name.toLowerCase() === productQuery || entry.barcode?.toLowerCase() === productQuery)
      : undefined;
    const addressMatched = areaQuery
      ? this.packages.some((pkg) =>
          [pkg.addressLine, pkg.barangay, pkg.city, pkg.province, pkg.deliveryNotes]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(areaQuery))
        )
      : false;
    return {
      customer: customer ? { matched: true, matchId: customer.id, label: "Company found" } : { matched: false, label: customerQuery ? "For staff review" : "Type company name" },
      receiver: receiverMatched ? { matched: true, label: "Receiver matched" } : { matched: false, label: receiverQuery ? "For staff review" : "Type receiver name" },
      product: product ? { matched: true, matchId: product.id, label: "Product found" } : { matched: false, label: productQuery ? "For staff review" : "Type item description" },
      address: addressMatched ? { matched: true, label: "Address matched" } : { matched: false, label: areaQuery ? "For staff review" : "Type delivery area" }
    };
  }

  findPublicCustomerNameSuggestions(query: string | undefined) {
    const value = query?.trim().toLowerCase() ?? "";
    if (value.length < 2) return [];
    return this.customers
      .filter((customer) => customer.status !== "Archived")
      .filter((customer) => customer.businessName.toLowerCase().includes(value))
      .sort((a, b) => {
        const aStarts = a.businessName.toLowerCase().startsWith(value);
        const bStarts = b.businessName.toLowerCase().startsWith(value);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.businessName.localeCompare(b.businessName);
      })
      .slice(0, 8)
      .map((customer) => ({
        name: customer.businessName,
        address: customer.address ?? customer.shippingAddress ?? customer.billingAddress
      }));
  }

  listReceivingIntakeTasks(query: ListQuery = {}) {
    const sorted = [...this.receivingIntakeTasks]
      .filter((task) => statusMatches(task.status, query.status))
      .filter((task) => branchMatches(query.branch, [task.destinationBranch]))
      .filter((task) =>
        queryMatches(
          [
            task.intakeNumber,
            task.customerNameTyped,
            task.customerDrNumber,
            task.dropOffPerson,
            task.consigneeName,
            task.destinationBranch,
            task.deliveryArea,
            task.itemDescription,
            task.status
          ],
          query.search
        )
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return applyCursorAndLimit(sorted, query);
  }

  createReceivingIntakeTask(input: {
    warehouseCode: string;
    customerName: string;
    customerDrNumber?: string;
    dropOffPerson?: string;
    dropOffPhone?: string;
    consigneeName?: string;
    destinationBranch?: string;
    deliveryArea?: string;
    itemDescription?: string;
    quantity?: number;
    unit?: string;
    drPhotoUrl?: string;
    notes?: string;
  }) {
    const customerName = input.customerName?.trim();
    if (!customerName) throw new BadRequestException("Company/customer name is required");
    const warehouseCode = input.warehouseCode?.trim() || "origin";
    const destinationBranch = input.destinationBranch?.trim() || undefined;
    const customerDrNumber = input.customerDrNumber?.trim() || undefined;
    const duplicateKey = [
      warehouseCode.toLowerCase(),
      customerName.toLowerCase(),
      customerDrNumber?.toLowerCase() || "no-dr",
      destinationBranch?.toLowerCase() || "no-branch",
      new Date().toISOString().slice(0, 10)
    ].join("|");
    const now = new Date().toISOString();
    const duplicate = this.receivingIntakeTasks.find((task) => task.duplicateKey === duplicateKey && task.status === "Pending Review");
    if (duplicate) {
      duplicate.duplicateCount += 1;
      duplicate.updatedAt = now;
      if (input.drPhotoUrl) duplicate.extraPhotoUrls.push(input.drPhotoUrl);
      if (input.notes || input.drPhotoUrl) {
        duplicate.duplicateNotes.push({
          id: id("intake_note"),
          note: input.notes?.trim() || undefined,
          photoUrl: input.drPhotoUrl?.trim() || undefined,
          createdAt: now
        });
      }
      this.audit("receiving.intake_duplicate", "ReceivingIntakeTask", duplicate.id, `Duplicate attempt ${duplicate.duplicateCount}`);
      this.saveData();
      return { task: duplicate, duplicate: true, message: "This DR was already submitted. Receiving staff will review it shortly." };
    }
    const customer = this.customers.find((entry) => entry.businessName.toLowerCase() === customerName.toLowerCase());
    const receiverQuery = input.consigneeName?.trim().toLowerCase();
    const productQuery = input.itemDescription?.trim().toLowerCase();
    const receiverMatched = Boolean(receiverQuery && this.customers.some((entry) => (entry.contacts ?? []).some((contact) => contact.name.toLowerCase() === receiverQuery)));
    const product = productQuery
      ? this.productMasters.find((entry) => entry.name.toLowerCase() === productQuery || entry.barcode?.toLowerCase() === productQuery)
      : undefined;
    const task: ReceivingIntakeTask = {
      id: id("intake"),
      intakeNumber: this.nextDocumentNumber("INTAKE", new Date()),
      status: "Pending Review",
      source: "Wall QR",
      warehouseCode,
      duplicateKey,
      duplicateCount: 1,
      customerId: customer?.id,
      customerNameTyped: customerName,
      customerMatched: Boolean(customer),
      customerDrNumber,
      dropOffPerson: input.dropOffPerson?.trim() || undefined,
      dropOffPhone: input.dropOffPhone?.trim() || undefined,
      consigneeName: input.consigneeName?.trim() || undefined,
      receiverMatched,
      destinationBranch,
      deliveryArea: input.deliveryArea?.trim() || undefined,
      productId: product?.id,
      productMatched: Boolean(product),
      itemDescription: input.itemDescription?.trim() || undefined,
      quantity: Number(input.quantity || 1),
      unit: input.unit?.trim() || "pcs",
      drPhotoUrl: input.drPhotoUrl?.trim() || undefined,
      extraPhotoUrls: [],
      notes: input.notes?.trim() || undefined,
      duplicateNotes: [],
      createdAt: now,
      updatedAt: now
    };
    this.receivingIntakeTasks.push(task);
    this.notify("Wall QR intake", `${task.intakeNumber}: ${customerName}`, "Normal");
    this.audit("receiving.intake_created", "ReceivingIntakeTask", task.id);
    this.saveData();
    return { task, duplicate: false, message: "Submitted. Please wait for receiving staff to review." };
  }

  markReceivingIntakeConverted(taskId: string, input: { receivingId: string }) {
    const task = this.receivingIntakeTasks.find((entry) => entry.id === taskId);
    if (!task) throw new NotFoundException("Receiving intake task not found");
    task.status = "Converted";
    task.convertedReceivingId = input.receivingId;
    task.updatedAt = new Date().toISOString();
    this.audit("receiving.intake_converted", "ReceivingIntakeTask", task.id, input.receivingId);
    this.saveData();
    return task;
  }

  cancelReceivingIntake(taskId: string, input: { reason?: string }) {
    const task = this.receivingIntakeTasks.find((entry) => entry.id === taskId);
    if (!task) throw new NotFoundException("Receiving intake task not found");
    task.status = "Cancelled";
    task.updatedAt = new Date().toISOString();
    this.audit("receiving.intake_cancelled", "ReceivingIntakeTask", task.id, input.reason);
    this.saveData();
    return task;
  }

  createReceivingDraft(input: {
    customerId?: string;
    customerDrNumber?: string;
    destination?: string;
    drPhotoUrl?: string;
    formState: Record<string, unknown>;
    productLines: Array<Record<string, unknown>>;
  }) {
    const now = new Date().toISOString();
    const customer = input.customerId ? this.customers.find((entry) => entry.id === input.customerId) : undefined;
    const draft: ReceivingDraft = {
      id: id("draft"),
      draftNumber: this.nextDocumentNumber("DRAFT", new Date()),
      status: "Draft",
      customerId: customer?.id,
      customerNameSnapshot: customer?.businessName,
      customerStatusSnapshot: customer?.status,
      customerDrNumber: input.customerDrNumber,
      destination: input.destination,
      drPhotoUrl: input.drPhotoUrl,
      formState: input.formState,
      productLines: input.productLines,
      createdBy: "Current User",
      updatedBy: "Current User",
      createdAt: now,
      updatedAt: now
    };
    this.receivingDrafts.push(draft);
    this.audit("receiving.draft_created", "ReceivingDraft", draft.id);
    this.saveData();
    return draft;
  }

  updateReceivingDraft(draftId: string, input: Partial<Pick<ReceivingDraft, "customerId" | "customerDrNumber" | "destination" | "drPhotoUrl" | "formState" | "productLines">>) {
    const draft = this.findReceivingDraft(draftId);
    if (draft.status !== "Draft") throw new BadRequestException("Only draft records can be updated");
    const customer = input.customerId ? this.customers.find((entry) => entry.id === input.customerId) : undefined;
    draft.customerId = customer?.id ?? input.customerId ?? draft.customerId;
    draft.customerNameSnapshot = customer?.businessName ?? draft.customerNameSnapshot;
    draft.customerStatusSnapshot = customer?.status ?? draft.customerStatusSnapshot;
    draft.customerDrNumber = input.customerDrNumber ?? draft.customerDrNumber;
    draft.destination = input.destination ?? draft.destination;
    draft.drPhotoUrl = input.drPhotoUrl ?? draft.drPhotoUrl;
    draft.formState = input.formState ?? draft.formState;
    draft.productLines = input.productLines ?? draft.productLines;
    draft.updatedBy = "Current User";
    draft.updatedAt = new Date().toISOString();
    this.audit("receiving.draft_updated", "ReceivingDraft", draft.id);
    this.saveData();
    return draft;
  }

  cancelReceivingDraft(draftId: string) {
    const draft = this.findReceivingDraft(draftId);
    if (draft.status !== "Draft") throw new BadRequestException("Only draft records can be cancelled");
    draft.status = "Cancelled";
    draft.updatedAt = new Date().toISOString();
    this.audit("receiving.draft_cancelled", "ReceivingDraft", draft.id);
    this.saveData();
    return draft;
  }

  finalizeReceivingDraft(draftId: string, input: Parameters<LogisticsService["createReceiving"]>[0]) {
    const draft = this.findReceivingDraft(draftId);
    if (draft.status !== "Draft") throw new BadRequestException("Only draft records can be finalized");
    const receiving = this.createReceiving(input);
    draft.status = "Finalized";
    draft.finalizedReceivingId = receiving.id;
    draft.updatedAt = new Date().toISOString();
    this.audit("receiving.draft_finalized", "ReceivingDraft", draft.id);
    this.saveData();
    return { draft, receiving };
  }

  createReceiving(input: {
    customerId: string;
    customerDrNumber?: string;
    sender?: string;
    consignee?: string;
    destination: string;
    drPhotoUrl?: string;
    packages: Array<{
      productId?: string;
      sku?: string;
      productBarcode?: string;
      description: string;
      quantity?: number;
      unit?: string;
      brand?: string;
      category?: string;
      destination?: string;
      handlingBranchId?: string;
      handlingBranchName?: string;
      deliveryType?: CargoPackage["deliveryType"];
      consigneeName?: string;
      deliveryBusinessName?: string;
      addressLine?: string;
      barangay?: string;
      city?: string;
      province?: string;
      landmark?: string;
      deliveryPhone?: string;
      deliveryNotes?: string;
      condition?: PackageCondition;
      conditionNotes?: string;
      unitPrice?: number | null;
      price?: number | null;
      weight?: number | null;
      weightUnit?: string;
      length?: number | null;
      width?: number | null;
      height?: number | null;
      dimensionUnit?: string;
      photoUrls?: string[];
    }>;
  }) {
    const customer = this.customers.find((entry) => entry.id === input.customerId);
    if (!customer) throw new NotFoundException("Customer not found");
    if (!input.packages.length) throw new BadRequestException("At least one package is required");

    const now = new Date();
    const recordNumber = this.nextDocumentNumber(documentPrefixes.receivingRecord, now);
    const receiving: ReceivingRecord = {
      id: id("rr"),
      recordNumber,
      customerId: customer.id,
      customerName: customer.businessName,
      customerDrNumber: input.customerDrNumber,
      sender: input.sender,
      consignee: input.consignee,
      destination: input.destination,
      drPhotoUrl: input.drPhotoUrl?.trim() || undefined,
      packages: [],
      createdAt: now.toISOString()
    };

    receiving.packages = input.packages.map((pkg) => {
      if (pkg.condition && pkg.condition !== "Good" && !pkg.conditionNotes) {
        throw new BadRequestException("Condition notes are required when package condition is not Good");
      }
      if (pkg.condition && pkg.condition !== "Good" && !pkg.photoUrls?.length) {
        throw new BadRequestException("Product photo is required when package condition is not Good");
      }
      const packageNumber = this.nextDocumentNumber("PKG", now);
      const quantity = Number(pkg.quantity ?? 1);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException("Quantity must be greater than zero");
      }
      const deliveryType = pkg.deliveryType ?? "Deliver to consignee";
      if (deliveryType === "Deliver to consignee" && ![pkg.addressLine, pkg.barangay, pkg.city, pkg.province].some((value) => value?.trim())) {
        throw new BadRequestException("Delivery address is required when delivery type is Deliver to consignee");
      }
      const handlingBranchName = pkg.handlingBranchName?.trim() || pkg.destination || input.destination;
      const handlingBranchId = pkg.handlingBranchId?.trim() || handlingBranchName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const existingProduct = pkg.productId
        ? this.productMasters.find((product) => product.id === pkg.productId && product.status !== "Archived")
        : undefined;
      const product = existingProduct ?? this.ensureProductMasterForCargo({
        description: pkg.description,
        sku: pkg.sku,
        barcode: pkg.productBarcode,
        brand: pkg.brand,
        category: pkg.category,
        unit: pkg.unit,
        price: pkg.price,
        photoUrl: pkg.photoUrls?.[0]
      });
      const cargo: CargoPackage = {
        id: id("pkg"),
        packageNumber,
        receivingRecordNumber: recordNumber,
        customerId: customer.id,
        customerName: customer.businessName,
        productId: product.id,
        productBarcode: product.barcode,
        description: product.name,
        quantity,
        unit: pkg.unit?.trim() || "pcs",
        destination: handlingBranchName,
        handlingBranchId,
        handlingBranchName,
        deliveryType,
        consigneeName: pkg.consigneeName?.trim() || undefined,
        deliveryBusinessName: pkg.deliveryBusinessName?.trim() || undefined,
        addressLine: pkg.addressLine?.trim() || undefined,
        barangay: pkg.barangay?.trim() || undefined,
        city: pkg.city?.trim() || undefined,
        province: pkg.province?.trim() || undefined,
        landmark: pkg.landmark?.trim() || undefined,
        deliveryPhone: pkg.deliveryPhone?.trim() || undefined,
        deliveryNotes: pkg.deliveryNotes?.trim() || undefined,
        condition: pkg.condition ?? "Good",
        conditionNotes: pkg.conditionNotes,
        status: pkg.price == null ? "Waiting for Price" : "Waiting for Loading",
        unitPrice: pkg.unitPrice ?? null,
        price: pkg.price ?? null,
        weight: pkg.weight ?? null,
        weightUnit: pkg.weightUnit?.trim() || undefined,
        length: pkg.length ?? null,
        width: pkg.width ?? null,
        height: pkg.height ?? null,
        dimensionUnit: pkg.dimensionUnit?.trim() || undefined,
        qrValue: buildPackageQrValue(packageNumber),
        photoUrls: pkg.photoUrls ?? [],
        createdAt: now.toISOString()
      };
      if (cargo.condition !== "Good") {
        this.notify("Package condition requires review", `${cargo.packageNumber} is marked ${cargo.condition}.`, "High");
      }
      this.packages.push(cargo);
      return cargo;
    });

    this.receivingRecords.push(receiving);
    const branchCounts = new Map<string, { count: number; withoutPrice: number }>();
    for (const cargo of receiving.packages) {
      const branchName = cargo.handlingBranchName || cargo.destination;
      const current = branchCounts.get(branchName) ?? { count: 0, withoutPrice: 0 };
      current.count += 1;
      if (cargo.price == null) current.withoutPrice += 1;
      branchCounts.set(branchName, current);
    }
    for (const [branchName, summary] of branchCounts) {
      this.notify(
        `${branchName} receiving created`,
        `${receiving.recordNumber} for ${customer.businessName}: ${summary.count} item${summary.count === 1 ? "" : "s"} received${summary.withoutPrice ? `, ${summary.withoutPrice} without price` : ""}.`,
        summary.withoutPrice ? "High" : "Normal"
      );
    }
    this.audit("receiving.create", "ReceivingRecord", receiving.id);
    this.saveData();
    return receiving;
  }

  attachReceivingDrPhoto(receivingRecordId: string, input: { drPhotoUrl: string; reason?: string }) {
    if (!input.drPhotoUrl?.trim()) throw new BadRequestException("DR photo URL is required");
    const receiving = this.findReceivingRecord(receivingRecordId);
    receiving.drPhotoUrl = input.drPhotoUrl.trim();
    receiving.drPhotoAttachedAt = new Date().toISOString();
    receiving.drPhotoAttachReason = input.reason?.trim() || "Late DR attachment";
    this.audit("receiving.dr_photo_attached", "ReceivingRecord", receiving.id, receiving.drPhotoAttachReason);
    this.saveData();
    return receiving;
  }

  updateReceivingRecord(receivingRecordId: string, input: {
    customerDrNumber?: string;
    sender?: string;
    consignee?: string;
    destination?: string;
    reason?: string;
    packages?: Array<{
      id: string;
      description?: string;
      quantity?: number;
      unit?: string;
      destination?: string;
      handlingBranchName?: string;
      unitPrice?: number | null;
      price?: number | null;
      weight?: number | null;
      weightUnit?: string;
      length?: number | null;
      width?: number | null;
      height?: number | null;
      dimensionUnit?: string;
      condition?: PackageCondition;
      conditionNotes?: string;
    }>;
  }) {
    const receiving = this.findReceivingRecord(receivingRecordId);
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("Edit reason is required");
    const changes: string[] = [];
    const updateField = <K extends keyof ReceivingRecord>(field: K, value: ReceivingRecord[K] | undefined) => {
      if (value === undefined) return;
      const normalized = typeof value === "string" ? value.trim() : value;
      if (receiving[field] !== normalized) {
        changes.push(`${String(field)}: ${String(receiving[field] ?? "")} -> ${String(normalized ?? "")}`);
        receiving[field] = normalized as ReceivingRecord[K];
      }
    };

    updateField("customerDrNumber", input.customerDrNumber);
    updateField("sender", input.sender);
    updateField("consignee", input.consignee);
    updateField("destination", input.destination);

    for (const pkgInput of input.packages ?? []) {
      const recordPkg = receiving.packages.find((pkg) => pkg.id === pkgInput.id || pkg.packageNumber === pkgInput.id);
      const cargo = this.packages.find((pkg) => pkg.id === pkgInput.id || pkg.packageNumber === pkgInput.id);
      if (!recordPkg || !cargo) continue;
      const targets = [recordPkg, cargo];
      const changePackageField = <K extends keyof CargoPackage>(field: K, value: CargoPackage[K] | undefined) => {
        if (value === undefined) return;
        const normalized = typeof value === "string" ? value.trim() : value;
        if (cargo[field] !== normalized) {
          changes.push(`${cargo.packageNumber}.${String(field)}: ${String(cargo[field] ?? "")} -> ${String(normalized ?? "")}`);
          for (const target of targets) target[field] = normalized as CargoPackage[K];
        }
      };
      if (pkgInput.description !== undefined && pkgInput.description.trim()) {
        const product = this.ensureProductMasterForCargo({
          description: pkgInput.description,
          unit: pkgInput.unit ?? cargo.unit,
          price: pkgInput.price ?? cargo.price,
          photoUrl: cargo.photoUrls[0],
          notes: `Created/updated from edited cargo ${cargo.packageNumber}.`
        });
        if (cargo.productId !== product.id) {
          changes.push(`${cargo.packageNumber}.product: ${cargo.productId} -> ${product.id}`);
          for (const target of targets) {
            target.productId = product.id;
            target.productBarcode = product.barcode;
          }
        }
        changePackageField("description", product.name);
      }
      changePackageField("unitPrice", pkgInput.unitPrice);
      changePackageField("quantity", pkgInput.quantity);
      changePackageField("unit", pkgInput.unit);
      const destination = pkgInput.handlingBranchName ?? pkgInput.destination;
      changePackageField("destination", destination);
      changePackageField("handlingBranchName", destination);
      if (destination) {
        changePackageField("handlingBranchId", destination.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
      }
      changePackageField("price", pkgInput.price);
      changePackageField("weight", pkgInput.weight);
      changePackageField("weightUnit", pkgInput.weightUnit);
      changePackageField("length", pkgInput.length);
      changePackageField("width", pkgInput.width);
      changePackageField("height", pkgInput.height);
      changePackageField("dimensionUnit", pkgInput.dimensionUnit);
      changePackageField("condition", pkgInput.condition);
      changePackageField("conditionNotes", pkgInput.conditionNotes);
    }

    if (!changes.length) {
      this.audit("receiving.edit_no_change", "ReceivingRecord", receiving.id, reason);
      return this.syncReceivingRecordPackages(receiving);
    }
    this.audit("receiving.edit", "ReceivingRecord", receiving.id, `${reason} | ${changes.join("; ")}`);
    this.saveData();
    return this.syncReceivingRecordPackages(receiving);
  }

  listReceivingRecordAudit(receivingRecordId: string) {
    const receiving = this.findReceivingRecord(receivingRecordId);
    const packageIds = new Set(receiving.packages.flatMap((pkg) => [pkg.id, pkg.packageNumber]));
    return this.auditLogs
      .filter((log) =>
        (log.entityType === "ReceivingRecord" && (log.entityId === receiving.id || log.entityId === receiving.recordNumber)) ||
        (log.entityType === "CargoPackage" && packageIds.has(log.entityId))
      )
      .reverse();
  }

  updatePackagePrice(packageId: string, input: { price: number; reason?: string }) {
    const cargo = this.findPackage(packageId);
    if (cargo.price != null && cargo.price !== input.price && !input.reason) {
      throw new BadRequestException("Reason is required when price differs from the previous price");
    }
    cargo.price = input.price;
    cargo.priceChangeReason = input.reason;
    if (cargo.status === "Waiting for Price") cargo.status = "Waiting for Loading";
    this.audit("pricing.update", "CargoPackage", cargo.id, input.reason);
    this.saveData();
    return cargo;
  }

  updatePackageMeasurements(packageId: string, input: {
    weight?: number | null;
    weightUnit?: string;
    length?: number | null;
    width?: number | null;
    height?: number | null;
    dimensionUnit?: string;
    reason?: string;
  }) {
    const cargo = this.findPackage(packageId);
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("Measurement update reason is required");
    const changes: string[] = [];
    const updateField = <K extends keyof CargoPackage>(field: K, value: CargoPackage[K] | undefined) => {
      if (value === undefined) return;
      const normalized = typeof value === "string" ? value.trim() : value;
      if (cargo[field] !== normalized) {
        changes.push(`${String(field)}: ${String(cargo[field] ?? "")} -> ${String(normalized ?? "")}`);
        cargo[field] = normalized as CargoPackage[K];
      }
    };
    updateField("weight", input.weight as CargoPackage["weight"]);
    updateField("weightUnit", input.weightUnit as CargoPackage["weightUnit"]);
    updateField("length", input.length as CargoPackage["length"]);
    updateField("width", input.width as CargoPackage["width"]);
    updateField("height", input.height as CargoPackage["height"]);
    updateField("dimensionUnit", input.dimensionUnit as CargoPackage["dimensionUnit"]);
    const receiving = this.receivingRecords.find((record) => record.recordNumber === cargo.receivingRecordNumber || record.id === cargo.receivingRecordNumber);
    const recordPackage = receiving?.packages.find((pkg) => pkg.id === cargo.id || pkg.packageNumber === cargo.packageNumber);
    if (recordPackage) {
      Object.assign(recordPackage, {
        weight: cargo.weight,
        weightUnit: cargo.weightUnit,
        length: cargo.length,
        width: cargo.width,
        height: cargo.height,
        dimensionUnit: cargo.dimensionUnit
      });
    }
    this.audit(changes.length ? "cargo.measurements.update" : "cargo.measurements.no_change", "CargoPackage", cargo.id, `${reason}${changes.length ? ` | ${changes.join("; ")}` : ""}`);
    this.saveData();
    return cargo;
  }

  softDeletePackage(packageId: string, input: { reason: string }) {
    if (!input.reason?.trim()) {
      throw new BadRequestException("Deletion reason is required");
    }
    const cargo = this.findPackage(packageId);
    if (cargo.status === "Delivered") {
      throw new BadRequestException("Delivered packages cannot be deleted. Archive the record after review instead.");
    }
    cargo.status = "Cancelled";
    this.audit("records.softDelete", "CargoPackage", cargo.id, input.reason);
    this.notify("Package soft deleted", `${cargo.packageNumber}: ${input.reason}`, "High");
    this.saveData();
    return cargo;
  }

  restorePackage(packageId: string, input: { reason: string }) {
    if (!input.reason?.trim()) {
      throw new BadRequestException("Restore reason is required");
    }
    const cargo = this.findPackage(packageId);
    if (cargo.status !== "Cancelled") {
      throw new BadRequestException("Only cancelled or soft-deleted packages can be restored");
    }
    cargo.status = cargo.price == null ? "Waiting for Price" : "Waiting for Loading";
    this.audit("records.restore", "CargoPackage", cargo.id, input.reason);
    this.notify("Package restored", `${cargo.packageNumber}: ${input.reason}`, "Normal");
    this.saveData();
    return cargo;
  }

  createTrip(input: {
    origin: string;
    destination: string;
    truckId?: string;
    plateNumber?: string;
    vehicleDescription?: string;
    driverName?: string;
    driverContactNumber?: string;
    truckOwnerName?: string;
    saveTruckDetails?: boolean;
    cargoPackageIds?: string[];
  }) {
    const now = new Date();
    const selectedTruck = input.truckId ? this.trucks.find((truck) => truck.id === input.truckId) : undefined;
    const plateNumber = input.plateNumber?.trim().toUpperCase() || selectedTruck?.plateNumber;
    const driverName = input.driverName?.trim() || selectedTruck?.driverName;
    const driverContactNumber = input.driverContactNumber?.trim() || selectedTruck?.contactNumber;
    const truckOwnerName = input.truckOwnerName?.trim() || selectedTruck?.ownerName;
    if (plateNumber) {
      const today = this.businessDateKey(now);
      const duplicateActiveTrip = this.trips.find((trip) =>
        !["Completed", "Cancelled"].includes(trip.status) &&
        (trip.plateNumber ?? trip.vehicleDescription ?? "").toUpperCase() === plateNumber &&
        this.businessDateKey(trip.createdAt) === today
      );
      if (duplicateActiveTrip) {
        throw new BadRequestException(`${plateNumber} already has active trip ${duplicateActiveTrip.tripNumber} today. Open that trip to load cargo, or complete/cancel it before saving another trip.`);
      }
    }
    const savedTruck = input.saveTruckDetails && plateNumber
      ? this.saveTruck({ plateNumber, driverName, contactNumber: driverContactNumber, ownerName: truckOwnerName })
      : selectedTruck;
    const trip: Trip = {
      id: id("trip"),
      tripNumber: this.nextDocumentNumber(documentPrefixes.trip, now),
      origin: input.origin,
      destination: input.destination,
      status: "Planned",
      isMixedTrip: false,
      mixedTripApprovalStatus: "Not Required",
      truckId: savedTruck?.id ?? input.truckId,
      plateNumber,
      vehicleDescription: input.vehicleDescription?.trim() || plateNumber || "Truck not set",
      driverName,
      driverContactNumber,
      truckOwnerName,
      cargoPackageIds: [],
      createdAt: now.toISOString()
    };
    this.trips.push(trip);
    for (const cargoPackageId of input.cargoPackageIds ?? []) {
      this.loadCargo(trip.id, { cargoPackageId });
    }
    this.audit("trips.create", "Trip", trip.id);
    this.saveData();
    return trip;
  }

  loadCargo(tripId: string, input: { cargoPackageId: string; overrideReason?: string }) {
    const trip = this.findTrip(tripId);
    const cargo = this.findPackage(input.cargoPackageId);
    const customer = this.findCustomer(cargo.customerId);
    if (customer.status === "Pending") {
      this.notify("Pending customer loaded", `${cargo.packageNumber} loaded for ${customer.businessName}. Customer is still pending branch owner review.`, "Normal");
      this.audit("loading.pending_customer_notice", "CargoPackage", cargo.id);
    }
    if (cargo.price == null) {
      this.notify("Loading blocked", `${cargo.packageNumber} has no price. Owner approval/pricing is required before loading.`, "High");
      this.audit("loading.blocked_missing_price", "CargoPackage", cargo.id);
      throw new BadRequestException("This package has no price yet. Owner approval/pricing is required before loading.");
    }
    if (cargo.status === "Delivered") throw new BadRequestException("Delivered cargo cannot be loaded.");
    if (cargo.condition !== "Good" && !input.overrideReason) {
      throw new BadRequestException("Package condition requires review before loading.");
    }
    if (cargo.handlingBranchName !== trip.destination) {
      trip.isMixedTrip = true;
      trip.mixedTripApprovalStatus = "Notified";
      trip.mixedTripApprovalNotes = input.overrideReason?.trim() || `${cargo.packageNumber} is for ${cargo.handlingBranchName} but trip is for ${trip.destination}.`;
      this.notify("Mixed trip owner notice", `${cargo.packageNumber} is for ${cargo.handlingBranchName} but trip is for ${trip.destination}. Branch owners must review.`, "High");
      this.audit("mixed_trip.owner_notified", "Trip", trip.id, trip.mixedTripApprovalNotes);
    }
    if (!trip.cargoPackageIds.includes(cargo.id)) trip.cargoPackageIds.push(cargo.id);
    trip.status = "Loading";
    cargo.status = "Loaded";
    this.audit("loading.scan", "CargoPackage", cargo.id, input.overrideReason);
    this.saveData();
    return { trip, cargo };
  }

  unloadCargo(tripId: string, input: { cargoPackageId: string; reason?: string }) {
    const trip = this.findTrip(tripId);
    if (!["Planned", "Loading"].includes(trip.status)) {
      throw new BadRequestException("Cargo can only be removed before the trip departs.");
    }
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("Removal reason is required.");
    const cargo = this.findPackage(input.cargoPackageId);
    if (!trip.cargoPackageIds.includes(cargo.id)) {
      throw new BadRequestException("This package is not loaded on this trip.");
    }
    trip.cargoPackageIds = trip.cargoPackageIds.filter((packageId) => packageId !== cargo.id);
    cargo.status = cargo.price == null ? "Waiting for Price" : "Waiting for Loading";
    trip.isMixedTrip = trip.cargoPackageIds.some((packageId) => {
      const loadedCargo = this.findPackage(packageId);
      return loadedCargo.handlingBranchName !== trip.destination;
    });
    if (!trip.cargoPackageIds.length) trip.status = "Planned";
    this.audit("loading.remove", "CargoPackage", cargo.id, reason);
    this.notify("Cargo removed from trip", `${cargo.packageNumber} removed from ${trip.tripNumber}: ${reason}`, "Normal");
    this.saveData();
    return { trip, cargo };
  }

  attachTripLoadingPhoto(tripId: string, input: { photoUrl: string }) {
    const trip = this.findTrip(tripId);
    if (!input.photoUrl) throw new BadRequestException("Loading photo is required.");
    if (!["Planned", "Loading"].includes(trip.status)) {
      throw new BadRequestException("Loading photo can only be attached before departure.");
    }
    trip.loadingPhotoUrl = input.photoUrl;
    trip.loadingPhotoAttachedAt = new Date().toISOString();
    this.audit("trips.loading_photo.attach", "Trip", trip.id);
    this.notify("Loading photo attached", `${trip.tripNumber} loading photo was attached.`, "Normal");
    this.saveData();
    return trip;
  }

  reviewMixedTrip(tripId: string, input: { approved: boolean; notes?: string }) {
    const trip = this.findTrip(tripId);
    if (!trip.isMixedTrip) throw new BadRequestException("This trip is not marked as mixed.");
    trip.mixedTripApprovalStatus = input.approved ? "Approved" : "Rejected";
    trip.mixedTripApprovalNotes = input.notes?.trim() || trip.mixedTripApprovalNotes;
    this.audit(input.approved ? "mixed_trip.approved" : "mixed_trip.rejected", "Trip", trip.id, trip.mixedTripApprovalNotes);
    this.notify(input.approved ? "Mixed trip approved" : "Mixed trip rejected", `${trip.tripNumber}: ${trip.mixedTripApprovalNotes ?? "No note"}`, input.approved ? "Normal" : "High");
    this.saveData();
    return trip;
  }

  departTrip(tripId: string) {
    const trip = this.findTrip(tripId);
    trip.status = "Departed";
    for (const packageId of trip.cargoPackageIds) this.findPackage(packageId).status = "In Transit";
    this.audit("trips.depart", "Trip", trip.id);
    this.saveData();
    return trip;
  }

  arriveTrip(tripId: string) {
    const trip = this.findTrip(tripId);
    trip.status = "Arrived";
    for (const packageId of trip.cargoPackageIds) this.findPackage(packageId).status = "Arrived";
    this.audit("arrival.mark", "Trip", trip.id);
    this.saveData();
    return trip;
  }

  completeTrip(tripId: string) {
    const trip = this.findTrip(tripId);
    if (trip.status !== "Arrived") {
      throw new BadRequestException("Only arrived trips can be completed.");
    }
    if (!trip.cargoPackageIds.length) {
      throw new BadRequestException("Trip has no cargo to complete.");
    }
    const cargo = trip.cargoPackageIds.map((packageId) => this.findPackage(packageId));
    const openCargo = cargo.filter((pkg) => !["Delivered", "Failed Delivery", "Exception", "Cancelled"].includes(pkg.status));
    if (openCargo.length) {
      throw new BadRequestException(`${openCargo.length} cargo item(s) still need delivery, failed delivery, return, or exception status before completing this trip.`);
    }
    trip.status = "Completed";
    this.audit("trips.complete", "Trip", trip.id, `${cargo.length} cargo item(s) closed`);
    this.notify("Trip completed", `${trip.tripNumber} has been completed.`, "Normal");
    this.saveData();
    return trip;
  }

  verifyArrivedCargo(packageId: string, input: { condition?: string; notes?: string; photoUrl?: string; issueStatus?: "Ready for Delivery" | "Damaged" | "Missing" | "For Checking" }) {
    const cargo = this.findPackage(packageId);
    const nextStatus = input.issueStatus ?? "Ready for Delivery";
    if (!["Arrived", "Ready for Delivery", "Exception"].includes(cargo.status)) {
      throw new BadRequestException("Only arrived cargo can be verified at the branch");
    }
    cargo.status = nextStatus === "Ready for Delivery" ? "Ready for Delivery" : "Exception";
    if (input.condition?.trim()) {
      const allowedConditions: PackageCondition[] = ["Good", "Damaged", "Wet", "Incomplete", "For Checking", "Other"];
      cargo.condition = (allowedConditions.includes(input.condition.trim() as PackageCondition) ? input.condition.trim() : "Other") as typeof cargo.condition;
    }
    if (nextStatus !== "Ready for Delivery") {
      this.notify("Cargo verification issue", `${cargo.packageNumber}: ${nextStatus}${input.notes ? ` - ${input.notes}` : ""}`, "High");
    }
    this.audit("delivery.verify_arrival", "CargoPackage", cargo.id, [nextStatus, input.notes, input.photoUrl ? "photo attached" : ""].filter(Boolean).join(" | "));
    this.saveData();
    return cargo;
  }

  createReturnRecord(input: {
    cargoPackageId: string;
    reason: string;
    nextAction: ReturnRecord["nextAction"];
    notes?: string;
    photoUrl?: string;
  }) {
    const cargo = this.findPackage(input.cargoPackageId);
    if (!input.reason?.trim()) throw new BadRequestException("Return reason is required.");
    const record: ReturnRecord = {
      id: id("ret"),
      cargoPackageId: cargo.id,
      reason: input.reason.trim(),
      nextAction: input.nextAction,
      notes: input.notes?.trim() || undefined,
      photoUrl: input.photoUrl,
      status: "Requested",
      createdAt: new Date().toISOString()
    };
    cargo.status = "Exception";
    cargo.deliveryType = "Return cargo";
    this.returnRecords.push(record);
    this.notify("Return requested", `${cargo.packageNumber}: ${record.reason} / ${record.nextAction}`, "High");
    this.audit("returns.create", "ReturnRecord", record.id, `${cargo.packageNumber} | ${record.reason} | ${record.nextAction}`);
    this.saveData();
    return record;
  }

  completeDelivery(input: {
    cargoPackageId: string;
    deliveredTo: string;
    signatureUrl?: string;
    deliveryPhotoUrl?: string;
    notes?: string;
    customerAcceptedDamage?: boolean;
  }) {
    const cargo = this.findPackage(input.cargoPackageId);
    if (!input.deliveredTo) throw new BadRequestException("Recipient name is required");
    if (cargo.condition !== "Good" && !input.customerAcceptedDamage) {
      throw new BadRequestException("Customer acceptance is required for damaged or exception cargo");
    }
    const delivery: DeliveryRecord = {
      id: id("del"),
      cargoPackageId: cargo.id,
      status: "Delivered",
      deliveredTo: input.deliveredTo,
      signatureUrl: input.signatureUrl,
      deliveryPhotoUrl: input.deliveryPhotoUrl,
      notes: input.notes,
      createdAt: new Date().toISOString()
    };
    cargo.status = "Delivered";
    this.deliveries.push(delivery);
    this.audit("delivery.complete", "DeliveryRecord", delivery.id);
    this.saveData();
    return delivery;
  }

  failDelivery(input: { cargoPackageId: string; failedReason: string; notes?: string; nextAction: string }) {
    const cargo = this.findPackage(input.cargoPackageId);
    const delivery: DeliveryRecord = {
      id: id("del"),
      cargoPackageId: cargo.id,
      status: "Failed Delivery",
      failedReason: input.failedReason,
      notes: input.notes,
      nextAction: input.nextAction,
      createdAt: new Date().toISOString()
    };
    cargo.status = "Failed Delivery";
    this.deliveries.push(delivery);
    this.notify("Failed delivery", `${cargo.packageNumber}: ${input.failedReason}`, "High");
    this.audit("delivery.fail", "DeliveryRecord", delivery.id, input.failedReason);
    this.saveData();
    return delivery;
  }

  recordPayment(input: {
    cargoPackageId: string;
    amountDue?: number;
    amountPaid: number;
    method: string;
    collectionPoint?: PaymentRecord["collectionPoint"];
    collectedByUserId?: string;
    collectedByName?: string;
    collectedByRole?: string;
    branchId?: string;
    branchName?: string;
    proofUrl?: string;
    notes?: string;
  }) {
    const cargo = this.findPackage(input.cargoPackageId);
    const amountDue = input.amountDue ?? cargo.price ?? 0;
    const balance = Math.max(amountDue - input.amountPaid, 0);
    const status: PaymentStatus = balance === 0 ? "Paid" : input.amountPaid > 0 ? "Partially Paid" : "Unpaid";
    const payment: PaymentRecord = {
      id: id("pay"),
      cargoPackageId: cargo.id,
      amountDue,
      amountPaid: input.amountPaid,
      balance,
      method: input.method,
      collectionPoint: input.collectionPoint ?? "Other",
      collectedByUserId: input.collectedByUserId,
      collectedByName: input.collectedByName,
      collectedByRole: input.collectedByRole,
      branchId: input.branchId ?? cargo.handlingBranchId,
      branchName: input.branchName ?? cargo.handlingBranchName,
      proofUrl: input.proofUrl,
      notes: input.notes,
      status,
      createdAt: new Date().toISOString()
    };
    this.payments.push(payment);
    this.audit("payments.record", "Payment", payment.id);
    this.saveData();
    return payment;
  }

  createExpense(input: { tripId?: string; category: string; amount: number; description?: string; receiptUrl?: string }) {
    const expense: ExpenseRecord = {
      id: id("exp"),
      tripId: input.tripId,
      category: input.category,
      amount: input.amount,
      description: input.description,
      receiptUrl: input.receiptUrl,
      status: "Submitted",
      createdAt: new Date().toISOString()
    };
    this.expenses.push(expense);
    this.notify("Expense submitted", `${input.category}: PHP ${input.amount.toLocaleString()}`, "Normal");
    this.audit("expenses.create", "Expense", expense.id);
    this.saveData();
    return expense;
  }

  createBillingInvoice(input: { customerId: string; packageIds?: string[]; dueRule?: string }) {
    const customer = this.findCustomer(input.customerId);
    const packageIds = input.packageIds?.length
      ? input.packageIds
      : this.packages.filter((pkg) => pkg.customerId === customer.id || pkg.customerName === customer.businessName).map((pkg) => pkg.id);
    const invoicePackages = packageIds.map((packageId) => this.findPackage(packageId));
    const amountDue = invoicePackages.reduce((sum, pkg) => sum + Number(pkg.price ?? 0), 0);
    const packageIdSet = new Set(invoicePackages.map((pkg) => pkg.id));
    const amountPaid = this.payments
      .filter((payment) => packageIdSet.has(payment.cargoPackageId))
      .reduce((sum, payment) => sum + payment.amountPaid, 0);
    const balance = Math.max(amountDue - amountPaid, 0);
    const now = new Date();
    const invoice: BillingInvoice = {
      id: id("bill"),
      invoiceNumber: this.nextDocumentNumber("BILL", now),
      customerId: customer.id,
      customerName: customer.businessName,
      packageIds: invoicePackages.map((pkg) => pkg.id),
      amountDue,
      amountPaid,
      balance,
      dueRule: input.dueRule?.trim() || customer.billingTerm || "Not set",
      status: balance <= 0 ? "Paid" : "Issued",
      createdAt: now.toISOString()
    };
    this.billingInvoices.push(invoice);
    this.audit("billing.invoice.create", "BillingInvoice", invoice.id, invoice.invoiceNumber);
    this.saveData();
    return invoice;
  }

  approveExpense(expenseId: string) {
    const expense = this.expenses.find((entry) => entry.id === expenseId);
    if (!expense) throw new NotFoundException("Expense not found");
    expense.status = "Approved";
    this.audit("expenses.approve", "Expense", expense.id);
    this.saveData();
    return expense;
  }

  renderReceivingSlip(packageId: string) {
    const cargo = this.findPackage(packageId);
    const printLog = this.logPrint({
      documentType: "Receiving Slip",
      documentNumber: cargo.packageNumber,
      relatedEntityType: "CargoPackage",
      relatedEntityId: cargo.id,
      layout: "80mm"
    });
    const measurement = [
      cargo.weight != null ? `${cargo.weight} ${cargo.weightUnit ?? "kg"}` : "",
      [cargo.length, cargo.width, cargo.height].some((value) => value != null) ? `${cargo.length ?? "?"} x ${cargo.width ?? "?"} x ${cargo.height ?? "?"} ${cargo.dimensionUnit ?? "cm"}` : ""
    ].filter(Boolean).join(" / ");
    return render80mmReceipt({
      title: "RECEIVING SLIP",
      documentNumber: cargo.receivingRecordNumber,
      lines: [
        { label: "Package", value: cargo.packageNumber },
        { label: "Customer", value: cargo.customerName },
        { label: "Description", value: cargo.description },
        { label: "Qty", value: `${cargo.quantity ?? 1} ${cargo.unit ?? "pcs"}` },
        { label: "Handling Branch", value: cargo.handlingBranchName ?? cargo.destination },
        { label: "Delivery Type", value: cargo.deliveryType ?? "Deliver to consignee" },
        { label: "Delivery Area", value: [cargo.city, cargo.province].filter(Boolean).join(", ") || "Not provided" },
        { label: "Condition", value: cargo.condition },
        ...(measurement ? [{ label: "Weight/Size", value: measurement }] : []),
        ...(cargo.unitPrice != null ? [{ label: "Unit Price", value: `PHP ${cargo.unitPrice.toFixed(2)}` }] : []),
        { label: "Price", value: cargo.price == null ? "Waiting for Price" : `PHP ${cargo.price.toFixed(2)}` },
        { label: "Print", value: `${printLog.action} ${printLog.createdAt}` },
        { label: "Copy", value: String(printLog.copyNumber) }
      ],
      qrValue: cargo.qrValue,
      footer: "Signature: __________________"
    });
  }

  renderReceivingDocument(receivingRecordId: string) {
    const receiving = this.findReceivingRecord(receivingRecordId);
    const printLog = this.logPrint({
      documentType: "Receiving Document",
      documentNumber: receiving.recordNumber,
      relatedEntityType: "ReceivingRecord",
      relatedEntityId: receiving.id,
      layout: "80mm"
    });
    const totalQuantity = receiving.packages.reduce((sum, cargo) => sum + (cargo.quantity ?? 1), 0);
    const totalPrice = receiving.packages.reduce((sum, cargo) => sum + (cargo.price ?? 0), 0);
    const withoutPrice = receiving.packages.filter((cargo) => cargo.price == null).length;
    const branchSummary = Array.from(new Set(receiving.packages.map((cargo) => cargo.handlingBranchName ?? cargo.destination))).join(" / ");
    const itemLines = receiving.packages.map((cargo, index) => {
      const quantity = `${cargo.quantity ?? 1} ${cargo.unit ?? "pcs"}`;
      const branch = cargo.handlingBranchName ?? cargo.destination;
      const price = cargo.price == null ? "NP" : `P${Math.round(cargo.price)}`;
      const compactDescription = cargo.description.length > 22 ? `${cargo.description.slice(0, 21)}...` : cargo.description;
      return {
        label: `${index + 1}`,
        value: `${quantity} ${compactDescription} / ${branch} / ${price}`
      };
    });

    return render80mmReceipt({
      title: "RECEIVING RECEIPT",
      documentNumber: receiving.recordNumber,
      lines: [
        { label: "Customer", value: receiving.customerName },
        { label: "DR", value: receiving.customerDrNumber ?? "Not provided" },
        { label: "Branch", value: branchSummary || receiving.destination },
        { label: "Items", value: `${receiving.packages.length} lines / Qty ${totalQuantity}` },
        { label: "Total", value: withoutPrice ? `PHP ${totalPrice.toFixed(2)} / ${withoutPrice} no price` : `PHP ${totalPrice.toFixed(2)}` },
        ...itemLines,
        { label: "Copy", value: `${printLog.copyNumber} / ${new Date(printLog.createdAt).toLocaleString("en-PH", { hour12: false })}` }
      ],
      footer: "Received By: _______________"
    });
  }

  renderQrLabel(packageId: string) {
    const cargo = this.findPackage(packageId);
    this.logPrint({
      documentType: "QR Label",
      documentNumber: cargo.packageNumber,
      relatedEntityType: "CargoPackage",
      relatedEntityId: cargo.id,
      layout: "80mm"
    });
    return renderQrLabel({
      packageNumber: cargo.packageNumber,
      description: cargo.description,
      destination: cargo.destination,
      qrValue: cargo.qrValue
    });
  }

  renderTripManifest(tripId: string) {
    const trip = this.findTrip(tripId);
    const cargo = trip.cargoPackageIds.map((packageId) => this.findPackage(packageId));
    const printLog = this.logPrint({
      documentType: "Loading Manifest",
      documentNumber: trip.tripNumber,
      relatedEntityType: "Trip",
      relatedEntityId: trip.id,
      layout: "80mm"
    });
    return renderLoadingManifest({
      tripNumber: trip.tripNumber,
      origin: trip.origin,
      destination: trip.destination,
      vehicle: trip.vehicleDescription,
      driver: trip.driverName,
      cargo: cargo.map((pkg) => ({
        packageNumber: pkg.packageNumber,
        description: pkg.description,
        destination: pkg.destination,
        status: pkg.status,
        price: pkg.price
      })),
      auditLine: `${printLog.action} ${printLog.createdAt} / Copy ${printLog.copyNumber}`
    });
  }

  renderDeliveryReceipt(packageId: string) {
    const cargo = this.findPackage(packageId);
    const delivery = [...this.deliveries].reverse().find((entry) => entry.cargoPackageId === cargo.id && entry.status === "Delivered");
    if (!delivery) throw new BadRequestException("Package has no completed delivery receipt yet");
    const latestPayment = [...this.payments].reverse().find((entry) => entry.cargoPackageId === cargo.id);
    this.logPrint({
      documentType: "Delivery Receipt",
      documentNumber: `DR-${cargo.packageNumber}`,
      relatedEntityType: "CargoPackage",
      relatedEntityId: cargo.id,
      layout: "80mm"
    });
    return renderDeliveryReceipt({
      documentNumber: `DR-PREVIEW-${cargo.packageNumber}`,
      packageNumber: cargo.packageNumber,
      customerName: cargo.customerName,
      description: cargo.description,
      destination: cargo.destination,
      deliveredTo: delivery.deliveredTo ?? "Receiver",
      price: cargo.price,
      paymentStatus: latestPayment?.status ?? "Unpaid",
      qrValue: cargo.qrValue
    });
  }

  renderEscPosPreview(text: string) {
    return {
      text,
      bytes: toEscPosTextBytes(text),
      note: "Text-mode ESC/POS preview. QR-specific ESC/POS commands will be validated on NB80 hardware."
    };
  }

  private nextDocumentNumber(prefix: string, date: Date) {
    const next = (this.sequences.get(prefix) ?? 0) + 1;
    this.sequences.set(prefix, next);
    return formatDocumentNumber(prefix, date, next);
  }

  private businessDateKey(value: Date | string) {
    const date = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return `${year}-${month}-${day}`;
  }

  private findPackage(packageId: string) {
    const cargo = this.packages.find((entry) => entry.id === packageId || entry.packageNumber === packageId || entry.qrValue === packageId);
    if (!cargo) throw new NotFoundException("Cargo package not found");
    return cargo;
  }

  private findCustomer(customerId: string) {
    const customer = this.customers.find((entry) => entry.id === customerId);
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  private syncReceivingRecordPackages(receiving: ReceivingRecord) {
    receiving.packages = receiving.packages.map((pkg) => this.packages.find((cargo) => cargo.id === pkg.id) ?? pkg);
    return receiving;
  }

  private findReceivingRecord(receivingRecordId: string) {
    const receiving = this.receivingRecords.find((entry) => entry.id === receivingRecordId || entry.recordNumber === receivingRecordId);
    if (!receiving) throw new NotFoundException("Receiving record not found");
    return this.syncReceivingRecordPackages(receiving);
  }

  private findReceivingDraft(draftId: string) {
    const draft = this.receivingDrafts.find((entry) => entry.id === draftId || entry.draftNumber === draftId);
    if (!draft) throw new NotFoundException("Receiving draft not found");
    return draft;
  }

  private logPrint(input: {
    documentType: string;
    documentNumber: string;
    relatedEntityType: string;
    relatedEntityId: string;
    layout: PrintLog["layout"];
    reason?: string;
  }) {
    const existing = this.printLogs.filter((entry) => entry.documentNumber === input.documentNumber);
    const log: PrintLog = {
      id: id("prt"),
      documentType: input.documentType,
      documentNumber: input.documentNumber,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      action: existing.length ? "Reprinted" : "Printed",
      reason: input.reason,
      printedByName: "Current User",
      layout: input.layout,
      copyNumber: existing.length + 1,
      createdAt: new Date().toISOString()
    };
    this.printLogs.push(log);
    this.audit(log.action === "Printed" ? "document.printed" : "document.reprinted", input.relatedEntityType, input.relatedEntityId, input.reason);
    this.saveData();
    return log;
  }

  private findTrip(tripId: string) {
    const trip = this.trips.find((entry) => entry.id === tripId || entry.tripNumber === tripId);
    if (!trip) throw new NotFoundException("Trip not found");
    return trip;
  }

  private ensureGlobalOperationChat() {
    const existing = this.operationChatThreads.find((thread) => thread.scope === "Global");
    if (existing) return existing;
    const now = new Date().toISOString();
    const thread: OperationChatThread = {
      id: "chat_global_internal",
      scope: "Global",
      title: "Internal Operations Chat",
      status: "Open",
      actionType: "General",
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: id("chat_msg"),
          senderName: "System",
          senderRole: "System",
          body: "Internal chat is ready. Use this for quick operations coordination.",
          system: true,
          createdAt: now
        }
      ]
    };
    this.operationChatThreads.push(thread);
    return thread;
  }

  private findOperationChat(threadId: string) {
    const thread = this.operationChatThreads.find((entry) => entry.id === threadId);
    if (!thread) throw new NotFoundException("Chat thread not found");
    return thread;
  }

  private chatUser(user?: AuthContext) {
    const found = user?.id ? this.getDemoUsers().find((entry) => entry.id === user.id) : undefined;
    return {
      id: user?.id ?? found?.id,
      name: found?.name ?? user?.role ?? "Unknown User",
      role: user?.role ?? found?.role ?? "Unknown Role",
      branchAccess: user?.branchAccess ?? found?.branchAccess
    };
  }

  private canSeeOperationChat(thread: OperationChatThread, user?: AuthContext) {
    if (thread.scope === "Global") return true;
    const role = user?.role ?? "";
    if (role === "System Admin" || role === "Administrator") return true;
    const branchName = thread.branchName?.trim().toLowerCase();
    if (!branchName) return true;
    const access = user?.branchAccess?.trim().toLowerCase() ?? "";
    if (!access || access.includes("all branches") || access.includes("daet / naga") || access.includes("daet/naga")) return true;
    return access.includes(branchName);
  }

  private notify(title: string, message: string, priority: string) {
    this.notifications.push({ id: id("ntf"), title, message, priority, createdAt: new Date().toISOString() });
  }

  private audit(action: string, entityType: string, entityId: string, reason?: string) {
    this.auditLogs.push({ id: id("aud"), action, entityType, entityId, reason, createdAt: new Date().toISOString() });
  }

  private reconcileProductsFromCargo() {
    let changed = false;
    for (const cargo of this.packages) {
      if (cargo.productId && this.productMasters.some((product) => product.id === cargo.productId && product.status !== "Archived")) {
        continue;
      }
      const product = this.ensureProductMasterForCargo({
        description: cargo.description,
        barcode: cargo.productBarcode,
        unit: cargo.unit,
        price: cargo.price,
        photoUrl: cargo.photoUrls[0],
        notes: `Created from existing cargo ${cargo.packageNumber}.`
      });
      cargo.productId = product.id;
      cargo.productBarcode = product.barcode;
      changed = true;
    }
    if (changed) {
      this.audit("products.reconciled_from_cargo", "ProductMaster", "catalog");
      this.saveData();
    }
  }

  private loadData() {
    if (!existsSync(this.dataFile)) {
      this.saveData();
      return;
    }
    const raw = readFileSync(this.dataFile, "utf8");
    if (!raw.trim()) return;
    const data = JSON.parse(raw) as {
      sequences?: Array<[string, number]>;
      customers?: Customer[];
      receivingRecords?: ReceivingRecord[];
      receivingDrafts?: ReceivingDraft[];
      receivingIntakeTasks?: ReceivingIntakeTask[];
      packages?: CargoPackage[];
      productMasters?: ProductMaster[];
      trucks?: TruckRecord[];
      trips?: Trip[];
      deliveries?: DeliveryRecord[];
      payments?: PaymentRecord[];
      expenses?: ExpenseRecord[];
      returnRecords?: ReturnRecord[];
      billingInvoices?: BillingInvoice[];
      notifications?: Array<{ id: string; title: string; message: string; priority: string; createdAt: string }>;
      auditLogs?: Array<{ id: string; action: string; entityType: string; entityId: string; reason?: string; createdAt: string }>;
      descriptionBarcodes?: Array<{ id: string; customerId: string; barcode: string; description: string }>;
      messages?: Array<{ id: string; cargoPackageId: string; senderName: string; body: string; createdAt: string }>;
      operationChatThreads?: OperationChatThread[];
      hardwareTests?: HardwareTestRecord[];
      printLogs?: PrintLog[];
      customUsers?: StaffUserRecord[];
      companyProfile?: CompanyProfile;
      branches?: Branch[];
      paymentMethods?: string[];
      expenseCategories?: string[];
      userBranchAccessOverrides?: Record<string, string>;
    };
    this.sequences = new Map(data.sequences ?? []);
    this.customers = data.customers?.length
      ? data.customers.map((customer) => ({
          ...customer,
          status: customer.status ?? "Active",
          contacts: customer.contacts?.length ? customer.contacts : buildPrimaryContact(customer)
        }))
      : this.customers;
    this.receivingRecords = data.receivingRecords ?? [];
    this.receivingDrafts = data.receivingDrafts ?? [];
    this.receivingIntakeTasks = data.receivingIntakeTasks ?? [];
    this.packages = (data.packages ?? []).map((cargo) => ({
      ...cargo,
      quantity: cargo.quantity ?? 1,
      unit: cargo.unit ?? "pcs",
      handlingBranchId: cargo.handlingBranchId ?? (cargo.destination ?? "Daet").toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      handlingBranchName: cargo.handlingBranchName ?? cargo.destination ?? "Daet",
      deliveryType: cargo.deliveryType ?? "Deliver to consignee"
    }));
    this.productMasters = data.productMasters ?? this.productMasters;
    this.trucks = mergeTruckRecords(data.trucks);
    this.trips = data.trips ?? [];
    this.deliveries = data.deliveries ?? [];
    this.payments = (data.payments ?? []).map((payment) => {
      const cargo = this.packages.find((pkg) => pkg.id === payment.cargoPackageId);
      return {
        ...payment,
        collectionPoint: payment.collectionPoint ?? "Owner",
        collectedByName: payment.collectedByName ?? "Owner Demo",
        collectedByRole: payment.collectedByRole ?? "Administrator",
        branchId: payment.branchId ?? cargo?.handlingBranchId,
        branchName: payment.branchName ?? cargo?.handlingBranchName
      };
    });
    this.expenses = data.expenses ?? [];
    this.returnRecords = data.returnRecords ?? [];
    this.billingInvoices = data.billingInvoices ?? [];
    this.notifications = data.notifications ?? [];
    this.auditLogs = data.auditLogs ?? [];
    this.descriptionBarcodes = data.descriptionBarcodes ?? [];
    this.messages = data.messages ?? [];
    this.operationChatThreads = data.operationChatThreads ?? [];
    this.hardwareTests = data.hardwareTests ?? [];
    this.printLogs = data.printLogs ?? [];
    this.customUsers = data.customUsers ?? [];
    this.companyProfile = data.companyProfile ?? this.companyProfile;
    this.branches = data.branches?.length ? data.branches : this.branches;
    this.paymentMethods = data.paymentMethods?.length ? data.paymentMethods : this.paymentMethods;
    this.expenseCategories = data.expenseCategories?.length ? data.expenseCategories : this.expenseCategories;
    this.userBranchAccessOverrides = data.userBranchAccessOverrides ?? {};
  }

  private saveData() {
    mkdirSync(dirname(this.dataFile), { recursive: true });
    writeFileSync(
      this.dataFile,
      JSON.stringify(
        {
          sequences: Array.from(this.sequences.entries()),
          customers: this.customers,
          receivingRecords: this.receivingRecords,
          receivingDrafts: this.receivingDrafts,
          receivingIntakeTasks: this.receivingIntakeTasks,
          packages: this.packages,
          productMasters: this.productMasters,
          trucks: this.trucks,
          trips: this.trips,
          deliveries: this.deliveries,
          payments: this.payments,
          expenses: this.expenses,
          returnRecords: this.returnRecords,
          billingInvoices: this.billingInvoices,
          notifications: this.notifications,
          auditLogs: this.auditLogs,
          descriptionBarcodes: this.descriptionBarcodes,
          messages: this.messages,
          operationChatThreads: this.operationChatThreads,
          hardwareTests: this.hardwareTests,
          printLogs: this.printLogs,
          customUsers: this.customUsers,
          companyProfile: this.companyProfile,
          branches: this.branches,
          paymentMethods: this.paymentMethods,
          expenseCategories: this.expenseCategories,
          userBranchAccessOverrides: this.userBranchAccessOverrides
        },
        null,
        2
      )
    );
  }

  private cleanList(values: string[], label: string) {
    const cleaned = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    if (!cleaned.length) throw new BadRequestException(`${label} list cannot be empty`);
    return cleaned;
  }

  private getDemoUsers() {
    return [...demoUsers, ...this.customUsers].map((user) => ({
      ...user,
      branchAccess: this.userBranchAccessOverrides[user.id] ?? user.branchAccess
    }));
  }
}
