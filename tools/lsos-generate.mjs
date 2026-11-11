/**
 * LSOS sample-data generator.
 *
 * Phase 5 P5-2 migration: this script used to sign in as the five
 * hard-coded DEMO accounts (admin@ / receiving@ / delivery@ /
 * daet.owner@ / naga.owner@mts.local, shared password "password"). Those
 * accounts are deleted, so the generator now runs on the smoke-style
 * provisioned accounts (tools/smoke-credentials.mjs) — the same
 * ALLOW_DEMO_AUTH-gated test provisioning the smoke gates use:
 *
 *   1. Boot the API with ALLOW_DEMO_AUTH=true (never in production).
 *   2. Run this script; SMOKE_EMAIL / SMOKE_PASSWORD /
 *      SMOKE_LIMITED_EMAIL / SMOKE_LIMITED_PASSWORD override the
 *      throwaway defaults exactly as they do for the smoke gates.
 *
 * Only two provisioned accounts exist, so the old per-role tokens map
 * onto them: "admin" is the smoke admin (System Admin — holds every
 * permission, so it also performs the steps that used to run as
 * receiving/owners; audit entries for those steps are therefore recorded
 * under the smoke admin's name), and "delivery" is the smoke delivery
 * account. Label-only roles (receiving / daetOwner / nagaOwner) fall
 * back to the admin token via asRole(), as they did for unknown roles
 * before. The generated data is unchanged.
 */
import { resolveSmokeCredentials } from "./smoke-credentials.mjs";

const API_URL = process.env.API_URL ?? "http://localhost:4100";
const BATCH = "QA-BATCH-2026-07-02-LSOS";

let token = "";
const tokens = {};

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (items) => items[rand(0, items.length - 1)];
const money = (min, max) => rand(min, max);
const pad = (value, size = 3) => String(value).padStart(size, "0");

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

async function tryRequest(path, options = {}) {
  try {
    return { ok: true, data: await request(path, options) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function login() {
  const credentials = resolveSmokeCredentials(process.env);
  const accounts = {
    admin: { email: credentials.email, secret: credentials.password },
    delivery: { email: credentials.limitedEmail, secret: credentials.limitedPassword }
  };
  for (const [key, account] of Object.entries(accounts)) {
    let loginResult;
    try {
      loginResult = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: account.email, password: account.secret })
      });
    } catch (error) {
      throw new Error(
        `LSOS login failed for ${account.email}. Boot the API with ALLOW_DEMO_AUTH=true (outside production) ` +
          `so the smoke accounts are provisioned, or fix SMOKE_EMAIL/SMOKE_PASSWORD. Cause: ${error.message}`
      );
    }
    tokens[key] = loginResult.token;
  }
  token = tokens.admin;
}

async function asRole(role, path, options = {}) {
  const previous = token;
  token = tokens[role] ?? tokens.admin;
  try {
    return await request(path, options);
  } finally {
    token = previous;
  }
}

async function tryAsRole(role, path, options = {}) {
  const previous = token;
  token = tokens[role] ?? tokens.admin;
  try {
    return { ok: true, data: await request(path, options) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    token = previous;
  }
}

async function loginAdminOnly() {
  const credentials = resolveSmokeCredentials(process.env);
  const loginResult = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: credentials.email, password: credentials.password })
  });
  token = loginResult.token;
}

function dataUrl(label) {
  // 1x1 JPEG placeholder. Metadata is carried by the generated filename/type/audit record.
  return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z";
}

async function upload(type, label, entityId) {
  const result = await request("/uploads", {
    method: "POST",
    body: JSON.stringify({
      dataUrl: dataUrl(label),
      fileName: `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.jpg`,
      type,
      entityId
    })
  });
  return result.fileUrl;
}

const categories = ["Hardware", "Construction", "Agriculture", "Retail", "Industrial", "Consumer Goods"];
const productWords = {
  Hardware: ["Angle bar", "Tubular steel", "GI pipe", "Flat bar", "Welding rod", "Paint pail", "Bolts pack", "Roofing sheet"],
  Construction: ["Cement bag", "Plywood sheet", "Ceramic tiles", "PVC pipe", "Electrical conduit", "Hollow block", "Tile adhesive"],
  Agriculture: ["Rice sack", "Fertilizer bag", "Animal feed", "Seedling tray", "Coconut net", "Farm tools bundle"],
  Retail: ["Assorted grocery carton", "Beverage crate", "Snack box", "Cleaning supplies", "Store display rack"],
  Industrial: ["Machine spare part", "Bearing set", "Hydraulic hose", "Safety helmet carton", "Industrial chemical pail"],
  "Consumer Goods": ["Small appliance", "Electric fan carton", "Rice cooker box", "Plastic storage bin", "Toy carton"]
};
const units = ["pcs", "box", "bundle", "carton", "sack", "pail", "crate", "length"];
const barangays = ["Barangay I", "Barangay II", "Bagasbas", "Pamorangon", "Concepcion", "Sabang", "San Felipe", "Triangulo", "Mabolo", "Peñafrancia"];
const streets = ["Maharlika Highway", "Vinzons Avenue", "Rizal Street", "Panganiban Drive", "Diversion Road", "Market Road", "Warehouse Lane"];
const billingTerms = ["Pay upon delivery", "30 days after delivery", "15 days after delivery", "50% upfront, balance on delivery", "Weekly billing"];
const paymentMethods = ["Cash", "GCash", "Bank Transfer", "Check", "Credit Terms", "Advance Payment", "Other"];
const expenseCategories = ["Fuel", "Truck Rental", "Driver Allowance", "Helper Allowance", "Meals", "Parking", "Repairs", "Labor", "Loading Labor", "Unloading Labor", "Toll", "Miscellaneous"];
const conditions = ["Good", "Good", "Good", "Good", "Damaged", "Wet", "Incomplete", "For Checking"];

async function createQaUsers() {
  const users = [];
  const staff = [
    { name: "QA Receiving North", role: "Receiving Staff", branchAccess: "Origin Warehouse", staffCode: "7101" },
    { name: "QA Receiving South", role: "Receiving Staff", branchAccess: "Daet / Naga", staffCode: "7102" },
    { name: "QA Delivery Daet", role: "Delivery Staff", branchAccess: "Daet", staffCode: "7201" },
    { name: "QA Delivery Naga", role: "Delivery Staff", branchAccess: "Naga", staffCode: "7202" },
    { name: "QA Delivery Admin", role: "Delivery Admin", branchAccess: "Daet / Naga", staffCode: "7301" }
  ];
  for (const item of staff) {
    const result = await tryAsRole("admin", "/settings/users", {
      method: "POST",
      body: JSON.stringify({ ...item, email: `${item.name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@qa.local`, phone: `0999 ${rand(100, 999)} ${rand(1000, 9999)}` })
    });
    if (result.ok) users.push(result.data);
  }
  return users;
}

async function createCustomers() {
  const customers = [];
  for (let i = 1; i <= 50; i += 1) {
    const branch = i % 3 === 0 ? "Naga" : "Daet";
    const company = `QA-CUSTOMER-${pad(i)} ${pick(["Trading", "Hardware", "Supply", "Merchandise", "Agri Center", "Builders", "Retail Group"])}`;
    const address = `${pick(streets)}, ${pick(barangays)}, ${branch === "Naga" ? "Naga City, Camarines Sur" : "Daet, Camarines Norte"}`;
    const customer = await asRole("receiving", "/customers", {
      method: "POST",
      body: JSON.stringify({
        businessName: company,
        tin: `QA-TIN-${pad(i, 4)}`,
        companyPhone: `09${rand(10, 99)} ${rand(100, 999)} ${rand(1000, 9999)}`,
        contactPerson: `QA Contact ${pad(i)}`,
        phone: `09${rand(10, 99)} ${rand(100, 999)} ${rand(1000, 9999)}`,
        address,
        billingAddress: address,
        shippingAddress: address,
        billingTerm: pick(billingTerms)
      })
    });
    for (const role of ["Drop-off Person", "Receiver / Consignee", "Accounting"]) {
      await asRole("receiving", `/customers/${customer.id}/contacts`, {
        method: "POST",
        body: JSON.stringify({
          name: `QA ${role} ${pad(i)}`,
          role,
          phone: `09${rand(10, 99)} ${rand(100, 999)} ${rand(1000, 9999)}`,
          email: `qa.${role.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${pad(i)}@customer.test`,
          address,
          billingAddress: address,
          shippingAddress: address,
          isPrimary: role === "Accounting",
          notes: BATCH
        })
      });
    }
    customers.push(customer);
  }
  return customers;
}

async function createProducts() {
  const products = [];
  for (let i = 1; i <= 300; i += 1) {
    const category = categories[(i - 1) % categories.length];
    const baseName = pick(productWords[category]);
    const product = await asRole("receiving", "/products", {
      method: "POST",
      body: JSON.stringify({
        name: `QA-ITEM-${pad(i)} ${baseName}`,
        barcode: `QA-BARCODE-${pad(i, 4)}`,
        brand: `QA Brand ${((i - 1) % 20) + 1}`,
        category,
        defaultUnit: pick(units),
        defaultPrice: money(80, 4800),
        notes: `${BATCH} recurring ${category} product`
      })
    });
    products.push(product);
  }
  return products;
}

async function createTrucks() {
  const trucks = [];
  for (let i = 1; i <= 15; i += 1) {
    const type = i <= 5 ? "Company" : i <= 10 ? "Rental" : "Partner";
    const truck = await asRole("admin", "/trucks", {
      method: "POST",
      body: JSON.stringify({
        plateNumber: `QA-${type.slice(0, 3).toUpperCase()}-${pad(i)}`,
        driverName: `QA Driver ${pad(i)}`,
        contactNumber: `09${rand(10, 99)} ${rand(100, 999)} ${rand(1000, 9999)}`,
        ownerName: type === "Company" ? "Mancenido Trucking Services QA Fleet" : `QA ${type} Provider ${pad(i)}`
      })
    });
    trucks.push(truck);
  }
  return trucks;
}

function receivingPackagePayload(product, customerIndex, packageIndex, forceDestination) {
  const handlingBranchName = forceDestination ?? (packageIndex % 3 === 0 ? "Naga" : "Daet");
  const city = handlingBranchName === "Naga" ? "Naga City" : packageIndex % 11 === 0 ? "Legazpi City" : "Daet";
  const province = handlingBranchName === "Naga" ? "Camarines Sur" : city === "Legazpi City" ? "Albay" : "Camarines Norte";
  const condition = pick(conditions);
  const hasIssue = condition !== "Good";
  const quantity = rand(1, 25);
  const unitPrice = money(80, 900);
  const leaveUnpriced = packageIndex % 20 === 0;
  return {
    productId: product.id,
    productBarcode: product.barcode,
    description: product.name,
    quantity,
    unit: product.defaultUnit || pick(units),
    brand: product.brand,
    category: product.category,
    handlingBranchName,
    destination: handlingBranchName,
    deliveryType: packageIndex % 13 === 0 ? "Customer pickup" : "Deliver to consignee",
    consigneeName: `QA Receiver ${pad(customerIndex)}-${pad(packageIndex, 4)}`,
    deliveryBusinessName: `QA Destination Store ${pad(customerIndex)}`,
    addressLine: `${rand(1, 999)} ${pick(streets)}`,
    barangay: pick(barangays),
    city,
    province,
    landmark: `QA landmark ${pad(packageIndex, 4)}`,
    deliveryPhone: `09${rand(10, 99)} ${rand(100, 999)} ${rand(1000, 9999)}`,
    deliveryNotes: `${BATCH} delivery note`,
    condition,
    conditionNotes: hasIssue ? `${BATCH} ${condition} found during receiving` : undefined,
    photoUrls: hasIssue ? [`/uploads/qa-condition-${condition.toLowerCase().replace(/[^a-z]+/g, "-")}.jpg`] : [],
    unitPrice,
    price: leaveUnpriced ? null : unitPrice * quantity,
    weight: Number((Math.random() * 70 + 1).toFixed(2)),
    weightUnit: "kg",
    length: rand(15, 240),
    width: rand(10, 120),
    height: rand(5, 90),
    dimensionUnit: "cm"
  };
}

function packageCounts(totalRecords, totalPackages) {
  const counts = [];
  let remaining = totalPackages;
  for (let i = 0; i < totalRecords; i += 1) {
    const recordsLeft = totalRecords - i;
    if (recordsLeft === 1) {
      counts.push(remaining);
      break;
    }
    const minLeft = recordsLeft - 1;
    const maxForThis = Math.min(20, remaining - minLeft);
    const minForThis = Math.max(1, remaining - 20 * (recordsLeft - 1));
    let count = 10 + ((i % 7) - 3);
    count = Math.max(minForThis, Math.min(maxForThis, count));
    counts.push(count);
    remaining -= count;
  }
  return counts;
}

async function createReceivingRecords(customers, products) {
  const records = [];
  const counts = packageCounts(500, 5000);
  let globalPackageIndex = 1;
  for (let i = 1; i <= 500; i += 1) {
    const customer = customers[(i - 1) % customers.length];
    const destination = i % 4 === 0 ? "Naga" : "Daet";
    const packages = [];
    for (let j = 0; j < counts[i - 1]; j += 1) {
      const product = products[(globalPackageIndex - 1) % products.length];
      const forceDestination = i % 10 === 0 && j % 3 === 0 ? (destination === "Daet" ? "Naga" : "Daet") : undefined;
      packages.push(receivingPackagePayload(product, ((i - 1) % customers.length) + 1, globalPackageIndex, forceDestination));
      globalPackageIndex += 1;
    }
    const record = await asRole("receiving", "/receiving", {
      method: "POST",
      body: JSON.stringify({
        customerId: customer.id,
        customerDrNumber: `QA-DR-${pad(i, 5)}`,
        sender: `QA Sender ${pad(i)}`,
        consignee: `QA Consignee ${pad(i)}`,
        destination,
        packages
      })
    });
    if (i % 5 === 0) {
      await asRole("receiving", `/receiving/${record.id}/dr-photo`, {
        method: "POST",
        body: JSON.stringify({ drPhotoUrl: `/uploads/qa-dr-${pad(i, 5)}.jpg`, reason: `${BATCH} DR photo simulation` })
      });
    }
    records.push(record);
    if (i % 50 === 0) console.log(`Created receiving records: ${i}/500`);
  }
  return records;
}

async function applyPricingChanges(packages) {
  let updates = 0;
  for (let i = 0; i < packages.length; i += 1) {
    const pkg = packages[i];
    if (pkg.price == null) {
      await asRole(i % 2 === 0 ? "daetOwner" : "nagaOwner", `/packages/${pkg.id}/price`, {
        method: "PATCH",
        body: JSON.stringify({ price: money(200, 6000), reason: `${BATCH} owner price completion` })
      });
      updates += 1;
    } else if (i % 17 === 0) {
      await asRole(i % 2 === 0 ? "daetOwner" : "nagaOwner", `/packages/${pkg.id}/price`, {
        method: "PATCH",
        body: JSON.stringify({ price: Math.max(100, Math.round(pkg.price * 1.08)), reason: `${BATCH} price change simulation` })
      });
      updates += 1;
    }
  }
  return updates;
}

async function createTripsAndMoveCargo(packages) {
  const trips = [];
  const loadable = packages.filter((pkg) => pkg.price != null).slice(0, 2550);
  let cursor = 0;
  for (let i = 1; i <= 150; i += 1) {
    const destination = i % 4 === 0 ? "Naga" : "Daet";
    const trip = await asRole("receiving", "/trips", {
      method: "POST",
      body: JSON.stringify({
        origin: i % 15 === 0 ? "Naga" : "Origin Warehouse",
        destination,
        plateNumber: `QA-TRIP-${pad(i)}`,
        vehicleDescription: `${i % 5 === 0 ? "Partner" : i % 3 === 0 ? "Rental" : "Company"} Truck QA-TRIP-${pad(i)}`,
        driverName: `QA Driver ${pad(((i - 1) % 20) + 1)}`,
        driverContactNumber: `09${rand(10, 99)} ${rand(100, 999)} ${rand(1000, 9999)}`,
        truckOwnerName: i % 5 === 0 ? `QA Partner Provider ${pad(i)}` : "Mancenido Trucking Services QA Fleet"
      })
    });
    const loadCount = i <= 20 ? rand(3, 8) : rand(12, 20);
    const loaded = [];
    for (let j = 0; j < loadCount && cursor < loadable.length; j += 1) {
      const cargo = loadable[cursor++];
      const branch = cargo.handlingBranchName ?? cargo.destination;
      const mismatch = branch !== destination;
      const issue = cargo.condition !== "Good";
      const result = await tryAsRole("receiving", `/trips/${trip.id}/load`, {
        method: "POST",
        body: JSON.stringify({
          cargoPackageId: cargo.id,
          overrideReason: mismatch || issue ? `${BATCH} ${mismatch ? "mixed trip" : "condition review"} approved for simulation` : undefined
        })
      });
      if (result.ok) loaded.push(cargo);
    }
    if (loaded.length && i % 12 === 0) {
      await tryAsRole("receiving", `/trips/${trip.id}/unload`, {
        method: "POST",
        body: JSON.stringify({ cargoPackageId: loaded[0].id, reason: `${BATCH} partial load item left behind` })
      });
    }
    await tryAsRole("receiving", `/trips/${trip.id}/loading-photo`, {
      method: "POST",
      body: JSON.stringify({ photoUrl: `/uploads/qa-trip-loading-${pad(i)}.jpg` })
    });
    if (i > 20) {
      await tryAsRole(i % 4 === 0 ? "nagaOwner" : "daetOwner", `/trips/${trip.id}/depart`, { method: "POST" });
    }
    if (i > 50) {
      await tryAsRole("delivery", `/trips/${trip.id}/arrive`, { method: "POST" });
    }
    trips.push(trip);
    if (i % 25 === 0) console.log(`Created trips: ${i}/150`);
  }
  return trips;
}

async function postArrivalAndDelivery(packages) {
  const refreshed = await request("/packages");
  const arrived = refreshed.filter((pkg) => pkg.status === "Arrived");
  let verified = 0;
  let delivered = 0;
  let failed = 0;
  let returns = 0;
  for (let i = 0; i < arrived.length; i += 1) {
    const pkg = arrived[i];
    const mode = i % 20;
    if (mode === 0) {
      await asRole("delivery", `/packages/${pkg.id}/verify-arrival`, {
        method: "POST",
        body: JSON.stringify({ issueStatus: "Missing", condition: "Other", notes: `${BATCH} missing during unloading`, photoUrl: `/uploads/qa-missing-${pkg.packageNumber}.jpg` })
      });
      const ret = await tryAsRole("delivery", "/returns", {
        method: "POST",
        body: JSON.stringify({ cargoPackageId: pkg.id, reason: `${BATCH} missing/return investigation`, nextAction: "Hold at Branch", photoUrl: `/uploads/qa-return-${pkg.packageNumber}.jpg`, notes: BATCH })
      });
      if (ret.ok) returns += 1;
    } else if (mode === 1 || mode === 2) {
      await asRole("delivery", `/packages/${pkg.id}/verify-arrival`, {
        method: "POST",
        body: JSON.stringify({ issueStatus: "Damaged", condition: "Damaged", notes: `${BATCH} damage found at unloading`, photoUrl: `/uploads/qa-damaged-${pkg.packageNumber}.jpg` })
      });
      const ret = await tryAsRole("delivery", "/returns", {
        method: "POST",
        body: JSON.stringify({ cargoPackageId: pkg.id, reason: `${BATCH} customer return due to damage`, nextAction: "Return to Sender", photoUrl: `/uploads/qa-return-${pkg.packageNumber}.jpg`, notes: BATCH })
      });
      if (ret.ok) returns += 1;
    } else {
      await asRole("delivery", `/packages/${pkg.id}/verify-arrival`, {
        method: "POST",
        body: JSON.stringify({ issueStatus: "Ready for Delivery", condition: "Good", notes: `${BATCH} branch verification ok` })
      });
      verified += 1;
    }
  }
  const ready = (await request("/packages")).filter((pkg) => pkg.status === "Ready for Delivery");
  for (let i = 0; i < ready.length; i += 1) {
    const pkg = ready[i];
    if (i % 9 === 0) {
      await asRole("delivery", "/deliveries/fail", {
        method: "POST",
        body: JSON.stringify({ cargoPackageId: pkg.id, failedReason: pick(["Customer Not Available", "Wrong Address", "Refused by Receiver", "Reschedule Required"]), notes: `${BATCH} failed delivery simulation`, nextAction: i % 2 === 0 ? "Reschedule" : "Returned to Branch" })
      });
      failed += 1;
    } else if (i % 3 !== 0) {
      await asRole("delivery", "/deliveries/complete", {
        method: "POST",
        body: JSON.stringify({ cargoPackageId: pkg.id, deliveredTo: pkg.consigneeName || `QA Receiver ${pad(i)}`, signatureUrl: `/uploads/qa-signature-${pkg.packageNumber}.png`, deliveryPhotoUrl: `/uploads/qa-delivery-${pkg.packageNumber}.jpg`, notes: BATCH, customerAcceptedDamage: true })
      });
      delivered += 1;
    }
  }
  return { arrived: arrived.length, verified, delivered, failed, returns };
}

async function createPaymentsExpensesBilling(customers, trips) {
  const packages = await request("/packages");
  const payable = packages.filter((pkg) => pkg.price != null);
  let payments = 0;
  for (let i = 0; i < payable.length; i += 1) {
    const pkg = payable[i];
    if (i % 5 === 0) continue;
    const due = Number(pkg.price ?? 0);
    const amountPaid = i % 13 === 0 ? Math.round(due * 1.05) : i % 7 === 0 ? Math.round(due * 0.5) : due;
    await asRole(i % 3 === 0 ? "receiving" : i % 3 === 1 ? "delivery" : "daetOwner", "/payments", {
      method: "POST",
      body: JSON.stringify({
        cargoPackageId: pkg.id,
        amountDue: due,
        amountPaid,
        method: pick(paymentMethods),
        collectionPoint: i % 3 === 0 ? "Receiving" : i % 3 === 1 ? "Delivery" : "Owner",
        collectedByName: i % 3 === 0 ? "QA Receiving North" : i % 3 === 1 ? "QA Delivery Daet" : "QA Owner",
        collectedByRole: i % 3 === 0 ? "Receiving Staff" : i % 3 === 1 ? "Delivery Staff" : "Daet Owner",
        branchName: pkg.handlingBranchName ?? pkg.destination,
        proofUrl: i % 4 === 0 ? `/uploads/qa-payment-${pkg.packageNumber}.jpg` : undefined,
        notes: BATCH
      })
    });
    payments += 1;
  }
  let expenses = 0;
  for (let i = 0; i < 350; i += 1) {
    const trip = trips[i % trips.length];
    const expense = await asRole(i % 2 === 0 ? "receiving" : "delivery", "/expenses", {
      method: "POST",
      body: JSON.stringify({
        tripId: trip.id,
        category: pick(expenseCategories),
        amount: money(80, 12000),
        description: `${BATCH} operating expense`,
        receiptUrl: i % 2 === 0 ? `/uploads/qa-expense-${pad(i)}.jpg` : undefined
      })
    });
    if (i % 3 !== 0) {
      await asRole(i % 2 === 0 ? "daetOwner" : "nagaOwner", `/expenses/${expense.id}/approve`, { method: "POST" });
    }
    expenses += 1;
  }
  let invoices = 0;
  for (const [index, customer] of customers.entries()) {
    const ownerRole = index % 2 === 0 ? "daetOwner" : "nagaOwner";
    await asRole(ownerRole, "/billing/invoices", {
      method: "POST",
      body: JSON.stringify({ customerId: customer.id, dueRule: customer.billingTerm || "QA billing rule" })
    });
    await asRole(ownerRole, `/customers/${customer.id}/billing-reminder`, {
      method: "POST",
      body: JSON.stringify({ branchName: customer.businessName.includes("Naga") ? "Naga" : "Daet" })
    });
    invoices += 1;
  }
  return { payments, expenses, invoices };
}

async function createMessagesAndDocuments() {
  const packages = await request("/packages");
  const receiving = await request("/receiving");
  const trips = await request("/trips");
  let messages = 0;
  for (const pkg of packages.filter((_, i) => i % 30 === 0).slice(0, 150)) {
    await request(`/packages/${pkg.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ senderName: "QA Customer Portal", body: `${BATCH} customer message for ${pkg.packageNumber}` })
    });
    messages += 1;
  }
  const docs = { receivingDocuments: 0, receivingSlips: 0, qrLabels: 0, deliveryReceipts: 0, manifests: 0, escpos: 0 };
  for (const record of receiving.slice(0, 120)) {
    await tryRequest(`/receiving/${record.id}/receiving-document`);
    docs.receivingDocuments += 1;
  }
  for (const pkg of packages.slice(0, 300)) {
    await tryRequest(`/packages/${pkg.id}/receiving-slip`);
    docs.receivingSlips += 1;
    await tryRequest(`/packages/${pkg.id}/qr-label`);
    docs.qrLabels += 1;
  }
  for (const pkg of packages.filter((entry) => entry.status === "Delivered").slice(0, 150)) {
    const receipt = await tryRequest(`/packages/${pkg.id}/delivery-receipt`);
    docs.deliveryReceipts += 1;
    if (receipt.ok) {
      await tryRequest("/printing/escpos-preview", {
        method: "POST",
        body: JSON.stringify({ text: receipt.data.text })
      });
      docs.escpos += 1;
    }
  }
  for (const trip of trips.slice(0, 120)) {
    await tryRequest(`/trips/${trip.id}/loading-manifest`);
    docs.manifests += 1;
  }
  return { messages, docs };
}

async function validate() {
  const [bootstrap, packages, trips, receiving, payments, expenses, deliveries, returns, invoices, audit, settings] = await Promise.all([
    request("/bootstrap"),
    request("/packages"),
    request("/trips"),
    request("/receiving"),
    request("/payments"),
    request("/expenses"),
    request("/deliveries"),
    request("/returns"),
    request("/billing/invoices"),
    request("/audit"),
    request("/settings")
  ]);
  const customerIds = new Set(bootstrap.customers.map((item) => item.id));
  const packageIds = new Set(packages.map((item) => item.id));
  const tripIds = new Set(trips.map((item) => item.id));
  const receivingNumbers = new Set(receiving.map((item) => item.recordNumber));
  const errors = [];
  const warnings = [];
  for (const pkg of packages) {
    if (!customerIds.has(pkg.customerId)) errors.push(`Package ${pkg.packageNumber} has missing customer ${pkg.customerId}`);
    if (!receivingNumbers.has(pkg.receivingRecordNumber)) errors.push(`Package ${pkg.packageNumber} has missing receiving ${pkg.receivingRecordNumber}`);
    if (!pkg.qrValue?.includes(pkg.packageNumber)) errors.push(`Package ${pkg.packageNumber} QR mismatch`);
  }
  for (const trip of trips) {
    for (const id of trip.cargoPackageIds) {
      if (!packageIds.has(id)) errors.push(`Trip ${trip.tripNumber} has missing package ${id}`);
    }
  }
  for (const payment of payments) {
    if (!packageIds.has(payment.cargoPackageId)) errors.push(`Payment ${payment.id} has missing package ${payment.cargoPackageId}`);
  }
  for (const expense of expenses) {
    if (expense.tripId && !tripIds.has(expense.tripId)) errors.push(`Expense ${expense.id} has missing trip ${expense.tripId}`);
  }
  for (const delivery of deliveries) {
    if (!packageIds.has(delivery.cargoPackageId)) errors.push(`Delivery ${delivery.id} has missing package ${delivery.cargoPackageId}`);
  }
  for (const record of returns) {
    if (!packageIds.has(record.cargoPackageId)) errors.push(`Return ${record.id} has missing package ${record.cargoPackageId}`);
  }
  if (!bootstrap.customers.length) errors.push("No customers created.");
  if (packages.length !== 5000) errors.push(`Expected 5000 packages, found ${packages.length}.`);
  if (receiving.length !== 500) errors.push(`Expected 500 receiving records, found ${receiving.length}.`);
  if (trips.length !== 150) errors.push(`Expected 150 trips, found ${trips.length}.`);
  if (bootstrap.trucks.length !== 15) errors.push(`Expected 15 saved trucks, found ${bootstrap.trucks.length}.`);
  if (!audit.length) errors.push("No audit records found.");
  if (settings.branches.length < 3) errors.push("Expected at least three branches.");
  const statusCounts = packages.reduce((acc, pkg) => ({ ...acc, [pkg.status]: (acc[pkg.status] ?? 0) + 1 }), {});
  const branchCounts = packages.reduce((acc, pkg) => ({ ...acc, [pkg.handlingBranchName ?? pkg.destination]: (acc[pkg.handlingBranchName ?? pkg.destination] ?? 0) + 1 }), {});
  const paymentTotals = payments.reduce((acc, payment) => {
    acc.amountDue += payment.amountDue;
    acc.amountPaid += payment.amountPaid;
    acc.balance += payment.balance;
    return acc;
  }, { amountDue: 0, amountPaid: 0, balance: 0 });
  if (!Object.keys(branchCounts).includes("Daet") || !Object.keys(branchCounts).includes("Naga")) warnings.push("Branch distribution does not include both Daet and Naga.");
  if (!packages.some((pkg) => pkg.status === "Waiting for Price")) warnings.push("No waiting-for-price cargo remains.");
  if (!payments.some((payment) => payment.amountPaid > payment.amountDue)) warnings.push("No overpayment scenario recorded. Current business logic stores overpayment as Paid with zero balance.");
  warnings.push("Customer role accounts are not actually creatable through current API; simulated customer visibility uses internal Customers module.");
  warnings.push("Drivers are not a separate master table; driver data is embedded in trucks/trips.");
  warnings.push("Document render endpoints do not create persistent print-log records through public API.");
  return {
    counts: {
      customers: bootstrap.customers.length,
      products: (await request("/products")).length,
      trucks: bootstrap.trucks.length,
      receivingRecords: receiving.length,
      packages: packages.length,
      trips: trips.length,
      deliveries: deliveries.length,
      returns: returns.length,
      payments: payments.length,
      expenses: expenses.length,
      invoices: invoices.length,
      auditLogs: audit.length,
      notifications: (await request("/dashboard")).notifications.length
    },
    statusCounts,
    branchCounts,
    paymentTotals,
    errors,
    warnings
  };
}

async function main() {
  const startedAt = Date.now();
  await login();
  const initial = await request("/bootstrap");
  if (initial.customers.some((customer) => !customer.businessName.startsWith("QA-"))) {
    throw new Error("Refusing to run: non-QA customers exist in the environment.");
  }
  console.log("LSOS started");
  const uploads = await Promise.all([
    upload("qa-placeholder", "qa-dr-photo"),
    upload("qa-placeholder", "qa-product-photo"),
    upload("qa-placeholder", "qa-delivery-photo"),
    upload("qa-placeholder", "qa-expense-receipt")
  ]);
  const users = await createQaUsers();
  const customers = await createCustomers();
  const products = await createProducts();
  const trucks = await createTrucks();
  const receiving = await createReceivingRecords(customers, products);
  let packages = await request("/packages");
  const pricingUpdates = await applyPricingChanges(packages);
  packages = await request("/packages");
  const trips = await createTripsAndMoveCargo(packages);
  const movement = await postArrivalAndDelivery(packages);
  const finance = await createPaymentsExpensesBilling(customers, trips);
  const documents = await createMessagesAndDocuments();
  const validation = await validate();
  const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));
  const report = {
    batch: BATCH,
    elapsedSeconds,
    created: {
      qaStaffUsers: users.length,
      customers: customers.length,
      products: products.length,
      savedVehicles: trucks.length,
      receivingRecords: receiving.length,
      packages: validation.counts.packages,
      pricingUpdates,
      trips: trips.length,
      ...movement,
      ...finance,
      messages: documents.messages,
      documents: documents.docs,
      placeholderUploads: uploads.length
    },
    validation,
    performance: {
      recordsPerSecondApprox: Number(((validation.counts.packages + receiving.length + trips.length) / elapsedSeconds).toFixed(2)),
      note: "Generation used API endpoints and service validations; render endpoints were sampled to avoid excessive preview CPU."
    },
    knownImplementationGaps: [
      "Customer user creation/authentication is not implemented beyond role placeholders.",
      "Separate Driver master is not implemented; drivers are embedded in truck/trip fields.",
      "Trip completion endpoint is not implemented; arrived/delivered trips remain active from trip perspective.",
      "Persistent print/reprint logs are not exposed through public document endpoints.",
      "Billing reminders are in-app only; no SMS/email integration exists."
    ]
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
