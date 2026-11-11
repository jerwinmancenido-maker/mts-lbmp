/**
 * Full-journey smoke gate.
 *
 * Signs in with the provisioned smoke admin account — NOT a demo account.
 * Credentials come from SMOKE_EMAIL / SMOKE_PASSWORD (see
 * tools/smoke-credentials.mjs for the env vars, the ALLOW_DEMO_AUTH-gated
 * seed hook that provisions the accounts, and the local defaults).
 */
import { resolveSmokeCredentials } from "./smoke-credentials.mjs";

const API_URL = process.env.API_URL ?? "http://localhost:4100";
const smoke = resolveSmokeCredentials();
let token = "";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    },
    ...options
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

const login = await request("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: smoke.email, password: smoke.password })
});
token = login.token;
const bootstrap = await request("/bootstrap");
let customerId = bootstrap.customers[0]?.id;
if (!customerId) {
  const customer = await request("/customers", {
    method: "POST",
    body: JSON.stringify({
      businessName: `Smoke Test Customer ${Date.now()}`,
      contactPerson: "Smoke Contact",
      phone: "0917 000 0000",
      billingTerm: "Pay upon delivery"
    })
  });
  customerId = customer.id;
}

const receiving = await request("/receiving", {
  method: "POST",
  body: JSON.stringify({
    customerId,
    customerDrNumber: `DR-SMOKE-${Date.now()}`,
    sender: "Smoke Sender",
    consignee: "Smoke Consignee",
    destination: "Daet",
    packages: [
      {
        description: "Smoke test package",
        destination: "Daet",
        handlingBranchName: "Daet",
        deliveryType: "Deliver to consignee",
        consigneeName: "Smoke Receiver",
        addressLine: "Smoke Street",
        barangay: "Centro",
        city: "Daet",
        province: "Camarines Norte",
        condition: "Good",
        quantity: 1,
        unit: "box",
        weight: 10,
        weightUnit: "kg",
        length: 50,
        width: 40,
        height: 30,
        dimensionUnit: "cm",
        price: null
      }
    ]
  })
});

const cargoPackage = receiving.packages[0];

await request(`/packages/${cargoPackage.id}/price`, {
  method: "PATCH",
  body: JSON.stringify({ price: 350, reason: "Smoke test price" })
});

const trip = await request("/trips", {
  method: "POST",
  body: JSON.stringify({
    origin: "Origin Warehouse",
    destination: "Daet",
    vehicleDescription: "Rental Truck",
    driverName: "Smoke Driver"
  })
});

await request(`/trips/${trip.id}/load`, {
  method: "POST",
  body: JSON.stringify({ cargoPackageId: cargoPackage.id })
});
await request(`/trips/${trip.id}/depart`, { method: "POST" });
await request(`/trips/${trip.id}/arrive`, { method: "POST" });

await request("/deliveries/complete", {
  method: "POST",
  body: JSON.stringify({
    cargoPackageId: cargoPackage.id,
    deliveredTo: "Smoke Receiver",
    signatureUrl: "signature-captured",
    deliveryPhotoUrl: "photo-captured"
  })
});

await request("/payments", {
  method: "POST",
  body: JSON.stringify({
    cargoPackageId: cargoPackage.id,
    amountPaid: 350,
    method: "Cash"
  })
});

const receivingSlip = await request(`/packages/${cargoPackage.id}/receiving-slip`);
const qrLabel = await request(`/packages/${cargoPackage.id}/qr-label`);
const deliveryReceipt = await request(`/packages/${cargoPackage.id}/delivery-receipt`);
const manifest = await request(`/trips/${trip.id}/loading-manifest`);
const escpos = await request("/printing/escpos-preview", {
  method: "POST",
  body: JSON.stringify({ text: deliveryReceipt.text })
});

const expense = await request("/expenses", {
  method: "POST",
  body: JSON.stringify({
    tripId: trip.id,
    category: "Fuel",
    amount: 100,
    description: "Smoke fuel"
  })
});

await request(`/expenses/${expense.id}/approve`, { method: "POST" });

const dashboard = await request("/dashboard");
const tracking = await request(`/tracking/${cargoPackage.packageNumber}`);
const audit = await request("/audit");
const settings = await request("/settings");
const hardwareTest = await request("/hardware/tests", {
  method: "POST",
  body: JSON.stringify({
    deviceName: "NB80 Android POS",
    scannerResult: "Pass",
    printerResult: "Pass",
    cameraResult: "Pass",
    signatureResult: "Pass",
    pwaResult: "Pass",
    notes: "Smoke validation"
  })
});
const hardwareTests = await request("/hardware/tests");

console.log(
  JSON.stringify(
    {
      ok: true,
      packageNumber: cargoPackage.packageNumber,
      trackingStatus: tracking.status,
      delivered: dashboard.delivered,
      paymentsCollected: dashboard.paymentsCollected,
      profitThisMonth: dashboard.profitThisMonth,
      documents: {
        receivingSlip: receivingSlip.text.includes("RECEIVING SLIP"),
        qrLabel: qrLabel.text.includes("PACKAGE QR LABEL"),
        deliveryReceipt: deliveryReceipt.text.includes("DELIVERY RECEIPT"),
        manifest: manifest.text.includes("LOADING MANIFEST"),
        escposBytes: escpos.bytes.length
      },
      auditEntries: audit.length,
      branches: settings.branches.length,
      paymentMethods: settings.paymentMethods.length,
      hardwareTest: hardwareTest.id,
      hardwareTests: hardwareTests.length
    },
    null,
    2
  )
);
