import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
  // Phase 5 P5-4 (CR-007): there is deliberately NO branch-access override
  // map in the state shape anymore. `branchAccess` on each StaffUserRecord
  // is the single source of truth. State persisted before P5-4 may still
  // carry a `userBranchAccessOverrides` field; LogisticsService.loadData
  // folds it into the user records on load and drops it (the field is
  // ignored here — LoadedServiceState is a Partial, so its presence in a
  // stored file neither satisfies nor breaks this type).
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
  /**
   * Persist the full state.
   *
   * Durability contract (Round 1 finding C-B1): a save failure must never
   * be swallowed. An implementation that performs its I/O synchronously
   * (the JSON file store) does the whole write inside this call and throws
   * synchronously on failure, so the calling mutation fails instead of
   * answering success for a record that was never persisted — hence the
   * `void` arm of the return type. A genuinely asynchronous implementation
   * (the Prisma store) returns a promise; LogisticsService tracks that
   * promise, the HTTP boundary awaits it before answering the mutation
   * (FU-1 route (a) — LogisticsService.flushPersistence), and the service
   * fails closed on the next mutation if it rejects.
   *
   * The state passed in is a frozen snapshot — a deep copy taken at the
   * moment of the call, detached from the service's live state. An
   * asynchronous implementation may serialize it whenever its save queue
   * reaches it; later mutations never leak into an earlier save.
   * Implementations must serialize their saves (a save queued behind a
   * failed one must not run), so the durable state is always a prefix of
   * the mutation sequence.
   */
  save(state: ServiceState): Promise<void> | void;
  close?(): Promise<void>;
}

export class JsonStateStore implements StateStore {
  constructor(private readonly filePath: string) {}

  /** The previous durable state, rotated aside on every successful save. */
  private get backupPath(): string {
    return `${this.filePath}.bak`;
  }

  async load(): Promise<LoadedServiceState | undefined> {
    if (!existsSync(this.filePath)) {
      // No main file. A backup without a main file means a save (or the
      // process) died between rotating the backup and landing the new
      // file — that is an interrupted save of an existing dataset, not a
      // fresh install, so recover the backup rather than defaulting.
      if (existsSync(this.backupPath)) return this.loadBackup("the state file is missing");
      return undefined;
    }

    const raw = readFileSync(this.filePath, "utf8");
    if (raw.trim()) {
      try {
        return JSON.parse(raw) as LoadedServiceState;
      } catch {
        // Fall through to the backup recovery below.
      }
    }

    // The state file exists but is empty or unparseable: a torn save (or
    // an external fault) destroyed it. Recover the last good state from
    // the backup and say so loudly. If there is no usable backup, fail
    // loudly — booting factory defaults here would silently discard the
    // entire dataset, which is exactly the C-B1 data loss.
    if (existsSync(this.backupPath)) {
      return this.loadBackup(raw.trim() ? "the state file is not valid JSON" : "the state file is empty");
    }
    throw new Error(
      `Logistics state file ${this.filePath} is ${raw.trim() ? "corrupt (not valid JSON)" : "empty"} and no backup exists at ${this.backupPath}. ` +
        "Refusing to boot with factory defaults over an existing dataset; restore the state file from a backup copy and restart."
    );
  }

  private loadBackup(reason: string): LoadedServiceState {
    const backupRaw = readFileSync(this.backupPath, "utf8");
    try {
      const state = JSON.parse(backupRaw) as LoadedServiceState;
      console.error(
        `[state-store] Recovered logistics state from backup ${this.backupPath} because ${reason} (${this.filePath}). ` +
          "The most recent save may have been lost; the state file is rewritten on the next successful save."
      );
      return state;
    } catch {
      throw new Error(
        `Logistics state file ${this.filePath} is unusable (${reason}) and the backup ${this.backupPath} is not valid JSON either. ` +
          "Refusing to boot with factory defaults over an existing dataset; restore the state file from a backup copy and restart."
      );
    }
  }

  /**
   * Deliberately NOT async: the write below is synchronous, so a failure
   * throws synchronously into the calling mutation (see the StateStore
   * contract). The write itself is atomic — temp file in the same
   * directory, fsync, then rename over the target — and the previous
   * durable file is first rotated to the `.bak` backup that load()
   * recovers from, so a torn or failed save can neither corrupt the last
   * good state nor leave a half-written main file behind.
   */
  save(state: ServiceState): void {
    const contents = JSON.stringify(state, null, 2);
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}`;
    const fd = openSync(tempPath, "w");
    try {
      writeFileSync(fd, contents);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(this.filePath)) {
      copyFileSync(this.filePath, this.backupPath);
    }
    renameSync(tempPath, this.filePath);
    // Best effort: fsync the directory so the rename itself survives a
    // power cut. Some filesystems refuse directory fsync; the rename is
    // still atomic there, just not power-loss durable.
    try {
      const dirFd = openSync(directory, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Directory fsync unsupported — the rename above already landed.
    }
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
