const API_URL = process.env.API_URL ?? "http://localhost:4100";

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function login(email) {
  const response = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "password" })
  });
  if (response.status !== 201) throw new Error(`Login failed for ${email}: ${response.text}`);
  return JSON.parse(response.text).token;
}

const ownerToken = await login("daet.owner@mts.local");
const deliveryToken = await login("delivery@mts.local");

const dashboardWithoutToken = await request("/dashboard");
const bootstrapPublic = await request("/bootstrap");
const protectedAsDelivery = await request("/expenses/non-existent/approve", {
  method: "POST",
  headers: { Authorization: `Bearer ${deliveryToken}` }
});
const protectedAsOwner = await request("/dashboard", {
  headers: { Authorization: `Bearer ${ownerToken}` }
});
const auditAsDelivery = await request("/audit", {
  headers: { Authorization: `Bearer ${deliveryToken}` }
});
const auditAsOwner = await request("/audit", {
  headers: { Authorization: `Bearer ${ownerToken}` }
});
const settingsAsDelivery = await request("/settings", {
  headers: { Authorization: `Bearer ${deliveryToken}` }
});
const settingsAsOwner = await request("/settings", {
  headers: { Authorization: `Bearer ${ownerToken}` }
});
const hardwareAsDelivery = await request("/hardware/tests", {
  headers: { Authorization: `Bearer ${deliveryToken}` }
});
const hardwareAsOwner = await request("/hardware/tests", {
  headers: { Authorization: `Bearer ${ownerToken}` }
});

const result = {
  ok: true,
  dashboardWithoutToken: dashboardWithoutToken.status,
  bootstrapPublic: bootstrapPublic.status,
  deliveryCannotApproveExpense: protectedAsDelivery.status,
  ownerDashboard: protectedAsOwner.status,
  deliveryCannotViewAudit: auditAsDelivery.status,
  ownerCanViewAudit: auditAsOwner.status,
  deliveryCannotManageSettings: settingsAsDelivery.status,
  ownerCanManageSettings: settingsAsOwner.status,
  deliveryCannotManageHardwareTests: hardwareAsDelivery.status,
  ownerCanManageHardwareTests: hardwareAsOwner.status
};

if (result.dashboardWithoutToken !== 403) throw new Error("Dashboard should reject missing token");
if (result.bootstrapPublic !== 200) throw new Error("Bootstrap should be public");
if (result.deliveryCannotApproveExpense !== 403) throw new Error("Delivery user should not approve expenses");
if (result.ownerDashboard !== 200) throw new Error("Owner should access dashboard");
if (result.deliveryCannotViewAudit !== 403) throw new Error("Delivery user should not view audit");
if (result.ownerCanViewAudit !== 200) throw new Error("Owner should view audit");
if (result.deliveryCannotManageSettings !== 403) throw new Error("Delivery user should not manage settings");
if (result.ownerCanManageSettings !== 200) throw new Error("Owner should manage settings");
if (result.deliveryCannotManageHardwareTests !== 403) throw new Error("Delivery user should not manage hardware tests");
if (result.ownerCanManageHardwareTests !== 200) throw new Error("Owner should manage hardware tests");

console.log(JSON.stringify(result, null, 2));
