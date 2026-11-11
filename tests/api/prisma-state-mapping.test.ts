import { describe, expect, test } from "vitest";
import { rowsToState, stateToRows } from "../../apps/api/src/modules/prisma-state-mapping";
import type { ServiceState } from "../../apps/api/src/modules/state-store";
import type {
  BillingInvoice,
  CargoPackage,
  ReceivingDraft,
  ReceivingRecord,
  Trip
} from "../../apps/api/src/modules/logistics.types";

const cargo: CargoPackage = {
  id: "pkg_1",
  packageNumber: "PKG-2026-11-000001",
  receivingRecordNumber: "RR-2026-11-000001",
  customerId: "cust_1",
  customerName: "Fixture Customer",
  productId: "prod_1",
  productBarcode: "MTS-PROD-ANGLE-BAR",
  description: "Angle bar",
  quantity: 2,
  unit: "bundle",
  destination: "Daet",
  handlingBranchId: "daet",
  handlingBranchName: "Daet",
  deliveryType: "Deliver to consignee",
  consigneeName: "Fixture Receiver",
  addressLine: "Fixture Street",
  barangay: "Centro",
  city: "Daet",
  province: "Camarines Norte",
  condition: "Good",
  status: "Waiting for Loading",
  unitPrice: 1800,
  price: 3600,
  weight: 24.5,
  weightUnit: "kg",
  length: 120,
  width: 20,
  height: 15,
  dimensionUnit: "cm",
  qrValue: "MTS:PKG:PKG-2026-11-000001",
  photoUrls: ["/uploads/pkg-1-a.jpg", "/uploads/pkg-1-b.jpg"],
  createdAt: "2026-11-11T00:00:00.000Z"
};

const receiving: ReceivingRecord = {
  id: "rr_1",
  recordNumber: "RR-2026-11-000001",
  customerId: "cust_1",
  customerName: "Fixture Customer",
  customerDrNumber: "DR-FIXTURE-1",
  sender: "Fixture Sender",
  consignee: "Fixture Receiver",
  destination: "Daet",
  drPhotoUrl: "/uploads/dr-1.jpg",
  drPhotoAttachedAt: "2026-11-11T00:05:00.000Z",
  drPhotoAttachReason: "Attached during receiving review",
  packages: [cargo],
  createdAt: "2026-11-11T00:00:00.000Z"
};

const trip: Trip = {
  id: "trip_1",
  tripNumber: "TR-2026-11-000001",
  origin: "Origin Warehouse",
  destination: "Daet",
  status: "Loading",
  isMixedTrip: false,
  truckId: "truck_1",
  plateNumber: "MTS-001",
  vehicleDescription: "Company truck",
  driverName: "Fixture Driver",
  driverContactNumber: "0917 000 0000",
  truckOwnerName: "Mancenido Trucking Services",
  mixedTripApprovalStatus: "Not Required",
  cargoPackageIds: ["pkg_1"],
  createdAt: "2026-11-11T01:00:00.000Z"
};

const invoice: BillingInvoice = {
  id: "inv_1",
  invoiceNumber: "INV-2026-11-000001",
  customerId: "cust_1",
  customerName: "Fixture Customer",
  packageIds: ["pkg_1"],
  amountDue: 3600,
  amountPaid: 500,
  balance: 3100,
  dueRule: "Pay upon delivery",
  status: "Issued",
  createdAt: "2026-11-11T02:00:00.000Z"
};

const draft: ReceivingDraft = {
  id: "draft_1",
  draftNumber: "DRF-2026-11-000001",
  status: "Draft",
  customerId: "cust_1",
  customerNameSnapshot: "Fixture Customer",
  customerStatusSnapshot: "Active",
  customerDrNumber: "DR-FIXTURE-1",
  destination: "Daet",
  drPhotoUrl: "/uploads/dr-1.jpg",
  formState: {
    customerDrNumber: "DR-FIXTURE-1",
    sender: { name: "Fixture Sender", tags: ["walk-in", "regular"] },
    totals: { packages: 1, amount: 3600 }
  },
  productLines: [
    { description: "Angle bar", quantity: 2, unit: "bundle", price: 3600 },
    { description: "Plywood", quantity: 1, unit: "pcs", price: null }
  ],
  createdBy: "user_1",
  updatedBy: "user_1",
  createdAt: "2026-11-11T03:00:00.000Z",
  updatedAt: "2026-11-11T03:30:00.000Z"
};

function fixtureState(): ServiceState {
  return {
    sequences: [["receiving", 7]],
    customers: [
      {
        id: "cust_1",
        businessName: "Fixture Customer",
        status: "Active",
        contactPerson: "Fixture Contact",
        phone: "0917 000 0000",
        contacts: [
          {
            id: "ctc_1",
            name: "Fixture Contact",
            role: "Primary Contact",
            phone: "0917 000 0000",
            isPrimary: true,
            status: "Active",
            createdAt: "2026-11-11T00:00:00.000Z"
          }
        ],
        billingTerm: "Pay upon delivery"
      }
    ],
    receivingRecords: [receiving],
    receivingDrafts: [draft],
    receivingIntakeTasks: [],
    packages: [cargo],
    productMasters: [
      {
        id: "prod_1",
        name: "Angle bar",
        barcode: "MTS-PROD-ANGLE-BAR",
        defaultUnit: "bundle",
        defaultPrice: 1800,
        status: "Active",
        createdAt: "2026-11-11T00:00:00.000Z"
      }
    ],
    trucks: [
      {
        id: "truck_1",
        plateNumber: "MTS-001",
        driverName: "Fixture Driver",
        status: "Active",
        createdAt: "2026-11-11T00:00:00.000Z"
      }
    ],
    trips: [trip],
    deliveries: [],
    payments: [],
    expenses: [],
    returnRecords: [],
    billingInvoices: [invoice],
    notifications: [],
    auditLogs: [],
    descriptionBarcodes: [],
    messages: [],
    operationChatThreads: [],
    hardwareTests: [],
    printLogs: [],
    customUsers: [
      {
        id: "user_1",
        name: "Fixture Receiver Staff",
        email: "receiving.fixture@mts.local",
        role: "Receiving Staff",
        branchAccess: "Daet",
        status: "Active",
        createdAt: "2026-11-11T00:00:00.000Z"
      }
    ],
    companyProfile: {
      companyName: "Mancenido Trucking Services",
      address: "Fixture address",
      phone: "0917 000 0000",
      email: "ops@example.test"
    },
    branches: [
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
      }
    ],
    paymentMethods: ["Cash"],
    expenseCategories: ["Fuel"],
    userBranchAccessOverrides: {}
  };
}

describe("Prisma state mapping", () => {
  test("round-trips a cargo package with photos and decimal fields", () => {
    const rows = stateToRows(fixtureState());

    expect(rows.cargoPackages).toHaveLength(1);
    expect(rows.cargoPackages[0]).toMatchObject({
      id: "pkg_1",
      receivingRecordId: "rr_1",
      price: 3600,
      unitPrice: 1800,
      weight: 24.5
    });
    expect(rows.photos).toHaveLength(2);
    expect(rows.photos.map((photo) => photo.fileUrl)).toEqual(["/uploads/pkg-1-a.jpg", "/uploads/pkg-1-b.jpg"]);
    expect(rows.photos.every((photo) => photo.type === "Package" && photo.cargoPackageId === "pkg_1")).toBe(true);

    const roundTripped = rowsToState(rows);
    expect(roundTripped.packages?.[0]).toEqual(cargo);
  });

  test("round-trips a trip through TripCargo join rows", () => {
    const rows = stateToRows(fixtureState());

    expect(rows.tripCargo).toEqual([
      expect.objectContaining({ tripId: "trip_1", cargoPackageId: "pkg_1" })
    ]);

    const roundTripped = rowsToState(rows);
    expect(roundTripped.trips?.[0]?.cargoPackageIds).toEqual(["pkg_1"]);
    expect(roundTripped.trips?.[0]).toEqual(trip);
  });

  test("round-trips a receiving record with its embedded packages", () => {
    const rows = stateToRows(fixtureState());

    expect(rows.receivingRecords[0]).toMatchObject({
      id: "rr_1",
      customerDrPhotoUrl: "/uploads/dr-1.jpg",
      customerDrNumber: "DR-FIXTURE-1"
    });

    const roundTripped = rowsToState(rows);
    expect(roundTripped.receivingRecords?.[0]).toEqual(receiving);
  });

  test("round-trips a billing invoice through its package relation", () => {
    const rows = stateToRows(fixtureState());

    expect(rows.billingInvoicePackages).toEqual([
      expect.objectContaining({ billingInvoiceId: "inv_1", cargoPackageId: "pkg_1" })
    ]);

    const roundTripped = rowsToState(rows);
    expect(roundTripped.billingInvoices?.[0]).toEqual(invoice);
  });

  test("round-trips a receiving draft with Json fields untouched", () => {
    const rows = stateToRows(fixtureState());

    expect(rows.receivingDrafts[0]?.formState).toEqual(draft.formState);
    expect(rows.receivingDrafts[0]?.productLines).toEqual(draft.productLines);

    const roundTripped = rowsToState(rows);
    expect(roundTripped.receivingDrafts?.[0]).toEqual(draft);
  });
});
