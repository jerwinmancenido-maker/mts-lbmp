import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const dataFile = resolve(root, "storage/dev-data/mts-lbmp.json");
const backupFile = resolve(root, `storage/dev-data/mts-lbmp.backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

function iso(day, time) {
  return `2026-07-${String(day).padStart(2, "0")}T${time}+08:00`;
}

function pkg(input) {
  return {
    quantity: 1,
    unit: "pc",
    deliveryType: "Deliver to consignee",
    condition: "Good",
    price: null,
    photoUrls: [],
    ...input,
    qrValue: `MTS:PKG:${input.packageNumber}`
  };
}

const companyProfile = {
  companyName: "Mancenido Trucking Services",
  address: "Owner configurable main office / origin warehouse",
  phone: "Owner configurable",
  email: "Owner configurable"
};

const branches = [
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

const customers = [
  {
    id: "cust_bicol_hardware",
    businessName: "Bicol Hardware Depot",
    status: "Active",
    contactPerson: "Ramon Sy",
    phone: "0917 110 2200",
    billingTerm: "Pay upon delivery"
  },
  {
    id: "cust_daet_mart",
    businessName: "Daet Mart Supply",
    status: "Active",
    contactPerson: "Liza Santos",
    phone: "0917 330 4400",
    billingTerm: "30 days after delivery"
  },
  {
    id: "cust_naga_builders",
    businessName: "Naga Builders Center",
    status: "Active",
    contactPerson: "Marco Reyes",
    phone: "0918 555 0188",
    billingTerm: "50% upfront, balance on delivery"
  },
  {
    id: "cust_jm_appliance",
    businessName: "JM Appliance Trading",
    status: "Active",
    contactPerson: "Ana Mercado",
    phone: "0920 777 1313",
    billingTerm: "Weekly billing"
  },
  {
    id: "cust_pending_alfonso",
    businessName: "Alfonso General Merchandise",
    status: "Pending",
    contactPerson: "For finalization",
    phone: "Not confirmed",
    billingTerm: "Pending",
    notes: "Created during fast receiving. Owner must finalize before loading."
  }
];

const packages = [
  pkg({
    id: "pkg_000001",
    packageNumber: "PKG-2026-07-000001",
    receivingRecordNumber: "RR-2026-07-000001",
    customerId: "cust_bicol_hardware",
    customerName: "Bicol Hardware Depot",
    description: "Angle bar 20ft bundle",
    quantity: 12,
    unit: "length",
    destination: "Daet",
    handlingBranchId: "branch_daet",
    handlingBranchName: "Daet",
    consigneeName: "Daet Hardware Branch",
    addressLine: "Vinzons Ave",
    barangay: "Barangay VI",
    city: "Daet",
    province: "Camarines Norte",
    status: "Waiting for Loading",
    price: 1800,
    createdAt: iso(1, "08:15:00")
  }),
  pkg({
    id: "pkg_000002",
    packageNumber: "PKG-2026-07-000002",
    receivingRecordNumber: "RR-2026-07-000001",
    customerId: "cust_bicol_hardware",
    customerName: "Bicol Hardware Depot",
    description: "Tubular steel 1x2",
    quantity: 8,
    unit: "bundle",
    destination: "Daet",
    handlingBranchId: "branch_daet",
    handlingBranchName: "Daet",
    status: "Waiting for Loading",
    price: 1500,
    createdAt: iso(1, "08:18:00")
  }),
  pkg({
    id: "pkg_000003",
    packageNumber: "PKG-2026-07-000003",
    receivingRecordNumber: "RR-2026-07-000002",
    customerId: "cust_naga_builders",
    customerName: "Naga Builders Center",
    description: "PVC pipe 3 inch",
    quantity: 20,
    unit: "length",
    destination: "Naga",
    handlingBranchId: "branch_naga",
    handlingBranchName: "Naga",
    status: "Waiting for Price",
    price: null,
    createdAt: iso(1, "09:05:00")
  }),
  pkg({
    id: "pkg_000004",
    packageNumber: "PKG-2026-07-000004",
    receivingRecordNumber: "RR-2026-07-000003",
    customerId: "cust_jm_appliance",
    customerName: "JM Appliance Trading",
    description: "Boxed rice cooker assorted",
    quantity: 15,
    unit: "box",
    destination: "Naga",
    handlingBranchId: "branch_naga",
    handlingBranchName: "Naga",
    status: "Loaded",
    price: 3200,
    createdAt: iso(1, "10:30:00")
  }),
  pkg({
    id: "pkg_000005",
    packageNumber: "PKG-2026-07-000005",
    receivingRecordNumber: "RR-2026-07-000003",
    customerId: "cust_jm_appliance",
    customerName: "JM Appliance Trading",
    description: "Electric fan cartons",
    quantity: 10,
    unit: "carton",
    destination: "Naga",
    handlingBranchId: "branch_naga",
    handlingBranchName: "Naga",
    status: "In Transit",
    price: 2500,
    createdAt: iso(1, "10:35:00")
  }),
  pkg({
    id: "pkg_000006",
    packageNumber: "PKG-2026-07-000006",
    receivingRecordNumber: "RR-2026-07-000004",
    customerId: "cust_daet_mart",
    customerName: "Daet Mart Supply",
    description: "Assorted grocery cartons",
    quantity: 25,
    unit: "carton",
    destination: "Daet",
    handlingBranchId: "branch_daet",
    handlingBranchName: "Daet",
    status: "Arrived",
    price: 4200,
    createdAt: iso(1, "11:10:00")
  }),
  pkg({
    id: "pkg_000007",
    packageNumber: "PKG-2026-07-000007",
    receivingRecordNumber: "RR-2026-07-000004",
    customerId: "cust_daet_mart",
    customerName: "Daet Mart Supply",
    description: "Beverage crates",
    quantity: 18,
    unit: "crate",
    destination: "Daet",
    handlingBranchId: "branch_daet",
    handlingBranchName: "Daet",
    status: "Ready for Delivery",
    price: 3000,
    createdAt: iso(1, "11:16:00")
  }),
  pkg({
    id: "pkg_000008",
    packageNumber: "PKG-2026-07-000008",
    receivingRecordNumber: "RR-2026-07-000005",
    customerId: "cust_naga_builders",
    customerName: "Naga Builders Center",
    description: "Ceramic tiles",
    quantity: 30,
    unit: "box",
    destination: "Naga",
    handlingBranchId: "branch_naga",
    handlingBranchName: "Naga",
    status: "Delivered",
    price: 5200,
    createdAt: iso(1, "13:00:00")
  }),
  pkg({
    id: "pkg_000009",
    packageNumber: "PKG-2026-07-000009",
    receivingRecordNumber: "RR-2026-07-000006",
    customerId: "cust_bicol_hardware",
    customerName: "Bicol Hardware Depot",
    description: "Paint pail 16L",
    quantity: 6,
    unit: "pail",
    destination: "Daet",
    handlingBranchId: "branch_daet",
    handlingBranchName: "Daet",
    status: "Failed Delivery",
    price: 900,
    createdAt: iso(1, "14:20:00")
  }),
  pkg({
    id: "pkg_000010",
    packageNumber: "PKG-2026-07-000010",
    receivingRecordNumber: "RR-2026-07-000007",
    customerId: "cust_pending_alfonso",
    customerName: "Alfonso General Merchandise",
    description: "Unknown sacks for checking",
    quantity: 7,
    unit: "sack",
    destination: "Naga",
    handlingBranchId: "branch_naga",
    handlingBranchName: "Naga",
    condition: "For Checking",
    conditionNotes: "Pending customer and item confirmation.",
    status: "Received",
    price: null,
    createdAt: iso(1, "15:05:00")
  }),
  pkg({
    id: "pkg_000011",
    packageNumber: "PKG-2026-07-000011",
    receivingRecordNumber: "RR-2026-07-000008",
    customerId: "cust_jm_appliance",
    customerName: "JM Appliance Trading",
    description: "Microwave oven box",
    quantity: 4,
    unit: "box",
    destination: "Legazpi via Naga",
    handlingBranchId: "branch_naga",
    handlingBranchName: "Naga",
    condition: "Damaged",
    conditionNotes: "One box dented at receiving. Customer notified.",
    status: "Exception",
    price: 1700,
    createdAt: iso(1, "15:45:00")
  }),
  pkg({
    id: "pkg_000012",
    packageNumber: "PKG-2026-07-000012",
    receivingRecordNumber: "RR-2026-07-000009",
    customerId: "cust_daet_mart",
    customerName: "Daet Mart Supply",
    description: "Return cargo - empty crates",
    quantity: 12,
    unit: "crate",
    destination: "Origin Warehouse",
    handlingBranchId: "branch_daet",
    handlingBranchName: "Daet",
    deliveryType: "Return cargo",
    status: "Received",
    price: 600,
    createdAt: iso(1, "16:15:00")
  })
];

const receivingGroups = [
  ["rec_000001", "RR-2026-07-000001", "cust_bicol_hardware", "Bicol Hardware Depot", "BDR-7781", "Daet", ["pkg_000001", "pkg_000002"], iso(1, "08:20:00")],
  ["rec_000002", "RR-2026-07-000002", "cust_naga_builders", "Naga Builders Center", "NBR-2210", "Naga", ["pkg_000003"], iso(1, "09:08:00")],
  ["rec_000003", "RR-2026-07-000003", "cust_jm_appliance", "JM Appliance Trading", "JMAT-9912", "Naga", ["pkg_000004", "pkg_000005"], iso(1, "10:40:00")],
  ["rec_000004", "RR-2026-07-000004", "cust_daet_mart", "Daet Mart Supply", "DMS-1204", "Daet", ["pkg_000006", "pkg_000007"], iso(1, "11:25:00")],
  ["rec_000005", "RR-2026-07-000005", "cust_naga_builders", "Naga Builders Center", "NBR-2211", "Naga", ["pkg_000008"], iso(1, "13:10:00")],
  ["rec_000006", "RR-2026-07-000006", "cust_bicol_hardware", "Bicol Hardware Depot", "BDR-7782", "Daet", ["pkg_000009"], iso(1, "14:25:00")],
  ["rec_000007", "RR-2026-07-000007", "cust_pending_alfonso", "Alfonso General Merchandise", "TEMP-001", "Naga", ["pkg_000010"], iso(1, "15:10:00")],
  ["rec_000008", "RR-2026-07-000008", "cust_jm_appliance", "JM Appliance Trading", "JMAT-9913", "Legazpi via Naga", ["pkg_000011"], iso(1, "15:50:00")],
  ["rec_000009", "RR-2026-07-000009", "cust_daet_mart", "Daet Mart Supply", "DMS-RET-12", "Origin Warehouse", ["pkg_000012"], iso(1, "16:20:00")]
];

const receivingRecords = receivingGroups.map(([id, recordNumber, customerId, customerName, customerDrNumber, destination, packageIds, createdAt]) => ({
  id,
  recordNumber,
  customerId,
  customerName,
  customerDrNumber,
  sender: customerName,
  consignee: destination,
  destination,
  packages: packageIds.map((packageId) => packages.find((entry) => entry.id === packageId)),
  createdAt
}));

const receivingDrafts = [
  {
    id: "draft_000001",
    draftNumber: "DRAFT-2026-07-000001",
    status: "Draft",
    customerId: "cust_bicol_hardware",
    customerNameSnapshot: "Bicol Hardware Depot",
    customerStatusSnapshot: "Active",
    customerDrNumber: "BDR-DRAFT-01",
    destination: "Daet",
    drPhotoUrl: "seed/dr/bdr-draft-01.jpg",
    formState: { customerName: "Bicol Hardware Depot", customerDrNumber: "BDR-DRAFT-01" },
    productLines: [
      { description: "GI wire roll", quantity: "5", unit: "roll", price: "850", handlingBranchName: "Daet" }
    ],
    createdBy: "Receiving Demo",
    updatedBy: "Receiving Demo",
    createdAt: iso(1, "16:40:00"),
    updatedAt: iso(1, "16:44:00")
  },
  {
    id: "draft_000002",
    draftNumber: "DRAFT-2026-07-000002",
    status: "Draft",
    customerNameSnapshot: "No customer yet",
    customerStatusSnapshot: "Pending",
    destination: "Naga",
    formState: { pendingCustomerName: "Walk-in hardware client" },
    productLines: [],
    createdBy: "Receiving Demo",
    updatedBy: "Receiving Demo",
    createdAt: iso(1, "17:10:00"),
    updatedAt: iso(1, "17:12:00")
  }
];

const trips = [
  {
    id: "trip_000001",
    tripNumber: "TR-2026-07-000001",
    origin: "Origin Warehouse",
    destination: "Daet",
    status: "Loading",
    isMixedTrip: false,
    vehicleDescription: "Company Truck - MTS 001",
    driverName: "Jun Driver",
    cargoPackageIds: ["pkg_000001", "pkg_000002"],
    createdAt: iso(1, "12:00:00")
  },
  {
    id: "trip_000002",
    tripNumber: "TR-2026-07-000002",
    origin: "Origin Warehouse",
    destination: "Naga",
    status: "Departed",
    isMixedTrip: false,
    vehicleDescription: "Rental Truck - Isuzu Forward",
    driverName: "Rolly Rental",
    cargoPackageIds: ["pkg_000004", "pkg_000005"],
    createdAt: iso(1, "12:45:00")
  },
  {
    id: "trip_000003",
    tripNumber: "TR-2026-07-000003",
    origin: "Origin Warehouse",
    destination: "Daet / Naga",
    status: "Arrived",
    isMixedTrip: true,
    vehicleDescription: "Partner Truck - Bicol Hauler",
    driverName: "Mario Partner",
    cargoPackageIds: ["pkg_000006", "pkg_000007", "pkg_000008"],
    createdAt: iso(1, "13:30:00")
  },
  {
    id: "trip_000004",
    tripNumber: "TR-2026-07-000004",
    origin: "Daet",
    destination: "Origin Warehouse",
    status: "Planned",
    isMixedTrip: false,
    vehicleDescription: "Return Load",
    driverName: "TBD",
    cargoPackageIds: ["pkg_000012"],
    createdAt: iso(1, "16:30:00")
  }
];

const deliveries = [
  {
    id: "del_000001",
    cargoPackageId: "pkg_000008",
    status: "Delivered",
    deliveredTo: "Naga Builders Receiving",
    signatureUrl: "seed/signatures/naga-builders.png",
    deliveryPhotoUrl: "seed/photos/pkg-000008-delivered.jpg",
    notes: "Accepted in good condition.",
    createdAt: iso(1, "14:05:00")
  },
  {
    id: "del_000002",
    cargoPackageId: "pkg_000009",
    status: "Failed Delivery",
    failedReason: "Customer Not Available",
    notes: "Receiver closed at arrival. Reschedule tomorrow.",
    nextAction: "Reschedule Required",
    deliveryPhotoUrl: "seed/photos/pkg-000009-failed.jpg",
    createdAt: iso(1, "15:00:00")
  }
];

const payments = [
  {
    id: "pay_000001",
    cargoPackageId: "pkg_000001",
    amountDue: 1800,
    amountPaid: 1800,
    balance: 0,
    method: "Cash",
    collectionPoint: "Receiving",
    collectedByUserId: "user_receiving",
    collectedByName: "Receiving Demo",
    collectedByRole: "Receiving Staff",
    branchId: "branch_origin",
    branchName: "Origin Warehouse",
    status: "Paid",
    proofUrl: "seed/payments/pay-000001.jpg",
    notes: "Paid upfront at receiving.",
    createdAt: iso(1, "08:30:00")
  },
  {
    id: "pay_000002",
    cargoPackageId: "pkg_000004",
    amountDue: 3200,
    amountPaid: 1600,
    balance: 1600,
    method: "GCash",
    collectionPoint: "Receiving",
    collectedByUserId: "user_receiving",
    collectedByName: "Receiving Demo",
    collectedByRole: "Receiving Staff",
    branchId: "branch_origin",
    branchName: "Origin Warehouse",
    status: "Partially Paid",
    proofUrl: "seed/payments/pay-000002.jpg",
    notes: "50% upfront.",
    createdAt: iso(1, "10:50:00")
  },
  {
    id: "pay_000003",
    cargoPackageId: "pkg_000008",
    amountDue: 5200,
    amountPaid: 5200,
    balance: 0,
    method: "Cash",
    collectionPoint: "Delivery",
    collectedByUserId: "user_delivery",
    collectedByName: "Delivery Demo",
    collectedByRole: "Delivery Staff",
    branchId: "branch_naga",
    branchName: "Naga",
    status: "Paid",
    proofUrl: "seed/payments/pay-000003.jpg",
    notes: "Collected on delivery.",
    createdAt: iso(1, "14:10:00")
  },
  {
    id: "pay_000004",
    cargoPackageId: "pkg_000006",
    amountDue: 4200,
    amountPaid: 1000,
    balance: 3200,
    method: "Bank Transfer",
    collectionPoint: "Owner",
    collectedByUserId: "user_owner",
    collectedByName: "Owner Demo",
    collectedByRole: "Administrator",
    branchId: "branch_daet",
    branchName: "Daet",
    status: "Partially Paid",
    proofUrl: "seed/payments/pay-000004.jpg",
    notes: "Owner-recorded partial payment.",
    createdAt: iso(1, "15:30:00")
  }
];

const expenses = [
  {
    id: "exp_000001",
    tripId: "trip_000001",
    category: "Fuel",
    amount: 2500,
    description: "Fuel for Daet loading trip. Receipt: seed/expenses/fuel-daet.jpg",
    status: "Submitted",
    createdAt: iso(1, "12:20:00")
  },
  {
    id: "exp_000002",
    tripId: "trip_000002",
    category: "Truck Rental",
    amount: 9000,
    description: "Rental truck for Naga route. Receipt: seed/expenses/rental-naga.jpg",
    status: "Submitted",
    createdAt: iso(1, "12:50:00")
  },
  {
    id: "exp_000003",
    tripId: "trip_000003",
    category: "Helper Allowance",
    amount: 1200,
    description: "Unload helpers at Daet/Naga mixed trip.",
    status: "Approved",
    createdAt: iso(1, "14:00:00")
  },
  {
    id: "exp_000004",
    category: "Repairs",
    amount: 750,
    description: "Tire patch before departure.",
    status: "Rejected",
    createdAt: iso(1, "15:20:00")
  }
];

const notifications = [
  { id: "ntf_000001", title: "Price needed", message: "PKG-2026-07-000003 has no price before loading.", priority: "High", createdAt: iso(1, "09:10:00") },
  { id: "ntf_000002", title: "Mixed trip approval", message: "TR-2026-07-000003 contains Daet and Naga cargo.", priority: "High", createdAt: iso(1, "13:35:00") },
  { id: "ntf_000003", title: "Expense submitted", message: "Fuel expense for TR-2026-07-000001 needs owner review.", priority: "Medium", createdAt: iso(1, "12:21:00") },
  { id: "ntf_000004", title: "Failed delivery", message: "PKG-2026-07-000009 failed: Customer Not Available.", priority: "High", createdAt: iso(1, "15:02:00") },
  { id: "ntf_000005", title: "Damaged package", message: "PKG-2026-07-000011 requires owner/customer visibility decision.", priority: "High", createdAt: iso(1, "15:50:00") }
];

const auditLogs = [
  { id: "aud_000001", action: "seed.created", entityType: "System", entityId: "demo-data", reason: "Demo data reset", createdAt: iso(1, "07:59:00") },
  { id: "aud_000002", action: "receiving.created", entityType: "ReceivingRecord", entityId: "RR-2026-07-000001", createdAt: iso(1, "08:20:00") },
  { id: "aud_000003", action: "payments.record", entityType: "Payment", entityId: "pay_000001", createdAt: iso(1, "08:30:00") },
  { id: "aud_000004", action: "trip.created", entityType: "Trip", entityId: "TR-2026-07-000001", createdAt: iso(1, "12:00:00") },
  { id: "aud_000005", action: "delivery.fail", entityType: "DeliveryRecord", entityId: "del_000002", reason: "Customer Not Available", createdAt: iso(1, "15:00:00") },
  { id: "aud_000006", action: "expense.submitted", entityType: "Expense", entityId: "exp_000002", createdAt: iso(1, "12:50:00") }
];

const descriptionBarcodes = [
  { id: "barcode_000001", customerId: "cust_bicol_hardware", barcode: "480000000001", description: "Angle bar 20ft bundle" },
  { id: "barcode_000002", customerId: "cust_bicol_hardware", barcode: "480000000002", description: "Tubular steel 1x2" },
  { id: "barcode_000003", customerId: "cust_naga_builders", barcode: "480000000003", description: "PVC pipe 3 inch" },
  { id: "barcode_000004", customerId: "cust_jm_appliance", barcode: "480000000004", description: "Boxed rice cooker assorted" }
];

const messages = [
  { id: "msg_000001", cargoPackageId: "pkg_000009", senderName: "Delivery Demo", body: "Customer unavailable. Need reschedule confirmation.", createdAt: iso(1, "15:03:00") },
  { id: "msg_000002", cargoPackageId: "pkg_000011", senderName: "Receiving Demo", body: "Box dented at intake. Photo attached in package record.", createdAt: iso(1, "15:52:00") }
];

const hardwareTests = [
  {
    id: "hw_000001",
    deviceName: "NB80 Android POS - Receiving 1",
    scannerResult: "Pass",
    printerResult: "Pass",
    cameraResult: "Pass",
    signatureResult: "Pass",
    pwaResult: "Pass",
    notes: "80mm print preview and QR scan validated in demo seed.",
    createdAt: iso(1, "07:50:00")
  }
];

const printLogs = [
  { id: "prt_000001", documentType: "Receiving Document", documentNumber: "RR-2026-07-000001", relatedEntityType: "ReceivingRecord", relatedEntityId: "rec_000001", action: "Printed", printedByName: "Receiving Demo", layout: "80mm", copyNumber: 1, createdAt: iso(1, "08:21:00") },
  { id: "prt_000002", documentType: "Delivery Receipt", documentNumber: "DR-PREVIEW-PKG-2026-07-000008", relatedEntityType: "CargoPackage", relatedEntityId: "pkg_000008", action: "Printed", printedByName: "Delivery Demo", layout: "80mm", copyNumber: 1, createdAt: iso(1, "14:12:00") },
  { id: "prt_000003", documentType: "Receiving Document", documentNumber: "RR-2026-07-000001", relatedEntityType: "ReceivingRecord", relatedEntityId: "rec_000001", action: "Reprinted", reason: "Customer requested copy", printedByName: "Receiving Demo", layout: "80mm", copyNumber: 2, createdAt: iso(1, "08:25:00") }
];

const paymentMethods = ["Cash", "GCash", "Bank Transfer", "Check", "Online Transfer", "COD", "Partial Payment"];
const expenseCategories = ["Fuel", "Truck Rental", "Driver Allowance", "Helper Allowance", "Meals", "Parking", "Repairs", "Labor", "Loading Labor", "Unloading Labor", "Toll", "Miscellaneous"];

const data = {
  sequences: [
    ["RR", 9],
    ["PKG", 12],
    ["TR", 4],
    ["DRAFT", 2],
    ["BS", 0],
    ["DR", 0]
  ],
  customers,
  receivingRecords,
  receivingDrafts,
  packages,
  trips,
  deliveries,
  payments,
  expenses,
  notifications,
  auditLogs,
  descriptionBarcodes,
  messages,
  hardwareTests,
  printLogs,
  companyProfile,
  branches,
  paymentMethods,
  expenseCategories
};

mkdirSync(dirname(dataFile), { recursive: true });
if (existsSync(dataFile)) {
  copyFileSync(dataFile, backupFile);
  console.log(`Backed up current data to ${backupFile}`);
}
writeFileSync(dataFile, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Seeded ${packages.length} packages, ${trips.length} trips, ${payments.length} payments, ${expenses.length} expenses.`);
