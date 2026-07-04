export const documentTypes = [
  "Receiving Slip",
  "QR Label",
  "Waybill",
  "Trip Sheet",
  "Loading Manifest",
  "Arrival Report",
  "Delivery Receipt",
  "Proof of Delivery",
  "Billing Statement",
  "Payment Receipt",
  "Expense Summary"
] as const;

export type DocumentType = (typeof documentTypes)[number];
