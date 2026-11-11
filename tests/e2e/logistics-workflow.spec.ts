import { expect, request, test, type APIRequestContext } from "@playwright/test";

const apiBaseURL = process.env.E2E_API_BASE_URL ?? "http://localhost:4100";

async function loginAsAdmin(api: APIRequestContext) {
  // Phase 5 P5-2: the demo admin account is deleted. This spec runs
  // against an API booted with ALLOW_DEMO_AUTH=true, which provisions
  // the smoke accounts — defaults kept in sync with
  // tools/smoke-credentials.mjs (SMOKE_EMAIL / SMOKE_PASSWORD override).
  const email = process.env.SMOKE_EMAIL?.trim() || "smoke.admin@mts-smoke.test";
  const secret = process.env.SMOKE_PASSWORD || "password";
  const response = await api.post("/auth/login", {
    data: { email, password: secret }
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.token).toBeTruthy();
  return body.token as string;
}

async function apiPost<T>(api: APIRequestContext, token: string, path: string, data?: unknown) {
  const response = await api.post(path, {
    headers: { authorization: `Bearer ${token}` },
    data
  });
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${path} failed: ${JSON.stringify(body)}`).toBeTruthy();
  return body as T;
}

async function apiGet<T>(api: APIRequestContext, token: string, path: string) {
  const response = await api.get(path, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${path} failed: ${JSON.stringify(body)}`).toBeTruthy();
  return body as T;
}

test.describe("Logistics workflow API", () => {
  test("runs intake-to-delivery happy path with documents, payment, and expense", async () => {
    const api = await request.newContext({ baseURL: apiBaseURL });
    const token = await loginAsAdmin(api);
    const stamp = Date.now();

    const customer = await apiPost<{ id: string; businessName: string }>(api, token, "/customers", {
      businessName: `QA-E2E Customer ${stamp}`,
      tin: `QA-${stamp}`,
      companyPhone: "0917 000 0000",
      contactPerson: "QA Operations Contact",
      phone: "0917 111 2222",
      address: "QA Main Address, Daet",
      billingAddress: "QA Billing Address, Daet",
      shippingAddress: "QA Shipping Address, Daet",
      billingTerm: "Pay upon delivery"
    });

    const product = await apiPost<{ id: string; name: string }>(api, token, "/products", {
      name: `QA-E2E Angle Bar ${stamp}`,
      barcode: `QA-E2E-${stamp}`,
      brand: "QA Brand",
      category: "Hardware",
      defaultUnit: "bundle",
      defaultPrice: 1800
    });

    const receiving = await apiPost<{
      id: string;
      recordNumber: string;
      packages: Array<{ id: string; packageNumber: string; status: string; price: number }>;
    }>(api, token, "/receiving", {
      customerId: customer.id,
      customerDrNumber: `QA-DR-${stamp}`,
      sender: "QA Drop-off Person",
      consignee: "QA Consignee",
      destination: "Daet",
      drPhotoUrl: "/uploads/qa-dr-photo.jpg",
      packages: [
        {
          productId: product.id,
          description: product.name,
          quantity: 2,
          unit: "bundle",
          destination: "Daet",
          handlingBranchName: "Daet",
          deliveryType: "Deliver to consignee",
          consigneeName: "QA Consignee",
          addressLine: "QA Delivery Street",
          barangay: "QA Barangay",
          city: "Daet",
          province: "Camarines Norte",
          condition: "Good",
          unitPrice: 1800,
          price: 3600,
          weight: 24,
          weightUnit: "kg",
          length: 120,
          width: 20,
          height: 15,
          dimensionUnit: "cm"
        }
      ]
    });
    const cargo = receiving.packages[0];
    expect(receiving.recordNumber).toMatch(/^RR-/);
    expect(cargo.packageNumber).toMatch(/^PKG-/);
    expect(cargo.status).toBe("Waiting for Loading");

    const trackingBefore = await api.get(`/tracking/${cargo.packageNumber}`);
    expect(trackingBefore.ok()).toBeTruthy();
    await expect(trackingBefore.json()).resolves.toMatchObject({ packageNumber: cargo.packageNumber });

    const trip = await apiPost<{
      id: string;
      tripNumber: string;
      status: string;
      cargoPackageIds: string[];
    }>(api, token, "/trips", {
      origin: "Origin Warehouse",
      destination: "Daet",
      plateNumber: `QA${String(stamp).slice(-6)}`,
      vehicleDescription: "QA Rental Truck",
      driverName: "QA Driver",
      driverContactNumber: "0918 111 2222",
      truckOwnerName: "QA Truck Provider",
      saveTruckDetails: true
    });
    expect(trip.tripNumber).toMatch(/^TR-/);
    expect(trip.status).toBe("Planned");

    const loaded = await apiPost<{ trip: { status: string; cargoPackageIds: string[] }; cargo: { status: string } }>(
      api,
      token,
      `/trips/${trip.id}/load`,
      { cargoPackageId: cargo.id }
    );
    expect(loaded.trip.status).toBe("Loading");
    expect(loaded.trip.cargoPackageIds).toContain(cargo.id);
    expect(loaded.cargo.status).toBe("Loaded");

    const manifest = await apiGet<{ text: string }>(api, token, `/trips/${trip.id}/loading-manifest`);
    expect(manifest.text).toContain("LOADING MANIFEST");
    expect(manifest.text).toContain(cargo.packageNumber);

    const departed = await apiPost<{ status: string }>(api, token, `/trips/${trip.id}/depart`);
    expect(departed.status).toBe("Departed");

    const arrived = await apiPost<{ status: string }>(api, token, `/trips/${trip.id}/arrive`);
    expect(arrived.status).toBe("Arrived");

    const verifiedCargo = await apiPost<{ status: string }>(api, token, `/packages/${cargo.id}/verify-arrival`, {
      condition: "Good",
      issueStatus: "Ready for Delivery",
      notes: "QA branch verification"
    });
    expect(verifiedCargo.status).toBe("Ready for Delivery");

    const delivery = await apiPost<{ status: string; deliveredTo: string }>(api, token, "/deliveries/complete", {
      cargoPackageId: cargo.id,
      deliveredTo: "QA Receiver",
      signatureUrl: "/uploads/qa-signature.png",
      deliveryPhotoUrl: "/uploads/qa-delivery.jpg",
      notes: "QA delivered"
    });
    expect(delivery.status).toBe("Delivered");

    const payment = await apiPost<{ status: string; balance: number }>(api, token, "/payments", {
      cargoPackageId: cargo.id,
      amountPaid: 3600,
      method: "Cash",
      collectionPoint: "Delivery",
      collectedByName: "QA Delivery Staff",
      collectedByRole: "Delivery Staff"
    });
    expect(payment.status).toBe("Paid");
    expect(payment.balance).toBe(0);

    const expense = await apiPost<{ status: string; amount: number }>(api, token, "/expenses", {
      tripId: trip.id,
      category: "Fuel",
      amount: 500,
      description: "QA fuel expense"
    });
    expect(expense.status).toBe("Submitted");
    expect(expense.amount).toBe(500);

    const completedTrip = await apiPost<{ status: string }>(api, token, `/trips/${trip.id}/complete`);
    expect(completedTrip.status).toBe("Completed");

    const deliveryReceipt = await apiGet<{ text: string }>(api, token, `/packages/${cargo.id}/delivery-receipt`);
    expect(deliveryReceipt.text).toContain("DELIVERY RECEIPT");

    const trackingAfter = await api.get(`/tracking/${cargo.packageNumber}`);
    expect(trackingAfter.ok()).toBeTruthy();
    await expect(trackingAfter.json()).resolves.toMatchObject({ status: "Delivered" });

    await api.dispose();
  });

  test("blocks loading when received cargo has no price", async () => {
    const api = await request.newContext({ baseURL: apiBaseURL });
    const token = await loginAsAdmin(api);
    const stamp = Date.now();

    const customer = await apiPost<{ id: string }>(api, token, "/customers", {
      businessName: `QA-E2E No Price Customer ${stamp}`,
      contactPerson: "QA Contact",
      billingTerm: "Pay upon delivery"
    });

    const receiving = await apiPost<{ packages: Array<{ id: string; status: string }> }>(api, token, "/receiving", {
      customerId: customer.id,
      customerDrNumber: `QA-NOPRICE-${stamp}`,
      destination: "Daet",
      packages: [
        {
          description: `QA-E2E Unpriced Cargo ${stamp}`,
          quantity: 1,
          unit: "pcs",
          destination: "Daet",
          handlingBranchName: "Daet",
          deliveryType: "Deliver to consignee",
          consigneeName: "QA Consignee",
          addressLine: "QA Street",
          city: "Daet",
          province: "Camarines Norte",
          condition: "Good",
          price: null
        }
      ]
    });
    const cargo = receiving.packages[0];
    expect(cargo.status).toBe("Waiting for Price");

    const trip = await apiPost<{ id: string }>(api, token, "/trips", {
      origin: "Origin Warehouse",
      destination: "Daet",
      plateNumber: `NP${String(stamp).slice(-6)}`,
      vehicleDescription: "QA No Price Truck",
      driverName: "QA Driver"
    });

    const blocked = await api.post(`/trips/${trip.id}/load`, {
      headers: { authorization: `Bearer ${token}` },
      data: { cargoPackageId: cargo.id }
    });
    expect(blocked.status()).toBe(400);
    await expect(blocked.json()).resolves.toMatchObject({
      message: expect.stringContaining("no price")
    });

    await api.dispose();
  });
});
