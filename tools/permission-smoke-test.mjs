/**
 * Permission smoke gate: positive checks run as the provisioned smoke admin
 * account, negative checks as the provisioned limited (Delivery Staff)
 * account — NOT the demo accounts. Credentials come from SMOKE_EMAIL /
 * SMOKE_PASSWORD and SMOKE_LIMITED_EMAIL / SMOKE_LIMITED_PASSWORD (see
 * tools/smoke-credentials.mjs for the env vars, the ALLOW_DEMO_AUTH-gated
 * seed hook that provisions the accounts, and the local defaults).
 *
 * Phase 5 P5-3 flipped the /bootstrap assertions: the FULL bootstrap now
 * requires a token (403 without one, 200 with the owner's), and the
 * public route /bootstrap/public must return only the reduced projection
 * — company branding, branch names, payment/expense defaults — asserted
 * here by key scan: no users/customers/trucks keys and no staff email
 * anywhere in the payload.
 */
import { resolveSmokeCredentials } from "./smoke-credentials.mjs";

const API_URL = process.env.API_URL ?? "http://localhost:4100";
const smoke = resolveSmokeCredentials();

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function login(email, password) {
  const response = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  if (response.status !== 201) throw new Error(`Login failed for ${email}: ${response.text}`);
  return JSON.parse(response.text).token;
}

const ownerToken = await login(smoke.email, smoke.password);
const deliveryToken = await login(smoke.limitedEmail, smoke.limitedPassword);

const dashboardWithoutToken = await request("/dashboard");
const bootstrapWithoutToken = await request("/bootstrap");
const bootstrapAsOwner = await request("/bootstrap", {
  headers: { Authorization: `Bearer ${ownerToken}` }
});
const publicBootstrap = await request("/bootstrap/public");
let publicBootstrapBody = null;
try {
  publicBootstrapBody = JSON.parse(publicBootstrap.text);
} catch {
  publicBootstrapBody = null;
}
const publicBootstrapKeys = publicBootstrapBody ? Object.keys(publicBootstrapBody) : [];
const publicBootstrapLeaks = ["users", "customers", "trucks"].some((key) => publicBootstrapKeys.includes(key))
  || publicBootstrap.text.includes(smoke.email)
  || publicBootstrap.text.includes(smoke.limitedEmail)
  || publicBootstrap.text.includes("@mts.local");
const publicBootstrapHasIntakeData = Boolean(publicBootstrapBody?.companyProfile?.companyName)
  && Array.isArray(publicBootstrapBody?.branches)
  && publicBootstrapBody.branches.every((branch) => typeof branch?.name === "string")
  && Array.isArray(publicBootstrapBody?.defaultPaymentMethods)
  && Array.isArray(publicBootstrapBody?.defaultExpenseCategories);
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
  bootstrapWithoutToken: bootstrapWithoutToken.status,
  bootstrapAsOwner: bootstrapAsOwner.status,
  publicBootstrap: publicBootstrap.status,
  publicBootstrapLeaks,
  publicBootstrapHasIntakeData,
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
if (result.bootstrapWithoutToken !== 403) throw new Error("Full bootstrap should reject missing token");
if (result.bootstrapAsOwner !== 200) throw new Error("Owner should access the full bootstrap");
if (result.publicBootstrap !== 200) throw new Error("Public bootstrap projection should be public");
if (result.publicBootstrapLeaks) throw new Error("Public bootstrap projection must not contain users/customers/trucks or staff emails");
if (!result.publicBootstrapHasIntakeData) throw new Error("Public bootstrap projection should carry company branding, branch names and the payment/expense defaults");
if (result.deliveryCannotApproveExpense !== 403) throw new Error("Delivery user should not approve expenses");
if (result.ownerDashboard !== 200) throw new Error("Owner should access dashboard");
if (result.deliveryCannotViewAudit !== 403) throw new Error("Delivery user should not view audit");
if (result.ownerCanViewAudit !== 200) throw new Error("Owner should view audit");
if (result.deliveryCannotManageSettings !== 403) throw new Error("Delivery user should not manage settings");
if (result.ownerCanManageSettings !== 200) throw new Error("Owner should manage settings");
if (result.deliveryCannotManageHardwareTests !== 403) throw new Error("Delivery user should not manage hardware tests");
if (result.ownerCanManageHardwareTests !== 200) throw new Error("Owner should manage hardware tests");

console.log(JSON.stringify(result, null, 2));
