import type { AgingBucket } from "./logistics.types.js";

/**
 * Phase 6 P6-3 — statement CSV builders (pure; the service gathers the
 * data, these functions only shape bytes).
 *
 * The endpoints generate-and-stream (Phase 6 audit §5.2a): nothing is
 * persisted, so the CSV is built from the same live derivations the
 * screens read — invoices through deriveBillingInvoice, customer
 * statements through buildCustomerBalance — and can never disagree
 * with them.
 *
 * Byte-level decisions (all deliberate, all Excel-facing):
 * - UTF-8 WITH BOM. Excel on Windows opens a BOM-less UTF-8 CSV as
 *   ANSI, which garbles non-ASCII names/descriptions. The BOM makes
 *   the encoding unambiguous; Google Sheets and LibreOffice accept it
 *   too.
 * - CRLF row separators and RFC 4180 quoting (quote a field when it
 *   contains a comma, a quote, CR or LF; double internal quotes).
 * - Money cells are PLAIN NUMBERS with two decimals — no currency
 *   symbols, no thousands separators — so amounts land as numbers in a
 *   spreadsheet, not text. Peso signs live in the printed statement,
 *   not here.
 * - Every money value is rounded to 2dp per line and totals are the
 *   sums of those rounded line values, so a totals row sums EXACTLY
 *   as displayed — no "off by a centavo" footing.
 */

const CSV_BOM = "\uFEFF";

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(fields: Array<string | number>): string {
  return fields.map(csvField).join(",");
}

function csvDocument(rows: Array<Array<string | number>>): string {
  return CSV_BOM + rows.map(csvRow).join("\r\n") + "\r\n";
}

/** Round to centavos the way the displayed cells show them. */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number): string {
  return roundMoney(value).toFixed(2);
}

/**
 * Filename-safe fragment for Content-Disposition: anything outside
 * [A-Za-z0-9] collapses to a dash (quotes, commas, spaces, accents),
 * edges trimmed, length capped. Falls back so a filename always has a
 * subject.
 */
export function sanitizeCsvFilenamePart(value: string, fallback = "customer"): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return cleaned || fallback;
}

/** Aging bucket wording for CSV rows — mirrors the web shell's labels (ASCII hyphens for spreadsheet safety). */
export function agingBucketCsvLabel(bucket: AgingBucket): string {
  return {
    current: "Current",
    overdue1To30: "1-30 days overdue",
    overdue31To60: "31-60 days overdue",
    overdue61To90: "61-90 days overdue",
    overdue90Plus: "90+ days overdue",
    termsNotSet: "Terms not set",
    notDelivered: "Not yet delivered"
  }[bucket];
}

const AGING_BUCKET_ORDER: AgingBucket[] = [
  "current",
  "overdue1To30",
  "overdue31To60",
  "overdue61To90",
  "overdue90Plus",
  "termsNotSet",
  "notDelivered"
];

export interface InvoiceStatementCsvLine {
  packageNumber: string;
  description: string;
  /** "Consignee / destination" as one display cell (a statement column, not two). */
  consigneeDestination: string;
  /** Manila business date (YYYY-MM-DD); absent when the package has no delivery record. */
  deliveryDate?: string;
  amountDue: number;
  amountPaid: number;
}

export interface InvoiceStatementCsvInput {
  invoiceNumber: string;
  customerName: string;
  /** Manila business date (YYYY-MM-DD) the invoice was issued. */
  issuedDate: string;
  /** Manila business date (YYYY-MM-DD); absent when no due date could be derived. */
  dueDate?: string;
  /** The invoice's DERIVED status (deriveBillingInvoice), never the stored snapshot. */
  status: string;
  dueRule: string;
  lines: InvoiceStatementCsvLine[];
}

/**
 * One invoice as a spreadsheet: a key/value header block (invoice
 * number, customer, issued/due dates, derived status, terms), a blank
 * separator row, then the line table with a TOTAL row.
 *
 * Line balances are due − paid UNCLAMPED: an overpaid line shows a
 * negative balance (a credit) rather than hiding it, and that keeps
 * the arithmetic identity TOTAL balance = TOTAL due − TOTAL paid true
 * on the face of the file. (The app screens clamp the invoice balance
 * at 0; a statement of account shows the arithmetic.)
 */
export function buildInvoiceStatementCsv(input: InvoiceStatementCsvInput): string {
  let totalDue = 0;
  let totalPaid = 0;
  let totalBalance = 0;
  const lineRows = input.lines.map((line) => {
    const due = roundMoney(line.amountDue);
    const paid = roundMoney(line.amountPaid);
    const balance = roundMoney(due - paid);
    totalDue += due;
    totalPaid += paid;
    totalBalance += balance;
    return [
      line.packageNumber,
      line.description,
      line.consigneeDestination,
      line.deliveryDate ?? "",
      money(due),
      money(paid),
      money(balance)
    ];
  });
  return csvDocument([
    ["Invoice Number", input.invoiceNumber],
    ["Customer", input.customerName],
    ["Issued Date", input.issuedDate],
    ["Due Date", input.dueDate ?? "Not set"],
    ["Status", input.status],
    ["Terms", input.dueRule],
    [],
    ["Package Number", "Description", "Consignee / Destination", "Delivery Date", "Amount Due", "Amount Paid", "Balance"],
    ...lineRows,
    ["TOTAL", "", "", "", money(totalDue), money(totalPaid), money(totalBalance)]
  ]);
}

export interface CustomerStatementCsvLine {
  packageNumber: string;
  description: string;
  consigneeDestination: string;
  deliveredDate?: string;
  dueDate?: string;
  daysOverdue: number;
  agingBucket: AgingBucket;
  amountDue: number;
  amountPaid: number;
  /** The balance payload's per-package outstanding (clamped at 0 by the derivation). */
  outstanding: number;
}

export interface CustomerStatementCsvInput {
  customerName: string;
  /** Manila business date (YYYY-MM-DD) the statement was generated. */
  statementDate: string;
  /** Fixed-list term label (e.g. "Net 7"), or undefined when no structured term is set. */
  billingTermsLabel?: string;
  /** From the balance payload: Σ price over ALL the customer's (visible) priced packages. */
  totalDue: number;
  /** From the balance payload: Σ payments over the customer's (visible) packages. */
  totalCollected: number;
  /** From the balance payload: Σ per-package outstanding — equals the line table's Outstanding total by construction. */
  totalOutstanding: number;
  lines: CustomerStatementCsvLine[];
  aging: Record<AgingBucket, { amount: number; count: number }>;
}

/**
 * One customer's outstanding statement: header block carrying the
 * balance payload's headline figures, the owing-package table (the
 * payload's rows, oldest due first — the payload's own order), a
 * TOTAL row over those owing rows, and the payload's aging split.
 *
 * The line table covers OWING packages only, so its Amount Due /
 * Amount Paid totals are the owing subset — labelled as such. The
 * Outstanding total and every aging figure are the payload's own
 * numbers, so the file and GET /customers/:id/balance cannot disagree.
 */
export function buildCustomerStatementCsv(input: CustomerStatementCsvInput): string {
  let totalDue = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;
  const lineRows = input.lines.map((line) => {
    const due = roundMoney(line.amountDue);
    const paid = roundMoney(line.amountPaid);
    const outstanding = roundMoney(line.outstanding);
    totalDue += due;
    totalPaid += paid;
    totalOutstanding += outstanding;
    return [
      line.packageNumber,
      line.description,
      line.consigneeDestination,
      line.deliveredDate ?? "",
      line.dueDate ?? "",
      line.daysOverdue,
      agingBucketCsvLabel(line.agingBucket),
      money(due),
      money(paid),
      money(outstanding)
    ];
  });
  const agingRows = AGING_BUCKET_ORDER.filter((bucket) => input.aging[bucket].count > 0).map((bucket) => [
    agingBucketCsvLabel(bucket),
    input.aging[bucket].count,
    money(input.aging[bucket].amount)
  ]);
  return csvDocument([
    ["Customer", input.customerName],
    ["Statement Date", input.statementDate],
    ["Billing Terms", input.billingTermsLabel ?? "Not set"],
    ["Total Due", money(input.totalDue)],
    ["Total Collected", money(input.totalCollected)],
    ["Total Outstanding", money(input.totalOutstanding)],
    [],
    [
      "Package Number",
      "Description",
      "Consignee / Destination",
      "Delivered Date",
      "Due Date",
      "Days Overdue",
      "Aging",
      "Amount Due",
      "Amount Paid",
      "Outstanding"
    ],
    ...lineRows,
    ["TOTAL (owing packages)", "", "", "", "", "", "", money(totalDue), money(totalPaid), money(totalOutstanding)],
    [],
    ["Aging Summary"],
    ["Bucket", "Packages", "Amount"],
    ...agingRows
  ]);
}
