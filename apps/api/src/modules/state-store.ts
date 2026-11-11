import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PrismaStateStore } from "./prisma-state-store.js";
import type {
  BillingInvoice,
  Branch,
  CargoPackage,
  CompanyProfile,
  Customer,
  DeliveryRecord,
  DescriptionBarcode,
  ExpenseRecord,
  HardwareTestRecord,
  IdempotencyRecord,
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

/**
 * The complete in-memory shape owned by LogisticsService.
 *
 * `sequences` intentionally uses the JSON file's serialized form
 * (an array of key/value entries) rather than the service's Map, so the JSON
 * store remains byte-compatible with the data file used before this layer was
 * introduced.
 */
export interface ServiceState {
  sequences: Array<[string, number]>;
  customers: Customer[];
  receivingRecords: ReceivingRecord[];
  receivingDrafts: ReceivingDraft[];
  receivingIntakeTasks: ReceivingIntakeTask[];
  packages: CargoPackage[];
  productMasters: ProductMaster[];
  trucks: TruckRecord[];
  trips: Trip[];
  deliveries: DeliveryRecord[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  returnRecords: ReturnRecord[];
  billingInvoices: BillingInvoice[];
  notifications: ServiceNotification[];
  auditLogs: ServiceAuditLog[];
  descriptionBarcodes: DescriptionBarcode[];
  messages: PackageMessage[];
  operationChatThreads: OperationChatThread[];
  hardwareTests: HardwareTestRecord[];
  printLogs: PrintLog[];
  customUsers: StaffUserRecord[];
  idempotencyRecords: IdempotencyRecord[];
  companyProfile: CompanyProfile;
  branches: Branch[];
  paymentMethods: string[];
  expenseCategories: string[];
  userBranchAccessOverrides: Record<string, string>;
}

/**
 * A store may return a partial state for backwards compatibility with older
 * JSON files and with a database that has not been seeded with every setting.
 * LogisticsService retains its existing defaulting/normalization behaviour
 * when applying this value.
 */
export type LoadedServiceState = Partial<ServiceState>;

export interface StateStore {
  load(): Promise<LoadedServiceState | undefined>;
  save(state: ServiceState): Promise<void>;
  close?(): Promise<void>;
}

export class JsonStateStore implements StateStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<LoadedServiceState | undefined> {
    if (!existsSync(this.filePath)) return undefined;

    const raw = readFileSync(this.filePath, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw) as LoadedServiceState;
  }

  async save(state: ServiceState): Promise<void> {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }
}

export type RepositoryKind = "json" | "prisma";

export function repositoryKindFromEnv(env: NodeJS.ProcessEnv = process.env): RepositoryKind {
  const requested = env.MTS_REPOSITORY?.trim().toLowerCase();
  if (!requested || requested === "json") return "json";
  if (requested === "prisma") return "prisma";
  throw new Error(`Unsupported MTS_REPOSITORY value "${env.MTS_REPOSITORY}". Expected "json" or "prisma".`);
}

export function createStateStore(filePath: string, env: NodeJS.ProcessEnv = process.env): StateStore {
  return repositoryKindFromEnv(env) === "prisma" ? new PrismaStateStore() : new JsonStateStore(filePath);
}
