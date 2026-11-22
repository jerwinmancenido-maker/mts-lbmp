import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type {
  CargoPackage,
  Customer,
  DeliveryRecord,
  PackageMessage,
  ServiceNotification
} from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 PR-13 — notification message fallback (C-M17).
 *
 * The Round 1 capture showed the Notification Center rendering
 * "Shipment message received — PKG-2026-11-000002: undefined": the
 * shipment-message door (POST /packages/:id/messages) passes the
 * request payload straight into createMessage, and a post whose body
 * is missing entirely composed the notification from the raw input.
 * The service now normalizes once at composition: a real body is kept
 * verbatim; a missing or blank one falls back to a complete sentence,
 * so neither the stored message nor its notification can render
 * "undefined" / "null" for any record shape.
 *
 * The sweep neighbour fixed in the same PR: failDelivery interpolated
 * its unvalidated failedReason into the "Failed delivery"
 * notification (and the stored record) the same way.
 */

type ServiceInternals = {
  customers: Customer[];
  packages: CargoPackage[];
  messages: PackageMessage[];
  notifications: ServiceNotification[];
  deliveries: DeliveryRecord[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const customer: Customer = {
  id: "cust_pr13",
  businessName: "PR13 Fixture Customer",
  status: "Active",
  billingTerm: "Custom",
  contacts: []
};

const cargo: CargoPackage = {
  id: "pkg_pr13",
  packageNumber: "PKG-2026-11-000002",
  receivingRecordNumber: "RR-2026-11-000002",
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
  qrValue: "MTS:PKG:PKG-2026-11-000002",
  photoUrls: [],
  createdAt: "2026-11-22T00:00:00.000Z"
};

function seededService(status: CargoPackage["status"] = "Ready for Delivery") {
  const service = new LogisticsService();
  const state = internals(service);
  state.customers.push({ ...customer });
  state.packages.push({ ...cargo, status });
  return { service, state };
}

function lastNotification(state: ServiceInternals): ServiceNotification {
  const notification = state.notifications[state.notifications.length - 1];
  if (!notification) throw new Error("expected a notification to have been composed");
  return notification;
}

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-pr13-"));
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

describe("shipment message notification (C-M17)", () => {
  test("a real body is kept verbatim in the record and the notification", () => {
    const { service, state } = seededService();

    const message = service.createMessage({
      cargoPackageId: cargo.id,
      senderName: "Juan Dela Cruz",
      body: "Please hold the shipment until Friday."
    });

    expect(message.body).toBe("Please hold the shipment until Friday.");
    expect(message.senderName).toBe("Juan Dela Cruz");
    const notification = lastNotification(state);
    expect(notification.title).toBe("Shipment message received");
    expect(notification.message).toBe("PKG-2026-11-000002: Please hold the shipment until Friday.");
  });

  test("the round's exact shape — body field missing entirely — renders a complete sentence, never 'undefined'", () => {
    const { service, state } = seededService();

    // The controller passes body.body straight through; a post that
    // omits it reaches the service as undefined despite the type.
    const message = service.createMessage({
      cargoPackageId: cargo.id,
      senderName: "Juan Dela Cruz",
      body: undefined as unknown as string
    });

    expect(message.body).toBe("Juan Dela Cruz sent a message about this shipment.");
    const notification = lastNotification(state);
    expect(notification.message).toBe("PKG-2026-11-000002: Juan Dela Cruz sent a message about this shipment.");
    expect(notification.message).not.toContain("undefined");
    expect(notification.message).not.toContain("null");
    expect(message.body).not.toContain("undefined");
  });

  test("body and sender both missing — the fallback still names the shipment event completely", () => {
    const { service, state } = seededService();

    const message = service.createMessage({
      cargoPackageId: cargo.id,
      senderName: undefined as unknown as string,
      body: undefined as unknown as string
    });

    expect(message.body).toBe("A message was posted about this shipment.");
    expect(message.senderName).toBe("Shipment sender");
    const notification = lastNotification(state);
    expect(notification.message).toBe("PKG-2026-11-000002: A message was posted about this shipment.");
    expect(notification.message).not.toContain("undefined");
    expect(notification.message).not.toContain("null");
  });

  test("a blank body falls back the same way; a null body never renders 'null'", () => {
    const { service, state } = seededService();

    const blank = service.createMessage({ cargoPackageId: cargo.id, senderName: "Maria", body: "   " });
    expect(blank.body).toBe("Maria sent a message about this shipment.");

    const nulled = service.createMessage({
      cargoPackageId: cargo.id,
      senderName: "Maria",
      body: null as unknown as string
    });
    expect(nulled.body).toBe("Maria sent a message about this shipment.");
    const notification = lastNotification(state);
    expect(notification.message).not.toContain("undefined");
    expect(notification.message).not.toContain("null");
  });
});

describe("failed delivery notification (C-M17 sweep)", () => {
  test("a real failure reason is kept verbatim in the record and the notification", () => {
    const { service, state } = seededService();

    const delivery = service.failDelivery({
      cargoPackageId: cargo.id,
      failedReason: "Customer Not Available",
      nextAction: "Redeliver tomorrow"
    });

    expect(delivery.failedReason).toBe("Customer Not Available");
    const notification = lastNotification(state);
    expect(notification.title).toBe("Failed delivery");
    expect(notification.message).toBe("PKG-2026-11-000002: Customer Not Available");
  });

  test("a missing failure reason falls back to complete text in record, notification and audit-facing fields", () => {
    const { service, state } = seededService();

    const delivery = service.failDelivery({
      cargoPackageId: cargo.id,
      failedReason: undefined as unknown as string,
      nextAction: "Redeliver tomorrow"
    });

    expect(delivery.failedReason).toBe("No failure reason was recorded.");
    const notification = lastNotification(state);
    expect(notification.message).toBe("PKG-2026-11-000002: No failure reason was recorded.");
    expect(notification.message).not.toContain("undefined");
    expect(notification.message).not.toContain("null");
  });
});
