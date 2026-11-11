import { BadRequestException, Injectable, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
import { renderDeliveryReceipt, renderLoadingManifest, renderQrLabel, renderReceivingDocument, renderReceivingSlip, summarizePrinterDiagnostic, toEscPosTextBytes, type PrinterDiagnosticCheck } from "@mts-lbmp/printing";
import { hashSecret, signAuthToken, verifySecret } from "./security.js";
import { createStateStore, type LoadedServiceState, type ServiceState, type StateStore } from "./state-store.js";
import { buildDemoCredentialOverlay, resolveSmokeSeedConfig, upsertSmokeAccounts, type DemoCredentialOverlayEntry } from "./smoke-seed.js";
import type {
  CargoPackage,
  Customer,
  CustomerContact,
  BillingInvoice,
  DeliveryRecord,
  DescriptionBarcode,
  ExpenseRecord,
  OperationChatThread,
  PackageMessage,
  PaymentRecord,
  PrintLog,
  ReceivingDraft,
  ReceivingIntakeDuplicateSubmission,
  ReceivingIntakeTask,
  ReceivingRecord,
  ReturnRecord,
  Branch,
  CompanyProfile,
  HardwareTestRecord,
  IdempotencyRecord,
  ProductMaster,
  ServiceAuditLog,
  ServiceNotification,
  StaffUserRecord,
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

/**
 * Identity of a rendered document, returned alongside the text so the client
 * can report the print hand-off against the right entity. Rendering never
 * writes a PrintLog row — see recordPrintHandoff.
 */
export interface PrintDocumentMeta {
  documentType: string;
  documentNumber: string;
  relatedEntityType: string;
  relatedEntityId: string;
  layout: PrintLog["layout"];
}

export interface RenderedDocument {
  text: string;
  print: PrintDocumentMeta;
}

export interface PrintHandoffInput {
  documentType: string;
  documentNumber: string;
  relatedEntityType: string;
  relatedEntityId: string;
  layout: PrintLog["layout"];
  deviceName?: string;
  outcome: PrintLog["outcome"];
  /** Client-reported error text; stored as the log's reason when outcome is "Failed". */
  error?: string;
}

export interface PrinterDiagnosticInput {
  deviceName: string;
  checks: PrinterDiagnosticCheck[];
  scannerResult?: HardwareTestRecord["scannerResult"];
  cameraResult?: HardwareTestRecord["cameraResult"];
  signatureResult?: HardwareTestRecord["signatureResult"];
  pwaResult?: HardwareTestRecord["pwaResult"];
}

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

/**
 * Phase 5 P5-1 login throttle: after this many consecutive failed sign-ins
 * against one account (either door — the counter is shared), the account
 * locks for LOGIN_LOCKOUT_MS. A successful sign-in resets the counter.
 * Both values are env-tunable for local testing; the defaults are the
 * audit's recommendation (§7 P5-1).
 */
const LOGIN_MAX_FAILED_ATTEMPTS = Number(process.env.LOGIN_MAX_FAILED_ATTEMPTS ?? 10);
const LOGIN_LOCKOUT_MS = Number(process.env.LOGIN_LOCKOUT_MS ?? 15 * 60 * 1000);

const STAFF_CODE_LOGIN_ROLES = ["System Admin", "Daet Owner", "Naga Owner", "Receiving Staff", "Delivery Staff", "Delivery Admin"];

/**
 * The six built-in demo accounts. Since P5-1 they carry NO credentials:
 * no passwordHash and no staffCodeHash, so both login doors fail closed
 * for them. Local development can still sign in as them only through the
 * ALLOW_DEMO_AUTH-gated overlay (see smoke-seed.ts), which is refused in
 * production. P5-2 removes these accounts entirely.
 */
const demoUsers: StaffUserRecord[] = [
  {
    id: "user_daet_owner",
    name: "Daet Owner Demo",
    email: "daet.owner@mts.local",
    role: "Daet Owner",
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
export class LogisticsService implements OnModuleInit, OnModuleDestroy {
  private readonly dataFile = resolve(process.env.INIT_CWD ?? process.cwd(), "storage/dev-data/mts-lbmp.json");
  private readonly uploadDir = resolve(process.env.INIT_CWD ?? process.cwd(), "storage/test-uploads");
  private readonly store: StateStore = createStateStore(this.dataFile);
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
  private descriptionBarcodes: DescriptionBarcode[] = [];
  private messages: PackageMessage[] = [];
  private operationChatThreads: OperationChatThread[] = [];
  private hardwareTests: HardwareTestRecord[] = [];
  private printLogs: PrintLog[] = [];
  private customUsers: StaffUserRecord[] = [];
  /**
   * Phase 5 P5-1: in-memory demo-account credentials (hashes only),
   * populated at boot ONLY when the ALLOW_DEMO_AUTH dev gate is open
   * (see smoke-seed.ts). Empty in every other run, which is what makes
   * the credential-less demo accounts fail closed. Never persisted.
   */
  private demoCredentialOverlay = new Map<string, DemoCredentialOverlayEntry>();
  private idempotencyRecords: IdempotencyRecord[] = [];
  private userBranchAccessOverrides: Record<string, string> = {};
  private notifications: ServiceNotification[] = [];
  private auditLogs: ServiceAuditLog[] = [];

  async onModuleInit() {
    await this.loadData();
    this.seedSmokeAccountsIfRequested();
    this.reconcileProductsFromCargo();
  }

  /**
   * Phase 5 P5-0: provision the smoke-gate accounts (see smoke-seed.ts).
   * Inert unless ALLOW_DEMO_AUTH=true in a non-production process; the
   * accounts are ordinary custom users that sign in through the real
   * login path, so the smoke scripts no longer depend on the demo users.
   */
  private seedSmokeAccountsIfRequested() {
    const config = resolveSmokeSeedConfig(process.env);
    if (!config) return;
    // Phase 5 P5-1: the same gate also provisions the demo accounts'
    // credentials as an in-memory hash overlay, so local dev sign-in as
    // the demo users keeps working while this flag is on — and only
    // while it is on. The overlay is never written to state.
    this.demoCredentialOverlay = buildDemoCredentialOverlay();
    const { users, changed } = upsertSmokeAccounts(this.customUsers, config);
    if (!changed) return;
    this.customUsers = users;
    console.warn(
      `[smoke-seed] ALLOW_DEMO_AUTH is on outside production: seeded smoke-test accounts ` +
        `${config.email} (System Admin) and ${config.limitedEmail} (Delivery Staff), ` +
        `and enabled demo-account sign-in for local development. ` +
        `Never enable ALLOW_DEMO_AUTH outside local/test runs.`
    );
    this.saveData();
  }

  async onModuleDestroy() {
    await this.store.close?.();
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
        .map((user) => this.toSafeUser(user))
    };
  }

  /**
   * Phase 5 P5-1 — the only shape in which a user record may leave the
   * service: credential hashes, the session watermark, and the login
   * throttle state are stripped; `hasStaffCode` reports whether a staff
   * code credential exists without exposing it.
   */
  private toSafeUser(user: StaffUserRecord) {
    const { passwordHash, staffCodeHash, sessionVersion, failedLoginAttempts, loginLockedUntil, ...safeUser } = user;
    void passwordHash;
    void staffCodeHash;
    void sessionVersion;
    void failedLoginAttempts;
    void loginLockedUntil;
    return { ...safeUser, hasStaffCode: this.hasStaffCode(user), lastLogin: new Date().toISOString() };
  }

  /** The live record behind a display copy (getDemoUsers returns copies). */
  private findUserRecord(userId: string): StaffUserRecord | undefined {
    return this.customUsers.find((entry) => entry.id === userId) ?? demoUsers.find((entry) => entry.id === userId);
  }

  /**
   * Effective credentials: the account's own stored hash wins; the demo
   * accounts — which store none — fall back to the ALLOW_DEMO_AUTH-gated
   * in-memory overlay (empty unless the dev gate is open).
   */
  private passwordHashFor(user: StaffUserRecord) {
    return user.passwordHash ?? this.demoCredentialOverlay.get(user.id)?.passwordHash;
  }

  private staffCodeHashFor(user: StaffUserRecord) {
    return user.staffCodeHash ?? this.demoCredentialOverlay.get(user.id)?.staffCodeHash;
  }

  private hasStaffCode(user: StaffUserRecord) {
    return Boolean(this.staffCodeHashFor(user));
  }

  private isLoginLocked(record: StaffUserRecord) {
    return Boolean(record.loginLockedUntil && new Date(record.loginLockedUntil).getTime() > Date.now());
  }

  /**
   * Records a failed sign-in: always audited (failed logins were invisible
   * before P5-1), and — when the attempt is attributable to an account —
   * counted on that account. Reaching LOGIN_MAX_FAILED_ATTEMPTS locks the
   * account for LOGIN_LOCKOUT_MS on BOTH doors (the counter is shared).
   */
  private registerLoginFailure(record: StaffUserRecord | undefined, door: "password" | "staffCode", attemptedIdentifier: string) {
    if (!record) {
      this.audit("auth.loginFailed", "User", attemptedIdentifier, `door=${door}; unknown or inactive account`);
      this.saveData();
      return;
    }
    record.failedLoginAttempts = (record.failedLoginAttempts ?? 0) + 1;
    if (record.failedLoginAttempts >= LOGIN_MAX_FAILED_ATTEMPTS) {
      record.loginLockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_MS).toISOString();
      this.audit(
        "auth.loginLocked",
        "User",
        record.id,
        `door=${door}; ${record.failedLoginAttempts} consecutive failures; locked until ${record.loginLockedUntil}`
      );
    } else {
      this.audit("auth.loginFailed", "User", record.id, `door=${door}; consecutive failures=${record.failedLoginAttempts}`);
    }
    this.saveData();
  }

  /** A successful sign-in clears the shared failure counter and any lock. */
  private registerLoginSuccess(record: StaffUserRecord) {
    if (record.failedLoginAttempts || record.loginLockedUntil) {
      record.failedLoginAttempts = 0;
      record.loginLockedUntil = undefined;
      this.saveData();
    }
  }

  private lockedLoginError() {
    return new BadRequestException("Account is temporarily locked after repeated failed sign-ins. Try again later.");
  }

  login(input: { email: string; password: string }) {
    const user = this.getDemoUsers().find((entry) => entry.email === input.email);
    const record = user ? this.findUserRecord(user.id) : undefined;
    if (!user || !record || user.status === "Inactive") {
      this.registerLoginFailure(undefined, "password", String(input.email ?? ""));
      throw new BadRequestException("Invalid email or password");
    }
    if (this.isLoginLocked(record)) {
      this.audit("auth.loginLocked", "User", user.id, "door=password; sign-in attempted during lockout");
      throw this.lockedLoginError();
    }
    // Fail closed: an account with no password hash of its own cannot sign
    // in through this door at all — there is no shared fallback password.
    const storedHash = this.passwordHashFor(record);
    if (!storedHash || !verifySecret(input.password ?? "", storedHash)) {
      this.registerLoginFailure(record, "password", user.id);
      throw new BadRequestException("Invalid email or password");
    }
    this.registerLoginSuccess(record);
    this.audit("auth.login", "User", user.id);
    return {
      user: this.toSafeUser(user),
      token: signAuthToken({
        userId: user.id,
        role: user.role,
        branchAccess: user.branchAccess,
        sessionVersion: record.sessionVersion ?? 0
      }),
      note: "Signed JWT. The session is revoked when the account's credentials change."
    };
  }

  loginWithStaffCode(input: { staffCode: string }) {
    const cleanCode = String(input.staffCode ?? "").trim();
    // Codes are stored only as per-user PBKDF2 hashes, so the match is a
    // verify against each eligible account's hash (codes are unique across
    // accounts — createStaffUser/updateStaffUser enforce it the same way).
    let matchedUser: StaffUserRecord | undefined;
    let matchedRecord: StaffUserRecord | undefined;
    if (cleanCode) {
      for (const candidate of this.getDemoUsers()) {
        if (candidate.status === "Inactive" || !STAFF_CODE_LOGIN_ROLES.includes(candidate.role)) continue;
        const storedHash = this.staffCodeHashFor(candidate);
        if (storedHash && verifySecret(cleanCode, storedHash)) {
          matchedUser = candidate;
          matchedRecord = this.findUserRecord(candidate.id);
          break;
        }
      }
    }
    if (!matchedUser || !matchedRecord) {
      // A code that matches no account cannot be attributed to one, so no
      // per-account counter moves; the failure is still audited, and the
      // global throttler remains the brake on unattributed guessing.
      this.registerLoginFailure(undefined, "staffCode", "staff-code");
      throw new BadRequestException("Invalid staff code");
    }
    if (this.isLoginLocked(matchedRecord)) {
      this.audit("auth.loginLocked", "User", matchedUser.id, "door=staffCode; sign-in attempted during lockout");
      throw this.lockedLoginError();
    }
    this.registerLoginSuccess(matchedRecord);
    this.audit("auth.staffCodeLogin", "User", matchedUser.id);
    return {
      user: this.toSafeUser(matchedUser),
      token: signAuthToken({
        userId: matchedUser.id,
        role: matchedUser.role,
        branchAccess: matchedUser.branchAccess,
        sessionVersion: matchedRecord.sessionVersion ?? 0
      }),
      note: "Signed JWT. The session is revoked when the account's credentials change."
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
    return this.toSafeUser(updated);
  }

  /**
   * Staff-code uniqueness under hashed storage: a candidate code is "in
   * use" when it verifies against any other account's stored hash (the
   * demo overlay counts while the dev gate is open). Plaintext comparison
   * is impossible — salts differ per hash — which is the point.
   */
  private staffCodeInUse(code: string, exceptUserId?: string) {
    return this.getDemoUsers().some((entry) => {
      if (entry.id === exceptUserId) return false;
      const storedHash = this.staffCodeHashFor(entry);
      return Boolean(storedHash) && verifySecret(code, storedHash as string);
    });
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
    if (this.staffCodeInUse(staffCode)) {
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
      // Phase 5 P5-1: the code is hashed at the moment it is set and the
      // plaintext is never stored. No password is set here — initial
      // password provisioning is P5-2's lifecycle work, so a created
      // account signs in via its staff code until then.
      staffCodeHash: hashSecret(staffCode),
      sessionVersion: 0,
      branchAccess: input.branchAccess?.trim() || "Daet / Naga",
      permissionPreset: input.role,
      canApprove: [],
      status: input.status ?? "Active",
      createdAt: new Date().toISOString()
    };
    this.customUsers.push(user);
    this.audit("settings.user.create", "User", user.id, `${user.name} - ${user.role} - ${user.branchAccess}`);
    this.saveData();
    return this.toSafeUser(user);
  }

  updateStaffUser(
    userId: string,
    input: Partial<Pick<StaffUserRecord, "name" | "phone" | "email" | "role" | "branchAccess" | "status">> & {
      /** Plaintext on input only — hashed before it is stored (P5-1). */
      staffCode?: string;
    }
  ) {
    const customUser = this.customUsers.find((entry) => entry.id === userId);
    const demoUser = demoUsers.find((entry) => entry.id === userId);
    const user = customUser ?? demoUser;
    if (!user) throw new NotFoundException("User not found");

    // "Changed" under hashed storage means: does not verify against the
    // account's current hash. Re-submitting the same code is a no-op.
    const newStaffCode = input.staffCode?.trim();
    const ownStaffCodeHash = this.staffCodeHashFor(user);
    const staffCodeChanged = Boolean(newStaffCode) && !(ownStaffCodeHash && verifySecret(newStaffCode as string, ownStaffCodeHash));
    if (newStaffCode && staffCodeChanged && this.staffCodeInUse(newStaffCode, userId)) {
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
      if (newStaffCode && staffCodeChanged) {
        // Credential change: store the new hash and bump sessionVersion so
        // every token issued under the old credential stops working
        // (Phase 5 P5-1 revocation mechanism).
        customUser.staffCodeHash = hashSecret(newStaffCode);
        customUser.sessionVersion = (customUser.sessionVersion ?? 0) + 1;
      }
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
    return this.toSafeUser(updated);
  }

  getAuthUserById(userId: string) {
    const user = this.getDemoUsers().find((entry) => entry.id === userId && entry.status !== "Inactive");
    if (!user) return undefined;
    return {
      id: user.id,
      role: user.role,
      branchAccess: user.branchAccess,
      // Phase 5 P5-1: the auth guard compares this against the token's
      // `sv` claim to enforce credential-change revocation.
      sessionVersion: user.sessionVersion ?? 0
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
    this.assertNoLocalPhotoReference(input.photoUrl, "Product photo");
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
    drPhotoLocalId?: string;
    notes?: string;
  }) {
    const customerName = input.customerName?.trim();
    if (!customerName) throw new BadRequestException("Company/customer name is required");
    this.assertNoLocalPhotoReference(input.drPhotoUrl, "DR photo");
    const warehouseCode = input.warehouseCode?.trim() || "origin";
    const destinationBranch = input.destinationBranch?.trim() || undefined;
    const customerDrNumber = input.customerDrNumber?.trim() || undefined;
    const drPhotoLocalId = this.normalizeLocalPhotoId(input.drPhotoLocalId);
    // The dedupe window is the Manila business day (Phase 4 audit B5): the
    // UTC date flips at 08:00 PHT and split one business day into two keys.
    const duplicateKey = [
      warehouseCode.toLowerCase(),
      customerName.toLowerCase(),
      customerDrNumber?.toLowerCase() || "no-dr",
      destinationBranch?.toLowerCase() || "no-branch",
      this.businessDateKey(new Date())
    ].join("|");
    const now = new Date().toISOString();
    const duplicate = this.receivingIntakeTasks.find((task) => task.duplicateKey === duplicateKey && task.status === "Pending Review");
    if (duplicate) {
      duplicate.duplicateCount += 1;
      duplicate.updatedAt = now;
      if (input.drPhotoUrl) duplicate.extraPhotoUrls.push(input.drPhotoUrl);
      // Phase 4 audit B5: a merged duplicate must not silently discard the
      // incoming submission. The full normalized payload is kept on a
      // duplicate note, and any field the original submission lacked is
      // filled from the incoming values. Non-empty original fields are never
      // overwritten by a conflicting duplicate.
      const submission: ReceivingIntakeDuplicateSubmission = {
        customerName,
        customerDrNumber,
        dropOffPerson: input.dropOffPerson?.trim() || undefined,
        dropOffPhone: input.dropOffPhone?.trim() || undefined,
        consigneeName: input.consigneeName?.trim() || undefined,
        destinationBranch,
        deliveryArea: input.deliveryArea?.trim() || undefined,
        itemDescription: input.itemDescription?.trim() || undefined,
        quantity: input.quantity === undefined ? undefined : Number(input.quantity),
        unit: input.unit?.trim() || undefined
      };
      if (!duplicate.dropOffPerson && submission.dropOffPerson) duplicate.dropOffPerson = submission.dropOffPerson;
      if (!duplicate.dropOffPhone && submission.dropOffPhone) duplicate.dropOffPhone = submission.dropOffPhone;
      if (!duplicate.consigneeName && submission.consigneeName) {
        duplicate.consigneeName = submission.consigneeName;
        const receiverQuery = submission.consigneeName.toLowerCase();
        duplicate.receiverMatched = this.customers.some((entry) => (entry.contacts ?? []).some((contact) => contact.name.toLowerCase() === receiverQuery));
      }
      if (!duplicate.deliveryArea && submission.deliveryArea) duplicate.deliveryArea = submission.deliveryArea;
      if (!duplicate.itemDescription && submission.itemDescription) {
        duplicate.itemDescription = submission.itemDescription;
        const productQuery = submission.itemDescription.toLowerCase();
        const product = this.productMasters.find((entry) => entry.name.toLowerCase() === productQuery || entry.barcode?.toLowerCase() === productQuery);
        duplicate.productId = product?.id;
        duplicate.productMatched = Boolean(product);
      }
      duplicate.duplicateNotes.push({
        id: id("intake_note"),
        note: input.notes?.trim() || undefined,
        photoUrl: input.drPhotoUrl?.trim() || undefined,
        photoLocalId: drPhotoLocalId,
        submission,
        createdAt: now
      });
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
      drPhotoLocalId,
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

  /**
   * Phase 4 audit A6: when a queued device photo finishes uploading, attach
   * its server URL to the intake record that referenced it by local photo id.
   * Matches the task's pending DR photo reference (drPhotoLocalId) and any
   * duplicate note still carrying a pending photo reference; a resolved
   * duplicate photo also joins extraPhotoUrls, mirroring how an immediately
   * uploaded duplicate photo is stored. If the task was already converted and
   * the receiving record still has no DR photo, the URL flows through to it.
   * Only an exact pending-reference match is acted on.
   */
  resolveReceivingIntakeQueuedPhoto(input: { localPhotoId: string; fileUrl: string }) {
    const localPhotoId = this.normalizeLocalPhotoId(input.localPhotoId);
    if (!localPhotoId) throw new BadRequestException("Local photo id is required");
    const fileUrl = input.fileUrl?.trim();
    if (!fileUrl) throw new BadRequestException("Uploaded photo URL is required");
    this.assertNoLocalPhotoReference(fileUrl, "Uploaded photo URL");
    let resolvedCount = 0;
    for (const task of this.receivingIntakeTasks) {
      let touched = false;
      if (task.drPhotoLocalId === localPhotoId) {
        if (task.drPhotoUrl) task.extraPhotoUrls.push(fileUrl);
        else task.drPhotoUrl = fileUrl;
        task.drPhotoLocalId = undefined;
        touched = true;
        if (task.convertedReceivingId) {
          const receiving = this.receivingRecords.find((entry) => entry.id === task.convertedReceivingId);
          if (receiving && !receiving.drPhotoUrl) receiving.drPhotoUrl = fileUrl;
        }
      }
      for (const note of task.duplicateNotes) {
        if (note.photoLocalId === localPhotoId) {
          note.photoUrl = fileUrl;
          note.photoLocalId = undefined;
          task.extraPhotoUrls.push(fileUrl);
          touched = true;
        }
      }
      if (touched) {
        resolvedCount += 1;
        task.updatedAt = new Date().toISOString();
        this.audit("receiving.intake_photo_resolved", "ReceivingIntakeTask", task.id, task.intakeNumber);
      }
    }
    if (resolvedCount) this.saveData();
    return { resolvedCount };
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
    idempotencyKey?: string;
  }) {
    return this.runIdempotent("POST /receiving/drafts", input.idempotencyKey, () => this.createReceivingDraftOnce(input));
  }

  private createReceivingDraftOnce(input: Parameters<LogisticsService["createReceivingDraft"]>[0]) {
    this.assertNoLocalPhotoReference(input.drPhotoUrl, "DR photo");
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

  updateReceivingDraft(
    draftId: string,
    input: Partial<Pick<ReceivingDraft, "customerId" | "customerDrNumber" | "destination" | "drPhotoUrl" | "formState" | "productLines">> & {
      idempotencyKey?: string;
    }
  ) {
    // Phase 4 PR 3: draft updates are queueable offline (queueablePatch) and
    // replay with the queue record's id as the key, like every other
    // queueable write — a replay after a lost response returns the original
    // result instead of re-applying the update.
    return this.runIdempotent("PATCH /receiving/drafts/:id", input.idempotencyKey, () => this.updateReceivingDraftOnce(draftId, input));
  }

  private updateReceivingDraftOnce(draftId: string, input: Partial<Pick<ReceivingDraft, "customerId" | "customerDrNumber" | "destination" | "drPhotoUrl" | "formState" | "productLines">>) {
    this.assertNoLocalPhotoReference(input.drPhotoUrl, "DR photo");
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
    // The idempotency scope names the draft itself, so a key can never be
    // mistaken for a different draft's finalize.
    return this.runIdempotent(`POST /receiving/drafts/${draftId}/finalize`, input.idempotencyKey, () =>
      this.finalizeReceivingDraftOnce(draftId, input)
    );
  }

  private finalizeReceivingDraftOnce(draftId: string, input: Parameters<LogisticsService["createReceiving"]>[0]) {
    const draft = this.findReceivingDraft(draftId);
    // B4 replay safety: an offline finalize queued on one device may replay
    // after the same draft was already finalized online (staff re-did the
    // work at a connected terminal). Minting a second receiving record
    // would duplicate every package, so a replay against an
    // already-finalized draft returns the record the draft points at —
    // the same shape as the original finalize result. Keyed replays never
    // reach here (B1 returns the stored result first); this guard covers
    // the different-key and unkeyed cases.
    if (draft.status === "Finalized" && draft.finalizedReceivingId) {
      const existing = this.receivingRecords.find((record) => record.id === draft.finalizedReceivingId);
      if (existing) return { draft, receiving: existing };
    }
    if (draft.status !== "Draft") throw new BadRequestException("Only draft records can be finalized");
    const receiving = this.createReceivingOnce(input);
    draft.status = "Finalized";
    draft.finalizedReceivingId = receiving.id;
    draft.updatedAt = new Date().toISOString();
    this.audit("receiving.draft_finalized", "ReceivingDraft", draft.id);
    this.saveData();
    return { draft, receiving };
  }

  createReceiving(input: Parameters<LogisticsService["createReceivingOnce"]>[0]) {
    return this.runIdempotent("POST /receiving", input.idempotencyKey, () => this.createReceivingOnce(input));
  }

  private createReceivingOnce(input: {
    customerId: string;
    idempotencyKey?: string;
    /**
     * B4: the payment collected at the receiving counter, applied by the
     * server as part of the finalize unit. The offline queue cannot replay
     * the client's follow-up /payments calls (they need the server-minted
     * receiving and package ids), so a queued finalize carries the
     * collection with it and the server applies it exactly once — see
     * applyReceivingCollectPayment. Online clients may omit it and keep
     * posting /payments themselves.
     */
    collectPayment?: {
      totalPaid: number;
      paymentStatus?: string;
      method?: string;
      reference?: string;
      proofUrl?: string;
      notes?: string;
    };
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
    this.assertNoLocalPhotoReference(input.drPhotoUrl, "DR photo");
    for (const pkg of input.packages) this.assertNoLocalPhotoReference(pkg.photoUrls, "Package photo");
    // Validate the counter payment's proof up front too, so a bad proof
    // URL fails the whole finalize before any record or number is minted.
    if (input.collectPayment) this.assertNoLocalPhotoReference(input.collectPayment.proofUrl, "Payment proof");

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
    if (input.collectPayment) this.applyReceivingCollectPayment(receiving, input.collectPayment);
    this.saveData();
    return receiving;
  }

  /**
   * B4: applies the payment collected at the receiving counter as part of
   * the finalize unit. Mirrors the web client's recordReceivingPayments
   * distribution exactly — packages in order, each capped at its amount
   * due; an Advance Payment larger than the total due puts the excess on
   * the first package — and records each collection through recordPayment
   * with the same deterministic per-package key the client derives
   * (`receiving-payment:<receivingId>:<packageId>`), so a replayed
   * finalize can never double-collect. The collector identity fields the
   * online client sends are not available server-side and stay unset.
   */
  private applyReceivingCollectPayment(
    receiving: ReceivingRecord,
    collectPayment: NonNullable<Parameters<LogisticsService["createReceivingOnce"]>[0]["collectPayment"]>
  ) {
    const paymentStatus = collectPayment.paymentStatus ?? "";
    if (paymentStatus === "Unpaid") return;
    const totalPaid = Number(collectPayment.totalPaid ?? 0);
    if (!Number.isFinite(totalPaid) || totalPaid <= 0) return;
    const totalAmountDue = receiving.packages.reduce((sum, pkg) => sum + Number(pkg.price ?? 0), 0);
    let remaining = totalPaid;
    receiving.packages.forEach((pkg, index) => {
      const amountDue = Number(pkg.price ?? 0);
      const isLastPackage = index === receiving.packages.length - 1;
      const amountPaid =
        paymentStatus === "Advance Payment" && index === 0 && totalPaid > totalAmountDue
          ? totalPaid - receiving.packages.slice(1).reduce((sum, item) => sum + Number(item.price ?? 0), 0)
          : Math.min(Math.max(remaining, 0), amountDue);
      if (amountPaid <= 0 && !isLastPackage) return;
      if (amountPaid <= 0) return;
      remaining -= amountPaid;
      this.recordPayment({
        cargoPackageId: pkg.id,
        amountDue,
        amountPaid,
        method: collectPayment.method?.trim() || "Cash",
        collectionPoint: "Receiving",
        branchName: pkg.handlingBranchName ?? pkg.destination,
        proofUrl: collectPayment.proofUrl,
        notes:
          [
            `Collected during receiving ${receiving.recordNumber}`,
            paymentStatus,
            collectPayment.reference ? `Reference: ${collectPayment.reference}` : "",
            collectPayment.notes ?? "",
            paymentStatus === "Advance Payment" && totalPaid > totalAmountDue
              ? `Advance/excess: PHP ${(totalPaid - totalAmountDue).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : ""
          ]
            .filter(Boolean)
            .join(" | ") || undefined,
        idempotencyKey: `receiving-payment:${receiving.id}:${pkg.id}`
      });
      if (remaining <= 0 && paymentStatus !== "Advance Payment") return;
    });
  }

  attachReceivingDrPhoto(receivingRecordId: string, input: { drPhotoUrl: string; reason?: string; idempotencyKey?: string }) {
    return this.runIdempotent("POST /receiving/:id/dr-photo", input.idempotencyKey, () =>
      this.attachReceivingDrPhotoOnce(receivingRecordId, input)
    );
  }

  private attachReceivingDrPhotoOnce(receivingRecordId: string, input: Parameters<LogisticsService["attachReceivingDrPhoto"]>[1]) {
    if (!input.drPhotoUrl?.trim()) throw new BadRequestException("DR photo URL is required");
    this.assertNoLocalPhotoReference(input.drPhotoUrl, "DR photo");
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

  loadCargo(tripId: string, input: { cargoPackageId: string; overrideReason?: string; idempotencyKey?: string }) {
    return this.runIdempotent(`POST /trips/${tripId}/load`, input.idempotencyKey, () => this.loadCargoOnce(tripId, input));
  }

  private loadCargoOnce(tripId: string, input: Parameters<LogisticsService["loadCargo"]>[1]) {
    const trip = this.findTrip(tripId);
    const cargo = this.findPackage(input.cargoPackageId);
    // B4 replay semantics: a load of a package that is already on THIS
    // trip is the original load replayed (queued offline, response lost,
    // or a double-tap) — return the current outcome without re-stamping
    // statuses or auditing a second load. A load replaying after the
    // package was put on ANOTHER active trip is a real conflict and fails
    // loudly below, so the offline queue surfaces it as a per-item failure
    // with this reason instead of silently moving the cargo.
    if (trip.cargoPackageIds.includes(cargo.id) && !["Completed", "Cancelled"].includes(trip.status)) {
      return { trip, cargo };
    }
    const otherTrip = this.trips.find(
      (entry) => entry.id !== trip.id && !["Completed", "Cancelled"].includes(entry.status) && entry.cargoPackageIds.includes(cargo.id)
    );
    if (otherTrip) {
      throw new BadRequestException(
        `${cargo.packageNumber} is already loaded on trip ${otherTrip.tripNumber} (${otherTrip.status}). It stays on that trip — unload it there before loading it elsewhere.`
      );
    }
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
    if (cargo.status === "Cancelled") throw new BadRequestException("Cancelled cargo cannot be loaded.");
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

  unloadCargo(tripId: string, input: { cargoPackageId: string; reason?: string; idempotencyKey?: string }) {
    return this.runIdempotent(`POST /trips/${tripId}/unload`, input.idempotencyKey, () => this.unloadCargoOnce(tripId, input));
  }

  private unloadCargoOnce(tripId: string, input: Parameters<LogisticsService["unloadCargo"]>[1]) {
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

  attachTripLoadingPhoto(tripId: string, input: { photoUrl: string; idempotencyKey?: string }) {
    return this.runIdempotent("POST /trips/:id/loading-photo", input.idempotencyKey, () =>
      this.attachTripLoadingPhotoOnce(tripId, input)
    );
  }

  private attachTripLoadingPhotoOnce(tripId: string, input: Parameters<LogisticsService["attachTripLoadingPhoto"]>[1]) {
    const trip = this.findTrip(tripId);
    if (!input.photoUrl) throw new BadRequestException("Loading photo is required.");
    this.assertNoLocalPhotoReference(input.photoUrl, "Loading photo");
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
    idempotencyKey?: string;
  }) {
    return this.runIdempotent("POST /returns", input.idempotencyKey, () => this.createReturnRecordOnce(input));
  }

  private createReturnRecordOnce(input: Parameters<LogisticsService["createReturnRecord"]>[0]) {
    const cargo = this.findPackage(input.cargoPackageId);
    // B3 transition guard: a package can have only one open return request.
    // A repeat submission (queued replay under a different key, double-tap)
    // returns the open request instead of stacking a second one and
    // re-stamping the package. Return records never leave "Requested" in the
    // current workflow, so an open one is by definition the same intent.
    const openReturn = this.returnRecords.find((record) => record.cargoPackageId === cargo.id && record.status === "Requested");
    if (openReturn) return openReturn;
    if (!input.reason?.trim()) throw new BadRequestException("Return reason is required.");
    this.assertNoLocalPhotoReference(input.photoUrl, "Return photo");
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
    idempotencyKey?: string;
  }) {
    return this.runIdempotent("POST /deliveries/complete", input.idempotencyKey, () => this.completeDeliveryOnce(input));
  }

  private completeDeliveryOnce(input: Parameters<LogisticsService["completeDelivery"]>[0]) {
    const cargo = this.findPackage(input.cargoPackageId);
    // B3 transition guard (audit direction): completing an already-Delivered
    // package returns the existing delivery instead of appending a second
    // DeliveryRecord and re-stamping the package. This covers replays whose
    // key differs from the original (e.g. a fresh form after a lost
    // response); same-key replays never reach here (B1). If the package is
    // Delivered but no delivery record exists (legacy data), fall through
    // and create the record so the data heals.
    if (cargo.status === "Delivered") {
      const existing = [...this.deliveries]
        .reverse()
        .find((delivery) => delivery.cargoPackageId === cargo.id && delivery.status === "Delivered");
      if (existing) return existing;
    }
    if (!input.deliveredTo) throw new BadRequestException("Recipient name is required");
    this.assertNoLocalPhotoReference(input.signatureUrl, "Signature");
    this.assertNoLocalPhotoReference(input.deliveryPhotoUrl, "Delivery photo");
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

  failDelivery(input: { cargoPackageId: string; failedReason: string; notes?: string; nextAction: string; idempotencyKey?: string }) {
    return this.runIdempotent("POST /deliveries/fail", input.idempotencyKey, () => this.failDeliveryOnce(input));
  }

  private failDeliveryOnce(input: Parameters<LogisticsService["failDelivery"]>[0]) {
    const cargo = this.findPackage(input.cargoPackageId);
    // B3 transition guards, mirroring completeDelivery: a delivered package
    // is terminal — a late failure report against it is a conflict, not a
    // state change. An already-Failed package returns its existing failure
    // record instead of stacking a duplicate.
    if (cargo.status === "Delivered") {
      throw new BadRequestException("Package is already delivered; a failed-delivery attempt can no longer be recorded for it.");
    }
    if (cargo.status === "Failed Delivery") {
      const existing = [...this.deliveries]
        .reverse()
        .find((delivery) => delivery.cargoPackageId === cargo.id && delivery.status === "Failed Delivery");
      if (existing) return existing;
    }
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
    idempotencyKey?: string;
  }) {
    return this.runIdempotent("POST /payments", input.idempotencyKey, () => this.recordPaymentOnce(input));
  }

  private recordPaymentOnce(input: Parameters<LogisticsService["recordPayment"]>[0]) {
    const cargo = this.findPackage(input.cargoPackageId);
    this.assertNoLocalPhotoReference(input.proofUrl, "Payment proof");
    const amountDue = input.amountDue ?? cargo.price ?? 0;
    // B3 transition guard: once the full amount due has been collected, any
    // further collection against the package is a duplicate (double-tapped
    // Collect, or a queued replay that arrives after the package was paid
    // through another path) and is rejected. A keyed replay of the original
    // collection never reaches here — B1 returns its stored result first.
    // Partial collections below the amount due remain allowed.
    if (amountDue > 0) {
      const alreadyCollected = this.payments
        .filter((payment) => payment.cargoPackageId === cargo.id)
        .reduce((sum, payment) => sum + payment.amountPaid, 0);
      if (alreadyCollected >= amountDue) {
        throw new BadRequestException(
          `Payment for ${cargo.packageNumber} is already fully collected (PHP ${alreadyCollected.toLocaleString()} of PHP ${amountDue.toLocaleString()}). Refusing to record a duplicate collection.`
        );
      }
    }
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

  createExpense(input: { tripId?: string; category: string; amount: number; description?: string; receiptUrl?: string; idempotencyKey?: string }) {
    return this.runIdempotent("POST /expenses", input.idempotencyKey, () => this.createExpenseOnce(input));
  }

  private createExpenseOnce(input: Parameters<LogisticsService["createExpense"]>[0]) {
    this.assertNoLocalPhotoReference(input.receiptUrl, "Receipt");
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

  renderReceivingSlip(packageId: string): RenderedDocument {
    const cargo = this.findPackage(packageId);
    const copy = this.peekPrintCopy(cargo.packageNumber);
    const text = renderReceivingSlip({
      documentNumber: cargo.receivingRecordNumber,
      packageNumber: cargo.packageNumber,
      customerName: cargo.customerName,
      description: cargo.description,
      quantity: cargo.quantity,
      unit: cargo.unit,
      handlingBranchName: cargo.handlingBranchName,
      destination: cargo.destination,
      deliveryType: cargo.deliveryType,
      city: cargo.city,
      province: cargo.province,
      condition: cargo.condition,
      weight: cargo.weight,
      weightUnit: cargo.weightUnit,
      length: cargo.length,
      width: cargo.width,
      height: cargo.height,
      dimensionUnit: cargo.dimensionUnit,
      unitPrice: cargo.unitPrice,
      price: cargo.price,
      qrValue: cargo.qrValue,
      printLine: `${copy.action} ${copy.at}`,
      copyNumber: copy.copyNumber
    });
    return {
      text,
      print: {
        documentType: "Receiving Slip",
        documentNumber: cargo.packageNumber,
        relatedEntityType: "CargoPackage",
        relatedEntityId: cargo.id,
        layout: "80mm"
      }
    };
  }

  renderReceivingDocument(receivingRecordId: string): RenderedDocument {
    const receiving = this.findReceivingRecord(receivingRecordId);
    const copy = this.peekPrintCopy(receiving.recordNumber);
    const text = renderReceivingDocument({
      recordNumber: receiving.recordNumber,
      customerName: receiving.customerName,
      customerDrNumber: receiving.customerDrNumber,
      destination: receiving.destination,
      packages: receiving.packages,
      copyLine: `${copy.copyNumber} / ${new Date(copy.at).toLocaleString("en-PH", { hour12: false })}`
    });
    return {
      text,
      print: {
        documentType: "Receiving Document",
        documentNumber: receiving.recordNumber,
        relatedEntityType: "ReceivingRecord",
        relatedEntityId: receiving.id,
        layout: "80mm"
      }
    };
  }

  renderQrLabel(packageId: string): RenderedDocument {
    const cargo = this.findPackage(packageId);
    const text = renderQrLabel({
      packageNumber: cargo.packageNumber,
      description: cargo.description,
      destination: cargo.destination,
      qrValue: cargo.qrValue
    });
    return {
      text,
      print: {
        documentType: "QR Label",
        documentNumber: cargo.packageNumber,
        relatedEntityType: "CargoPackage",
        relatedEntityId: cargo.id,
        layout: "80mm"
      }
    };
  }

  renderTripManifest(tripId: string): RenderedDocument {
    const trip = this.findTrip(tripId);
    const cargo = trip.cargoPackageIds.map((packageId) => this.findPackage(packageId));
    const copy = this.peekPrintCopy(trip.tripNumber);
    const text = renderLoadingManifest({
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
      auditLine: `${copy.action} ${copy.at} / Copy ${copy.copyNumber}`
    });
    return {
      text,
      print: {
        documentType: "Loading Manifest",
        documentNumber: trip.tripNumber,
        relatedEntityType: "Trip",
        relatedEntityId: trip.id,
        layout: "80mm"
      }
    };
  }

  renderDeliveryReceipt(packageId: string): RenderedDocument {
    const cargo = this.findPackage(packageId);
    const delivery = [...this.deliveries].reverse().find((entry) => entry.cargoPackageId === cargo.id && entry.status === "Delivered");
    if (!delivery) throw new BadRequestException("Package has no completed delivery receipt yet");
    const latestPayment = [...this.payments].reverse().find((entry) => entry.cargoPackageId === cargo.id);
    const text = renderDeliveryReceipt({
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
    return {
      text,
      print: {
        documentType: "Delivery Receipt",
        documentNumber: `DR-${cargo.packageNumber}`,
        relatedEntityType: "CargoPackage",
        relatedEntityId: cargo.id,
        layout: "80mm"
      }
    };
  }

  /**
   * Records a print hand-off reported by the client AFTER it attempted to
   * hand the document to a printer (native gateway intent launched, browser
   * print fallback invoked, or the attempt failed). This is the only writer
   * of PrintLog rows: a row now proves a hand-off was attempted by a named
   * user on a named device, and carries the outcome the client observed.
   * Copy numbering keeps the historical rule — copies are counted per
   * document number and the first recorded hand-off is "Printed", later
   * ones "Reprinted" — but the population counted is hand-offs, not renders.
   */
  recordPrintHandoff(input: PrintHandoffInput, user?: AuthContext) {
    this.assertPrintableEntity(input.relatedEntityType, input.relatedEntityId);
    const existing = this.printLogs.filter((entry) => entry.documentNumber === input.documentNumber);
    const failed = input.outcome === "Failed";
    const log: PrintLog = {
      id: id("prt"),
      documentType: input.documentType,
      documentNumber: input.documentNumber,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      action: existing.length ? "Reprinted" : "Printed",
      reason: failed ? input.error?.trim() || "Print hand-off failed" : undefined,
      outcome: input.outcome,
      printedByName: this.printUserName(user),
      deviceName: input.deviceName?.trim() || undefined,
      layout: input.layout,
      copyNumber: existing.length + 1,
      createdAt: new Date().toISOString()
    };
    this.printLogs.push(log);
    this.audit(
      failed ? "document.printFailed" : log.action === "Printed" ? "document.printed" : "document.reprinted",
      input.relatedEntityType,
      input.relatedEntityId,
      log.reason
    );
    this.saveData();
    return log;
  }

  /**
   * Persists one Device Setup printer diagnostic run. The checks were
   * measured on the client (plugin presence, gateway route, test payload
   * hand-off); the printer result is derived here from those checks, never
   * self-attested. Other hardware results keep their existing manual flow
   * and default to "Not Tested" for a diagnostic-only record.
   */
  recordPrinterDiagnostic(input: PrinterDiagnosticInput) {
    const summary = summarizePrinterDiagnostic(input.checks ?? []);
    return this.createHardwareTest({
      deviceName: input.deviceName,
      scannerResult: input.scannerResult ?? "Not Tested",
      printerResult: summary.printerResult,
      cameraResult: input.cameraResult ?? "Not Tested",
      signatureResult: input.signatureResult ?? "Not Tested",
      pwaResult: input.pwaResult ?? "Not Tested",
      notes: summary.notes
    });
  }

  private assertPrintableEntity(relatedEntityType: string, relatedEntityId: string) {
    const known =
      (relatedEntityType === "CargoPackage" && this.packages.some((entry) => entry.id === relatedEntityId)) ||
      (relatedEntityType === "ReceivingRecord" && this.receivingRecords.some((entry) => entry.id === relatedEntityId)) ||
      (relatedEntityType === "Trip" && this.trips.some((entry) => entry.id === relatedEntityId));
    if (!known) throw new BadRequestException("Print hand-off references an unknown document");
  }

  private printUserName(user?: AuthContext) {
    const found = user?.id ? this.getDemoUsers().find((entry) => entry.id === user.id) : undefined;
    return found?.name ?? user?.role ?? "Unknown User";
  }

  /**
   * The copy line printed ON a rendered document must anticipate the copy
   * this print will be, without writing the log row the old flow wrote at
   * render time: it peeks at the recorded hand-offs for the document number
   * and predicts action + copy number. The authoritative row is written by
   * recordPrintHandoff once the client actually attempts the hand-off.
   */
  private peekPrintCopy(documentNumber: string) {
    const existing = this.printLogs.filter((entry) => entry.documentNumber === documentNumber);
    return {
      action: (existing.length ? "Reprinted" : "Printed") as PrintLog["action"],
      copyNumber: existing.length + 1,
      at: new Date().toISOString()
    };
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

  /**
   * Guardrail for Phase 4 audit A6: a `local-photo://…` value is a photo that
   * is still queued in a device's IndexedDB — it is not a server URL and must
   * never be persisted into a record. Clients submit the bare local photo id
   * as a pending reference instead (see createReceivingIntakeTask's
   * drPhotoLocalId), and the real URL is attached when the queued photo
   * uploads. Rejecting here turns silent data corruption into a clear error.
   */
  private assertNoLocalPhotoReference(value: string | string[] | undefined, field: string) {
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    if (values.some((entry) => entry?.trim().startsWith("local-photo://"))) {
      throw new BadRequestException(
        `${field} points to a photo that is still queued on the device (local-photo://). Queued photos attach automatically once they upload — retry after the device syncs.`
      );
    }
  }

  /** Accepts a bare queued-photo id or a full `local-photo://…` URL and returns the bare id. */
  private normalizeLocalPhotoId(value: string | undefined) {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    return trimmed.startsWith("local-photo://") ? trimmed.slice("local-photo://".length) : trimmed;
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

  private async loadData() {
    const loaded = await this.store.load();
    if (!loaded) {
      // No persisted state yet (for example, the JSON file does not exist):
      // keep the built-in defaults and persist them, as the service did
      // before the store seam was introduced.
      this.saveData();
      return;
    }
    const data: LoadedServiceState = loaded;
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
    // Rows persisted before the hand-off rework predate the outcome column.
    this.printLogs = (data.printLogs ?? []).map((log) => ({ ...log, outcome: log.outcome ?? "HandedOff" }));
    this.customUsers = data.customUsers ?? [];
    // Phase 5 P5-1 migration — staff codes stop being stored in plaintext.
    // Records persisted before P5-1 carry a plaintext `staffCode`; hash it
    // on load and drop the plaintext, then persist the migrated state so
    // the plaintext does not survive on disk/in the database. Chosen over
    // hash-on-first-login because it is deterministic (no account keeps a
    // plaintext code because its owner never signed in) and one-way: the
    // migration runs once per legacy record and is a no-op afterwards.
    let migratedStaffCodes = false;
    for (const customUser of this.customUsers) {
      const legacy = customUser as StaffUserRecord & { staffCode?: string };
      if (legacy.staffCode) {
        if (!customUser.staffCodeHash) customUser.staffCodeHash = hashSecret(legacy.staffCode);
        delete legacy.staffCode;
        migratedStaffCodes = true;
      }
    }
    this.idempotencyRecords = data.idempotencyRecords ?? [];
    this.companyProfile = data.companyProfile ?? this.companyProfile;
    this.branches = data.branches?.length ? data.branches : this.branches;
    this.paymentMethods = data.paymentMethods?.length ? data.paymentMethods : this.paymentMethods;
    this.expenseCategories = data.expenseCategories?.length ? data.expenseCategories : this.expenseCategories;
    this.userBranchAccessOverrides = data.userBranchAccessOverrides ?? {};
    // Persist the staff-code migration only now that every field has been
    // loaded — saveData() snapshots the whole state, so calling it earlier
    // would write not-yet-loaded defaults over the stored state.
    if (migratedStaffCodes) {
      this.audit("auth.staffCodeMigrated", "User", "customUsers", "Plaintext staff codes hashed on load (Phase 5 P5-1)");
      this.saveData();
    }
  }

  private snapshotState(): ServiceState {
    // Key order mirrors the historical JSON file layout so the JSON store's
    // output stays byte-compatible with existing data files.
    return {
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
      idempotencyRecords: this.idempotencyRecords,
      companyProfile: this.companyProfile,
      branches: this.branches,
      paymentMethods: this.paymentMethods,
      expenseCategories: this.expenseCategories,
      userBranchAccessOverrides: this.userBranchAccessOverrides
    };
  }

  /** Retention window for processed idempotency keys: 7 days. */
  private static readonly IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Phase 4 B1 — the generic idempotency seam for the queueable write
   * handlers. When the client supplies a key (the `Idempotency-Key` header,
   * merged into the handler input by the controller), the first successful
   * execution stores its result under (key, endpoint); a repeat submission
   * with the same key returns a copy of that stored result and re-executes
   * nothing. This is what makes the offline queue's replay safe: a request
   * that committed but whose response was lost is retried with the same key
   * (the queue record's id) and cannot apply twice. Only successful
   * executions are recorded, so a request that fails validation can be
   * corrected and retried under the same key. Submissions without a key keep
   * the historical behaviour (the B3 transition guards still protect the
   * delivery/payment state machines for those).
   */
  private runIdempotent<T>(endpoint: string, key: string | undefined, execute: () => T): T {
    const normalizedKey = key?.trim();
    if (!normalizedKey) return execute();
    const existing = this.idempotencyRecords.find((record) => record.key === normalizedKey && record.endpoint === endpoint);
    if (existing) {
      return JSON.parse(JSON.stringify(existing.result)) as T;
    }
    const result = execute();
    const now = Date.now();
    this.idempotencyRecords = this.idempotencyRecords.filter(
      (record) => now - new Date(record.createdAt).getTime() < LogisticsService.IDEMPOTENCY_RETENTION_MS
    );
    this.idempotencyRecords.push({
      id: id("idem"),
      key: normalizedKey,
      endpoint,
      result: JSON.parse(JSON.stringify(result ?? null)) as unknown,
      createdAt: new Date(now).toISOString()
    });
    this.saveData();
    return result;
  }

  private saveData() {
    const state = this.snapshotState();
    void this.store.save(state).catch((error: unknown) => {
      console.error("Failed to persist logistics state", error);
    });
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
