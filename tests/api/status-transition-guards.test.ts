import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type { CargoPackage, Customer, DeliveryRecord, Trip } from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 PR-4 — status-transition guards (C-M4, C-M5).
 *
 * C-M4: POST /deliveries/complete accepted a package in "Waiting for
 * Loading" (never loaded) and in "In Transit" (never arrived), minting
 * proof-of-delivery for cargo that never reached the destination branch
 * (L2 W1/W2). Completion is now refused unless the package has arrived:
 * "Arrived", "Ready for Delivery", or "Failed Delivery" (redelivery,
 * L2 W14).
 *
 * C-M5: trip depart/arrive had no guards — an empty trip could depart, a
 * departed trip could depart again, and a trip that never departed could
 * be marked arrived (L2 W9/W10). The service now enforces the same rule
 * the web screen flow already applies (canDepartTrip: Planned/Loading
 * with cargo aboard; arrival only after departure).
 */

type ServiceInternals = {
  customers: Customer[];
  packages: CargoPackage[];
  deliveries: DeliveryRecord[];
  trips: Trip[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const customer: Customer = {
  id: "cust_pr4",
  businessName: "PR4 Fixture Customer",
  status: "Active",
  billingTerm: "Custom",
  contacts: []
};

const cargo: CargoPackage = {
  id: "pkg_pr4",
  packageNumber: "PKG-2026-11-000404",
  receivingRecordNumber: "RR-2026-11-000404",
  customerId: customer.id,
  customerName: customer.businessName,
  description: "Rice sacks",
  quantity: 2,
  unit: "sack",
  destination: "Daet",
  handlingBranchId: "daet",
  handlingBranchName: "Daet",
  deliveryType: "Door-to-door delivery",
  condition: "Good",
  status: "Ready for Delivery",
  price: 350,
  qrValue: "MTS:PKG:PKG-2026-11-000404",
  photoUrls: [],
  createdAt: "2026-11-22T00:00:00.000Z"
};

function seededService() {
  const service = new LogisticsService();
  internals(service).customers.push({ ...customer });
  return service;
}

function seedPackage(service: LogisticsService, status: CargoPackage["status"]) {
  const pkg: CargoPackage = { ...cargo, status };
  internals(service).packages.push(pkg);
  return pkg;
}

function deliveriesFor(service: LogisticsService, packageId: string) {
  return internals(service).deliveries.filter((delivery) => delivery.cargoPackageId === packageId);
}

/** Creates a priced, loadable package through the real receiving path. */
function makeLoadablePackage(service: LogisticsService) {
  const receiving = service.createReceiving({
    customerId: customer.id,
    destination: "Daet",
    packages: [{ description: "Loadable crate", deliveryType: "Customer pickup at branch" as const, price: 500, quantity: 1 }]
  });
  const pkg = receiving.packages[0];
  if (!pkg) throw new Error("fixture package missing");
  return pkg;
}

let tripSeq = 0;
function makeTrip(service: LogisticsService) {
  tripSeq += 1;
  // One active trip per truck per day is enforced, so each fixture trip
  // gets its own plate.
  return service.createTrip({ origin: "Naga", destination: "Daet", plateNumber: `PR4-TRUCK-${tripSeq}` });
}

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-pr4-"));
  previousInitCwd = process.env.INIT_CWD;
  previousRepository = process.env.MTS_REPOSITORY;
  process.env.INIT_CWD = tempRoot;
  delete process.env.MTS_REPOSITORY;
});

afterAll(() => {
  if (previousInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = previousInitCwd;
  if (previousRepository === undefined) delete process.env.MTS_REPOSITORY;
  else process.env.MTS_REPOSITORY = previousRepository;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("C-M4 — delivery completion requires an arrived package", () => {
  const illegalStatuses: CargoPackage["status"][] = [
    "Draft",
    "Received",
    "Waiting for Price",
    "Waiting for Loading",
    "Loaded",
    "In Transit",
    "Exception",
    "Cancelled"
  ];

  for (const status of illegalStatuses) {
    test(`completeDelivery from "${status}" is refused with the status unchanged (L2 W1/W2 family)`, () => {
      const service = seededService();
      const pkg = seedPackage(service, status);

      expect(() => service.completeDelivery({ cargoPackageId: pkg.id, deliveredTo: "Fixture Receiver" })).toThrow(
        /cannot be delivered from status/
      );
      expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe(status);
      expect(deliveriesFor(service, pkg.id)).toHaveLength(0);
    });
  }

  test("completeDelivery from \"Ready for Delivery\" succeeds (J5/J12 path)", () => {
    const service = seededService();
    const pkg = seedPackage(service, "Ready for Delivery");

    const delivery = service.completeDelivery({ cargoPackageId: pkg.id, deliveredTo: "Fixture Receiver" });

    expect(delivery.status).toBe("Delivered");
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("Delivered");
    expect(deliveriesFor(service, pkg.id)).toHaveLength(1);
  });

  test("completeDelivery from \"Arrived\" succeeds (trip arrived, awaiting branch verification)", () => {
    const service = seededService();
    const pkg = seedPackage(service, "Arrived");

    const delivery = service.completeDelivery({ cargoPackageId: pkg.id, deliveredTo: "Fixture Receiver" });

    expect(delivery.status).toBe("Delivered");
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("Delivered");
  });

  test("redelivery: completeDelivery from \"Failed Delivery\" succeeds (L2 W14)", () => {
    const service = seededService();
    const pkg = seedPackage(service, "Failed Delivery");
    internals(service).deliveries.push({
      id: "del_pr4_failed",
      cargoPackageId: pkg.id,
      status: "Failed Delivery",
      failedReason: "Customer Not Available",
      nextAction: "Reschedule",
      createdAt: "2026-11-22T00:00:00.000Z"
    });

    const delivery = service.completeDelivery({ cargoPackageId: pkg.id, deliveredTo: "Fixture Receiver" });

    expect(delivery.status).toBe("Delivered");
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("Delivered");
    expect(deliveriesFor(service, pkg.id)).toHaveLength(2);
  });
});

describe("C-M5 — trip depart/arrive guards", () => {
  test("departing an empty trip is refused; the trip stays Planned (L2 W10)", () => {
    const service = seededService();
    const trip = makeTrip(service);

    expect(() => service.departTrip(trip.id)).toThrow(/no cargo loaded/);
    expect(internals(service).trips.find((entry) => entry.id === trip.id)?.status).toBe("Planned");
  });

  test("arriving a trip that never departed is refused; state unchanged (L2 W9)", () => {
    const service = seededService();
    const pkg = makeLoadablePackage(service);
    const trip = makeTrip(service);
    service.loadCargo(trip.id, { cargoPackageId: pkg.id });

    expect(() => service.arriveTrip(trip.id)).toThrow(/Only a departed trip can be marked arrived/);
    expect(internals(service).trips.find((entry) => entry.id === trip.id)?.status).toBe("Loading");
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("Loaded");
  });

  test("departing the same trip twice is refused (L2 W10)", () => {
    const service = seededService();
    const pkg = makeLoadablePackage(service);
    const trip = makeTrip(service);
    service.loadCargo(trip.id, { cargoPackageId: pkg.id });
    service.departTrip(trip.id);

    expect(() => service.departTrip(trip.id)).toThrow(/cannot depart from status "Departed"/);
    expect(internals(service).trips.find((entry) => entry.id === trip.id)?.status).toBe("Departed");
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("In Transit");
  });

  test("arriving twice and departing after arrival are refused", () => {
    const service = seededService();
    const pkg = makeLoadablePackage(service);
    const trip = makeTrip(service);
    service.loadCargo(trip.id, { cargoPackageId: pkg.id });
    service.departTrip(trip.id);
    service.arriveTrip(trip.id);

    expect(() => service.arriveTrip(trip.id)).toThrow(/Only a departed trip can be marked arrived/);
    expect(() => service.departTrip(trip.id)).toThrow(/cannot depart from status "Arrived"/);
    expect(internals(service).trips.find((entry) => entry.id === trip.id)?.status).toBe("Arrived");
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("Arrived");
  });
});

describe("legal chain still completes end to end (J4 + J5)", () => {
  test("receiving → load → depart → arrive → verify → deliver → complete trip", () => {
    const service = seededService();
    const pkg = makeLoadablePackage(service);
    expect(pkg.status).toBe("Waiting for Loading");

    const trip = makeTrip(service);
    const loaded = service.loadCargo(trip.id, { cargoPackageId: pkg.id });
    expect(loaded.cargo.status).toBe("Loaded");
    expect(loaded.trip.status).toBe("Loading");

    const departed = service.departTrip(trip.id);
    expect(departed.status).toBe("Departed");
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("In Transit");

    const arrived = service.arriveTrip(trip.id);
    expect(arrived.status).toBe("Arrived");
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("Arrived");

    const verified = service.verifyArrivedCargo(pkg.id, {});
    expect(verified.status).toBe("Ready for Delivery");

    const delivery = service.completeDelivery({ cargoPackageId: pkg.id, deliveredTo: "Fixture Receiver" });
    expect(delivery.status).toBe("Delivered");
    expect(internals(service).packages.find((entry) => entry.id === pkg.id)?.status).toBe("Delivered");

    const completed = service.completeTrip(trip.id);
    expect(completed.status).toBe("Completed");
  });
});
