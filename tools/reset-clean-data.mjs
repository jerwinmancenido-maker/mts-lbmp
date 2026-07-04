import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const dataFile = resolve(root, "storage/dev-data/mts-lbmp.json");
const backupFile = resolve(root, `storage/dev-data/mts-lbmp.clean-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const uploadDir = resolve(root, "storage/test-uploads");

const cleanData = {
  sequences: [],
  customers: [],
  receivingRecords: [],
  receivingDrafts: [],
  packages: [],
  productMasters: [],
  trucks: [],
  trips: [],
  deliveries: [],
  payments: [],
  expenses: [],
  returnRecords: [],
  billingInvoices: [],
  notifications: [],
  auditLogs: [],
  descriptionBarcodes: [],
  messages: [],
  hardwareTests: [],
  printLogs: [],
  customUsers: [],
  companyProfile: {
    companyName: "Mancenido Trucking Services",
    address: "Configured by owner",
    phone: "Configured by owner",
    email: "Configured by owner"
  },
  branches: [
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
  ],
  paymentMethods: ["Cash", "GCash", "Bank Transfer", "Check", "Credit Terms", "Advance Payment", "Other"],
  expenseCategories: ["Fuel", "Truck Rental", "Driver Allowance", "Helper Allowance", "Meals", "Parking", "Repairs", "Labor", "Loading Labor", "Unloading Labor", "Toll", "Miscellaneous"],
  userBranchAccessOverrides: {}
};

mkdirSync(dirname(dataFile), { recursive: true });
if (existsSync(dataFile)) {
  copyFileSync(dataFile, backupFile);
}
writeFileSync(dataFile, `${JSON.stringify(cleanData, null, 2)}\n`);

if (existsSync(uploadDir)) {
  for (const entry of readdirSync(uploadDir)) {
    if (entry === ".gitkeep") continue;
    rmSync(join(uploadDir, entry), { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: true, dataFile, backupFile: existsSync(backupFile) ? backupFile : null, uploadsCleared: true }, null, 2));
