import { rowsToState, stateToRows, type PrismaStateRows } from "./prisma-state-mapping.js";
import type { LoadedServiceState, ServiceState, StateStore } from "./state-store.js";

/**
 * Structural subset of the generated PrismaClient used by PrismaStateStore.
 *
 * The generated client is not committed and `prisma generate` cannot run in
 * every environment (notably this offline sandbox), so this module never
 * imports @prisma/client types. The real client is loaded dynamically, only
 * when MTS_REPOSITORY=prisma, and is cast to this shape.
 */
export interface PrismaDelegate {
  findMany(args?: Record<string, unknown>): Promise<unknown[]>;
  createMany(args: { data: unknown[] }): Promise<unknown>;
  deleteMany(args?: Record<string, unknown>): Promise<unknown>;
}

export interface PrismaStateClient {
  branch: PrismaDelegate;
  companySettings: PrismaDelegate;
  documentSequence: PrismaDelegate;
  role: PrismaDelegate;
  user: PrismaDelegate;
  customer: PrismaDelegate;
  customerContact: PrismaDelegate;
  productMaster: PrismaDelegate;
  itemDescription: PrismaDelegate;
  pricingHistory: PrismaDelegate;
  truckRecord: PrismaDelegate;
  receivingRecord: PrismaDelegate;
  cargoPackage: PrismaDelegate;
  photo: PrismaDelegate;
  trip: PrismaDelegate;
  tripCargo: PrismaDelegate;
  deliveryRecord: PrismaDelegate;
  returnRecord: PrismaDelegate;
  payment: PrismaDelegate;
  expense: PrismaDelegate;
  billingInvoice: PrismaDelegate;
  billingInvoicePackage: PrismaDelegate;
  receivingDraft: PrismaDelegate;
  receivingIntakeTask: PrismaDelegate;
  hardwareTestRecord: PrismaDelegate;
  printLog: PrismaDelegate;
  operationChatThread: PrismaDelegate;
  operationChatMessage: PrismaDelegate;
  notification: PrismaDelegate;
  messageThread: PrismaDelegate;
  message: PrismaDelegate;
  auditLog: PrismaDelegate;
  rolePermission: PrismaDelegate;
  $transaction<T>(fn: (tx: PrismaStateClient) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
}

export type PrismaClientFactory = () => Promise<PrismaStateClient>;

export const createGeneratedPrismaClient: PrismaClientFactory = async () => {
  // The generated client is produced by `prisma generate` during environment
  // setup (Phase 2 step 3). This import is intentionally dynamic and ignored
  // by TypeScript so the JSON path — and typechecking without a generated
  // client — never depends on it.
  // @ts-ignore: @prisma/client is generated at deploy/setup time.
  const prismaModule = (await import("@prisma/client")) as { PrismaClient: new () => PrismaStateClient };
  return new prismaModule.PrismaClient();
};

// Deletes run child/dependent tables first so a full-state replace never
// trips a foreign key. Tables that exist only to hold data outside
// ServiceState (pricing history, role permissions) are cleared because their
// parents (item descriptions, roles) are replaced.
const DELETE_ORDER: Array<keyof PrismaStateRows | "pricingHistory" | "rolePermission"> = [
  "operationChatMessages",
  "messages",
  "billingInvoicePackages",
  "tripCargo",
  "photos",
  "pricingHistory",
  "rolePermission",
  "auditLogs",
  "notifications",
  "messageThreads",
  "operationChatThreads",
  "printLogs",
  "hardwareTests",
  "returnRecords",
  "deliveries",
  "payments",
  "expenses",
  "billingInvoices",
  "receivingIntakeTasks",
  "receivingDrafts",
  "cargoPackages",
  "receivingRecords",
  "itemDescriptions",
  "customerContacts",
  "trips",
  "trucks",
  "users",
  "roles",
  "productMasters",
  "customers",
  "branches",
  "companySettings",
  "documentSequences"
];

// Creates run parent tables before anything that references them. Roles sit
// in DELETE_ORDER after users and role permissions, so replacing them is
// safe; they are re-derived from the custom users' role names on each save.
const CREATE_ORDER: Array<keyof PrismaStateRows> = [
  "branches",
  "companySettings",
  "documentSequences",
  "roles",
  "customers",
  "customerContacts",
  "productMasters",
  "itemDescriptions",
  "trucks",
  "users",
  "receivingRecords",
  "cargoPackages",
  "photos",
  "receivingDrafts",
  "receivingIntakeTasks",
  "trips",
  "tripCargo",
  "deliveries",
  "returnRecords",
  "payments",
  "expenses",
  "billingInvoices",
  "billingInvoicePackages",
  "hardwareTests",
  "printLogs",
  "operationChatThreads",
  "operationChatMessages",
  "messageThreads",
  "messages",
  "notifications",
  "auditLogs"
];

const DELEGATE_BY_ROW_KEY: Record<string, keyof PrismaStateClient> = {
  branches: "branch",
  companySettings: "companySettings",
  documentSequences: "documentSequence",
  roles: "role",
  users: "user",
  customers: "customer",
  customerContacts: "customerContact",
  productMasters: "productMaster",
  itemDescriptions: "itemDescription",
  pricingHistory: "pricingHistory",
  rolePermission: "rolePermission",
  trucks: "truckRecord",
  receivingRecords: "receivingRecord",
  cargoPackages: "cargoPackage",
  photos: "photo",
  trips: "trip",
  tripCargo: "tripCargo",
  deliveries: "deliveryRecord",
  returnRecords: "returnRecord",
  payments: "payment",
  expenses: "expense",
  billingInvoices: "billingInvoice",
  billingInvoicePackages: "billingInvoicePackage",
  receivingDrafts: "receivingDraft",
  receivingIntakeTasks: "receivingIntakeTask",
  hardwareTests: "hardwareTestRecord",
  printLogs: "printLog",
  operationChatThreads: "operationChatThread",
  operationChatMessages: "operationChatMessage",
  notifications: "notification",
  messageThreads: "messageThread",
  messages: "message",
  auditLogs: "auditLog"
};

export class PrismaStateStore implements StateStore {
  private clientPromise?: Promise<PrismaStateClient>;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly clientFactory: PrismaClientFactory = createGeneratedPrismaClient) {}

  private client(): Promise<PrismaStateClient> {
    this.clientPromise ??= this.clientFactory();
    return this.clientPromise;
  }

  async load(): Promise<LoadedServiceState | undefined> {
    const client = await this.client();
    const rows = {} as Record<string, unknown[]>;
    for (const key of CREATE_ORDER) {
      const delegateName = DELEGATE_BY_ROW_KEY[key];
      if (!delegateName) continue;
      const delegate = client[delegateName] as PrismaDelegate;
      rows[key] = await delegate.findMany();
    }
    return rowsToState(rows as unknown as PrismaStateRows);
  }

  async save(state: ServiceState): Promise<void> {
    // Serialize saves so overlapping service writes cannot interleave two
    // replace transactions.
    this.saveQueue = this.saveQueue.then(() => this.saveNow(state));
    return this.saveQueue;
  }

  private async saveNow(state: ServiceState): Promise<void> {
    const client = await this.client();
    const rows = stateToRows(state);

    await client.$transaction(async (tx) => {
      for (const key of DELETE_ORDER) {
        const delegateName = DELEGATE_BY_ROW_KEY[key];
        if (!delegateName) continue;
        const delegate = tx[delegateName] as PrismaDelegate;
        await delegate.deleteMany({});
      }

      for (const key of CREATE_ORDER) {
        const delegateName = DELEGATE_BY_ROW_KEY[key];
        if (!delegateName) continue;
        const data = rows[key] as unknown[];
        if (!data.length) continue;
        const delegate = tx[delegateName] as PrismaDelegate;
        await delegate.createMany({ data });
      }
    });
  }

  async close(): Promise<void> {
    if (!this.clientPromise) return;
    const client = await this.clientPromise;
    await client.$disconnect();
    this.clientPromise = undefined;
  }
}
