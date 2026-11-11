export interface ReceiptLineItem {
  label: string;
  value: string;
}

export interface ReceiptTemplateInput {
  title: string;
  documentNumber: string;
  companyName?: string;
  lines: ReceiptLineItem[];
  qrValue?: string;
  footer?: string;
}

export const WIDTH_80MM = 42;
const SAFE_TEXT_WIDTH_BY_PAPER = {
  "58mm": 24,
  "80mm": 34
} as const;

export type ThermalPaperWidth = keyof typeof SAFE_TEXT_WIDTH_BY_PAPER;

function center(text: string) {
  return text.length >= WIDTH_80MM ? text : text.padStart(Math.floor((WIDTH_80MM + text.length) / 2));
}

function divider() {
  return "-".repeat(WIDTH_80MM);
}

export function render80mmReceipt(input: ReceiptTemplateInput) {
  const lines = [
    center(input.companyName ?? "MANCENIDO TRUCKING SERVICES"),
    center(input.title),
    input.documentNumber,
    divider(),
    ...input.lines.map((line) => `${line.label}: ${line.value}`),
    divider()
  ];

  if (input.qrValue) {
    lines.push(`QR: ${input.qrValue}`);
    lines.push(divider());
  }

  lines.push(input.footer ?? "Thank you.");
  return `${lines.join("\n")}\n`;
}

function centerForWidth(text: string, width: number) {
  const trimmed = text.trim();
  if (trimmed.length >= width) return trimmed;
  return trimmed.padStart(Math.floor((width + trimmed.length) / 2));
}

function splitLongToken(token: string, width: number) {
  const parts: string[] = [];
  let remaining = token;
  while (remaining.length > width) {
    parts.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function wrapThermalLine(line: string, width: number) {
  const normalized = line.replace(/\s+/g, " ").trimEnd();
  if (!normalized.trim()) return [""];
  if (/^-{8,}$/.test(normalized.trim())) return ["-".repeat(width)];

  const withoutLeading = normalized.trimStart();
  const isCenteredSource = normalized.length > withoutLeading.length && !withoutLeading.includes(":");
  const source = isCenteredSource ? withoutLeading.trim() : normalized.trim();
  const wrapped: string[] = [];
  let current = "";

  for (const rawToken of source.split(" ")) {
    const tokenParts = rawToken.length > width ? splitLongToken(rawToken, width) : [rawToken];
    for (const token of tokenParts) {
      if (!current) {
        current = token;
      } else if (`${current} ${token}`.length <= width) {
        current = `${current} ${token}`;
      } else {
        wrapped.push(current);
        current = token;
      }
    }
  }

  if (current) wrapped.push(current);
  return isCenteredSource ? wrapped.map((value) => centerForWidth(value, width)) : wrapped;
}

export function formatThermalTextForPaper(text: string, paperWidth: ThermalPaperWidth) {
  const width = SAFE_TEXT_WIDTH_BY_PAPER[paperWidth];
  return `${text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((line) => wrapThermalLine(line, width))
    .join("\n")}\n`;
}

/**
 * Prepares API-rendered text for the native (Android/NYX) print route.
 *
 * The API renders every document at WIDTH_80MM (42 cols) and that layout is
 * canonical: for 80mm paper the text is handed to the printer exactly as
 * rendered. The NYX plugin's PDF page is 227pt wide with 18pt padding on
 * each side (191pt usable) and its 7.2pt monospace font advances
 * ~4.32pt/char, so a 42-col line measures ~181pt and fits un-wrapped. The
 * old silent re-wrap to a 34-col "safe" width shrank dividers and
 * re-centred headers for no benefit, so it no longer happens.
 *
 * 58mm paper is narrower than the 80mm layout, so there the text is
 * deliberately down-wrapped to the 58mm safe width via
 * formatThermalTextForPaper — an explicit adaptation, not a silent shrink.
 */
export function prepareTextForPrint(text: string, paperWidth: ThermalPaperWidth) {
  if (paperWidth === "80mm") {
    const normalized = text.replace(/\r/g, "");
    return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  }
  return formatThermalTextForPaper(text, paperWidth);
}

export interface ReceivingSlipInput {
  documentNumber: string;
  packageNumber: string;
  customerName: string;
  description: string;
  quantity?: number | null;
  unit?: string | null;
  handlingBranchName?: string | null;
  destination: string;
  deliveryType?: string | null;
  city?: string | null;
  province?: string | null;
  condition: string;
  weight?: number | null;
  weightUnit?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  dimensionUnit?: string | null;
  unitPrice?: number | null;
  price?: number | null;
  qrValue: string;
  printLine: string;
  copyNumber: number;
}

export function renderReceivingSlip(input: ReceivingSlipInput) {
  const measurement = [
    input.weight != null ? `${input.weight} ${input.weightUnit ?? "kg"}` : "",
    [input.length, input.width, input.height].some((value) => value != null) ? `${input.length ?? "?"} x ${input.width ?? "?"} x ${input.height ?? "?"} ${input.dimensionUnit ?? "cm"}` : ""
  ].filter(Boolean).join(" / ");
  return render80mmReceipt({
    title: "RECEIVING SLIP",
    documentNumber: input.documentNumber,
    lines: [
      { label: "Package", value: input.packageNumber },
      { label: "Customer", value: input.customerName },
      { label: "Description", value: input.description },
      { label: "Qty", value: `${input.quantity ?? 1} ${input.unit ?? "pcs"}` },
      { label: "Handling Branch", value: input.handlingBranchName ?? input.destination },
      { label: "Delivery Type", value: input.deliveryType ?? "Deliver to consignee" },
      { label: "Delivery Area", value: [input.city, input.province].filter(Boolean).join(", ") || "Not provided" },
      { label: "Condition", value: input.condition },
      ...(measurement ? [{ label: "Weight/Size", value: measurement }] : []),
      ...(input.unitPrice != null ? [{ label: "Unit Price", value: `PHP ${input.unitPrice.toFixed(2)}` }] : []),
      { label: "Price", value: input.price == null ? "Waiting for Price" : `PHP ${input.price.toFixed(2)}` },
      { label: "Print", value: input.printLine },
      { label: "Copy", value: String(input.copyNumber) }
    ],
    qrValue: input.qrValue,
    footer: "Signature: __________________"
  });
}

export interface ReceivingDocumentItemInput {
  quantity?: number | null;
  unit?: string | null;
  description: string;
  handlingBranchName?: string | null;
  destination: string;
  price?: number | null;
}

export interface ReceivingDocumentInput {
  recordNumber: string;
  customerName: string;
  customerDrNumber?: string | null;
  destination: string;
  packages: ReceivingDocumentItemInput[];
  copyLine: string;
}

export function renderReceivingDocument(input: ReceivingDocumentInput) {
  const totalQuantity = input.packages.reduce((sum, cargo) => sum + (cargo.quantity ?? 1), 0);
  const totalPrice = input.packages.reduce((sum, cargo) => sum + (cargo.price ?? 0), 0);
  const withoutPrice = input.packages.filter((cargo) => cargo.price == null).length;
  const branchSummary = Array.from(new Set(input.packages.map((cargo) => cargo.handlingBranchName ?? cargo.destination))).join(" / ");
  const itemLines = input.packages.map((cargo, index) => {
    const quantity = `${cargo.quantity ?? 1} ${cargo.unit ?? "pcs"}`;
    const branch = cargo.handlingBranchName ?? cargo.destination;
    const price = cargo.price == null ? "NP" : `P${Math.round(cargo.price)}`;
    const compactDescription = cargo.description.length > 22 ? `${cargo.description.slice(0, 21)}...` : cargo.description;
    return {
      label: `${index + 1}`,
      value: `${quantity} ${compactDescription} / ${branch} / ${price}`
    };
  });

  return render80mmReceipt({
    title: "RECEIVING RECEIPT",
    documentNumber: input.recordNumber,
    lines: [
      { label: "Customer", value: input.customerName },
      { label: "DR", value: input.customerDrNumber ?? "Not provided" },
      { label: "Branch", value: branchSummary || input.destination },
      { label: "Items", value: `${input.packages.length} lines / Qty ${totalQuantity}` },
      { label: "Total", value: withoutPrice ? `PHP ${totalPrice.toFixed(2)} / ${withoutPrice} no price` : `PHP ${totalPrice.toFixed(2)}` },
      ...itemLines,
      { label: "Copy", value: input.copyLine }
    ],
    footer: "Received By: _______________"
  });
}

export interface CargoPrintRow {
  packageNumber: string;
  description: string;
  destination: string;
  status?: string;
  price?: number | null;
}

export function renderLoadingManifest(input: {
  tripNumber: string;
  origin: string;
  destination: string;
  vehicle?: string;
  driver?: string;
  cargo: CargoPrintRow[];
  auditLine?: string;
}) {
  return render80mmReceipt({
    title: "LOADING MANIFEST",
    documentNumber: input.tripNumber,
    lines: [
      { label: "Origin", value: input.origin },
      { label: "Destination", value: input.destination },
      { label: "Vehicle", value: input.vehicle ?? "Not set" },
      { label: "Driver", value: input.driver ?? "Not set" },
      { label: "Cargo Count", value: String(input.cargo.length) },
      ...input.cargo.flatMap((cargo, index) => [
        { label: `${index + 1}. Package`, value: cargo.packageNumber },
        { label: "Desc", value: cargo.description },
        { label: "Dest", value: cargo.destination }
      ]),
      ...(input.auditLine ? [{ label: "Print", value: input.auditLine }] : [])
    ],
    footer: "Loaded By: ________________"
  });
}

export function renderDeliveryReceipt(input: {
  documentNumber: string;
  packageNumber: string;
  customerName: string;
  description: string;
  destination: string;
  deliveredTo: string;
  price?: number | null;
  paymentStatus?: string;
  qrValue: string;
}) {
  return render80mmReceipt({
    title: "DELIVERY RECEIPT",
    documentNumber: input.documentNumber,
    lines: [
      { label: "Package", value: input.packageNumber },
      { label: "Customer", value: input.customerName },
      { label: "Description", value: input.description },
      { label: "Destination", value: input.destination },
      { label: "Delivered To", value: input.deliveredTo },
      { label: "Price", value: input.price == null ? "For confirmation" : `PHP ${input.price.toFixed(2)}` },
      { label: "Payment", value: input.paymentStatus ?? "Unpaid" }
    ],
    qrValue: input.qrValue,
    footer: "Recipient Signature: __________"
  });
}

export function renderQrLabel(input: { packageNumber: string; description: string; destination: string; qrValue: string }) {
  return render80mmReceipt({
    title: "PACKAGE QR LABEL",
    documentNumber: input.packageNumber,
    lines: [
      { label: "Description", value: input.description },
      { label: "Destination", value: input.destination }
    ],
    qrValue: input.qrValue,
    footer: "Attach label securely"
  });
}

export function toEscPosTextBytes(text: string) {
  const encoder = new TextEncoder();
  const init = new Uint8Array([0x1b, 0x40]);
  const body = encoder.encode(text);
  const feed = new Uint8Array([0x0a, 0x0a, 0x0a]);
  const merged = new Uint8Array(init.length + body.length + feed.length);
  merged.set(init, 0);
  merged.set(body, init.length);
  merged.set(feed, init.length + body.length);
  return Array.from(merged);
}

/**
 * One measured check from the client-side printer diagnostic (Device Setup).
 * Checks are produced on the device (plugin presence, gateway route, test
 * payload hand-off) and posted to the API, which derives the persisted
 * printer result from them — the printer row of a HardwareTestRecord is no
 * longer a manually self-attested dropdown value.
 */
export interface PrinterDiagnosticCheck {
  name: string;
  status: "Pass" | "Fail";
  detail?: string;
}

export interface PrinterDiagnosticSummary {
  printerResult: "Pass" | "Fail";
  notes: string;
}

/**
 * Derives the persisted printer result + human-readable breakdown from the
 * checks a diagnostic run actually performed. Pass requires at least one
 * check and every check passing; anything else is a Fail. The notes string
 * is what gets stored on the HardwareTestRecord, so it must carry the full
 * per-check breakdown (name → result/error).
 */
export function summarizePrinterDiagnostic(checks: PrinterDiagnosticCheck[]): PrinterDiagnosticSummary {
  const breakdown = checks.length
    ? checks.map((check) => `${check.name}: ${check.status}${check.detail ? ` — ${check.detail}` : ""}`).join("; ")
    : "No checks ran";
  const printerResult: "Pass" | "Fail" =
    checks.length > 0 && checks.every((check) => check.status === "Pass") ? "Pass" : "Fail";
  return { printerResult, notes: `Printer diagnostic: ${breakdown}` };
}
