export const permissions = [
  "settings.manage",
  "audit.view",
  "users.manage",
  "roles.manage",
  "customers.manage",
  "receiving.create",
  "receiving.view",
  "receiving.edit",
  "receiving.print",
  "pricing.edit",
  "pricing.view",
  "packages.view",
  "trips.create",
  "trips.view",
  "trips.edit",
  "loading.scan",
  "loading.override",
  "arrival.scan",
  "delivery.complete",
  "delivery.fail",
  "payments.record",
  "payments.verify",
  "payments.edit",
  "payments.void",
  "expenses.create",
  "expenses.approve",
  "documents.print",
  "documents.reprint",
  "messages.reply",
  "reports.view",
  "records.softDelete",
  "records.restore"
] as const;

export type Permission = (typeof permissions)[number];

/**
 * AUTHORIZATION SOURCE OF TRUTH (Phase 5 P5-4, CR-006): these role
 * presets are the one place role→permission authorization is decided.
 * The auth guard reads them on every request. The database's Role /
 * Permission / RolePermission tables exist in the schema but are
 * deliberately NEVER written or read for authorization — keeping the
 * presets in code means every authorization change is a reviewed,
 * tested code change, and there is no second, driftable copy of the
 * truth in the database. Do not start persisting RolePermission rows
 * without a new change-control decision superseding CR-006.
 */
export const rolePresets: Record<string, Permission[]> = {
  Administrator: [...permissions],
  "System Admin": [...permissions],
  "Daet Owner": [
    "packages.view",
    "audit.view",
    "customers.manage",
    "receiving.view",
    "receiving.edit",
    "pricing.view",
    "pricing.edit",
    "trips.create",
    "trips.view",
    "trips.edit",
    "loading.scan",
    "loading.override",
    "arrival.scan",
    "delivery.complete",
    "delivery.fail",
    "payments.record",
    "payments.verify",
    "payments.edit",
    "expenses.create",
    "expenses.approve",
    "documents.print",
    "documents.reprint",
    "messages.reply",
    "settings.manage",
    "users.manage",
    "reports.view",
    "records.softDelete",
    "records.restore"
  ],
  "Naga Owner": [
    "packages.view",
    "audit.view",
    "customers.manage",
    "receiving.view",
    "receiving.edit",
    "pricing.view",
    "pricing.edit",
    "trips.create",
    "trips.view",
    "trips.edit",
    "loading.scan",
    "loading.override",
    "arrival.scan",
    "delivery.complete",
    "delivery.fail",
    "payments.record",
    "payments.verify",
    "payments.edit",
    "expenses.create",
    "expenses.approve",
    "documents.print",
    "documents.reprint",
    "messages.reply",
    "settings.manage",
    "users.manage",
    "reports.view",
    "records.softDelete",
    "records.restore"
  ],
  "Receiving Staff": [
    "packages.view",
    "customers.manage",
    "receiving.create",
    "receiving.view",
    "receiving.edit",
    "receiving.print",
    "pricing.view",
    "pricing.edit",
    "trips.create",
    "trips.view",
    "loading.scan",
    "payments.record",
    "documents.print",
    "documents.reprint",
    "expenses.create",
    "messages.reply"
  ],
  "Delivery Staff": [
    "packages.view",
    "trips.view",
    "arrival.scan",
    "delivery.complete",
    "delivery.fail",
    "payments.record",
    "expenses.create",
    "documents.print",
    "documents.reprint",
    "messages.reply"
  ],
  "Delivery Admin": [
    "packages.view",
    "trips.view",
    "arrival.scan",
    "delivery.complete",
    "delivery.fail",
    "payments.record",
    "payments.verify",
    "expenses.create",
    "documents.print",
    "documents.reprint",
    "messages.reply",
    "reports.view"
  ],
  "Customer Owner": [],
  "Customer Accounting": [],
  "Customer Operations": [],
  "Customer Viewer": []
};

export function hasPermission(userPermissions: string[], permission: Permission) {
  return userPermissions.includes(permission);
}
