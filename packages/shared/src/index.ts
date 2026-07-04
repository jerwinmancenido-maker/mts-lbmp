export const APP_NAME = "MTS LBMP";

export const documentPrefixes = {
  receivingRecord: "RR",
  trip: "TR",
  deliveryReceipt: "DR",
  billingStatement: "BS",
  arrivalReport: "AR",
  loadingManifest: "LM",
  waybill: "WB",
  proofOfDelivery: "POD",
  expenseReport: "EX"
} as const;

export type DocumentPrefix = (typeof documentPrefixes)[keyof typeof documentPrefixes];

export const packageConditions = [
  "Good",
  "Damaged",
  "Wet",
  "Incomplete",
  "For Checking",
  "Other"
] as const;

export type PackageCondition = (typeof packageConditions)[number];

export const cargoStatuses = [
  "Draft",
  "Received",
  "Waiting for Price",
  "Waiting for Loading",
  "Loaded",
  "In Transit",
  "Arrived",
  "Ready for Delivery",
  "Delivered",
  "Failed Delivery",
  "Exception",
  "Cancelled"
] as const;

export type CargoStatus = (typeof cargoStatuses)[number];

export const tripStatuses = [
  "Draft",
  "Planned",
  "Loading",
  "Loaded",
  "Departed",
  "Arrived",
  "Unloading",
  "Ready for Delivery",
  "Partially Delivered",
  "Completed",
  "Cancelled",
  "Exception"
] as const;

export type TripStatus = (typeof tripStatuses)[number];

export const paymentStatuses = [
  "Unpaid",
  "Partially Paid",
  "Paid",
  "Overpaid",
  "Voided",
  "Cancelled"
] as const;

export type PaymentStatus = (typeof paymentStatuses)[number];

export const failedDeliveryReasons = [
  "Customer Not Available",
  "Wrong Address",
  "Refused by Receiver",
  "Reschedule Required",
  "Returned to Branch",
  "Returned to Sender"
] as const;

export type FailedDeliveryReason = (typeof failedDeliveryReasons)[number];

export const defaultExpenseCategories = [
  "Fuel",
  "Truck Rental",
  "Driver Allowance",
  "Helper Allowance",
  "Meals",
  "Parking",
  "Repairs",
  "Toll",
  "Labor",
  "Loading / Unloading",
  "Branch Expense",
  "Communication",
  "Miscellaneous",
  "Custom"
] as const;

export const defaultPaymentMethods = [
  "Cash",
  "Bank Transfer",
  "GCash",
  "Maya",
  "Check",
  "Credit Terms",
  "Partial Payment",
  "Upfront Payment",
  "Other",
  "Custom"
] as const;

export function formatDocumentNumber(prefix: string, createdAt: Date, sequence: number) {
  const year = createdAt.getFullYear();
  const month = String(createdAt.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${year}-${month}-${String(sequence).padStart(6, "0")}`;
}

export function buildPackageQrValue(packageId: string) {
  return `MTS:PKG:${packageId}`;
}

export interface CargoPackageSummary {
  id: string;
  packageNumber: string;
  description: string;
  destination: string;
  condition: PackageCondition;
  status: CargoStatus;
  price?: number | null;
  qrValue: string;
}
