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

/**
 * Pure ESC/POS byte builder (Phase 3, audit gap G2).
 *
 * Until now the only byte stream in the product was `toEscPosTextBytes`
 * (ESC @ + UTF-8 text + 3× LF) behind the diagnostic preview endpoint, and
 * the printed Package QR Label carried its QR payload as a plain text line
 * (`QR: MTS:PKG:…`) — no scannable QR code on any route. This module builds
 * a real ESC/POS stream for the QR Label, including the standard `GS ( k`
 * QR commands, so the payload is encoded as an actual QR symbol.
 *
 * SCOPE: this is a library only. No transport sends these bytes anywhere
 * yet — the production route is still the NYX PDF gateway documented in
 * docs/printing/nyx-pdf-contract.md. Wiring a raw ESC/POS channel (NYX
 * service bind or Bluetooth) is device-side work that must be proven on
 * the physical NB80; RISK-001 stays open until paper comes out.
 *
 * Text is encoded as UTF-8, but the label content the renderers produce is
 * pure ASCII (prices print as `PHP 123.00`, no ₱ glyph), and the builder
 * explicitly selects code page PC437 — whose ASCII range is byte-identical
 * to UTF-8's — so the emitted text bytes render the same regardless of the
 * printer's previous code-page state.
 *
 * Placement: this builder lives in this file (the package's single source
 * module, like every @mts-lbmp package) rather than a sibling escpos.ts.
 * The API executes this package from source — packages/printing's
 * package.json `main` is src/index.ts, loaded by Node's type stripping —
 * and plain Node ESM cannot resolve a NodeNext-style `./escpos.js` → `.ts`
 * relative hop (verified: ERR_MODULE_NOT_FOUND at API boot). A separate
 * module file would need build tooling this repo deliberately does not
 * have for packages; the builder stays a pure, separately tested section
 * here instead.
 */

/** Column profiles, consistent with the text renderers' widths. */
export interface EscPosProfile {
  paperWidth: ThermalPaperWidth;
  /** Max printable columns at the profile's font density. */
  columns: number;
}

/**
 * 80mm: 42 cols — the canonical WIDTH_80MM the API renders at (asserted
 * equal by the tests).
 */
export const ESC_POS_PROFILE_80MM: EscPosProfile = { paperWidth: "80mm", columns: WIDTH_80MM };

/** 58mm: 24 cols — the 58mm safe text width used by formatThermalTextForPaper. */
export const ESC_POS_PROFILE_58MM: EscPosProfile = { paperWidth: "58mm", columns: 24 };

export type EscPosAlignment = "left" | "center" | "right";

const ALIGNMENT_CODE: Record<EscPosAlignment, number> = { left: 0, center: 1, right: 2 };

/** ESC/POS QR error-correction levels (GS ( k, function 169, parameter n). */
export const ESC_POS_QR_ERROR_CORRECTION = {
  /** ~7% recovery. */
  L: 48,
  /** ~15% recovery. Chosen default: survives warehouse scuffing/dirt on a
   * label without inflating the symbol the way Q/H would. */
  M: 49,
  /** ~25% recovery. */
  Q: 50,
  /** ~30% recovery. */
  H: 51
} as const;

export interface EscPosQrOptions {
  /** Module (cell) size, 1–16 dots. Default 6: the label payload
   * (`MTS:PKG:<packageNumber>`, ~26 bytes) encodes at EC level M as a
   * version ~3 symbol (29×29 modules), so 6-dot modules give a ~174-dot
   * (~22mm at 203dpi) symbol — comfortably scannable and well inside the
   * printable width of both profiles. */
  moduleSize?: number;
  errorCorrection?: (typeof ESC_POS_QR_ERROR_CORRECTION)[keyof typeof ESC_POS_QR_ERROR_CORRECTION];
}

const encoder = new TextEncoder();

function gsParenK(...bytes: number[]) {
  return [0x1d, 0x28, 0x6b, ...bytes];
}

/**
 * Fluent ESC/POS byte builder. Every method appends to an internal buffer
 * and returns `this`; `build()` returns the composed stream. The builder is
 * pure — no I/O, no printer state — so identical call sequences always
 * produce identical bytes.
 */
export class EscPosBuilder {
  private readonly chunks: Uint8Array[] = [];

  private push(bytes: number[] | Uint8Array): this {
    this.chunks.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    return this;
  }

  /** ESC @ — initialize printer (clears mode settings to power-on defaults). */
  initialize(): this {
    return this.push([0x1b, 0x40]);
  }

  /**
   * ESC t n — select character code table. Default 0 (PC437). Selected
   * explicitly so text bytes do not depend on whatever a previous job left
   * configured on the printer.
   */
  codePage(page = 0): this {
    return this.push([0x1b, 0x74, page]);
  }

  /** ESC a n — set justification for the following text and QR symbol. */
  align(alignment: EscPosAlignment): this {
    return this.push([0x1b, 0x61, ALIGNMENT_CODE[alignment]]);
  }

  /** ESC E n — emphasized (bold) mode on/off. */
  bold(on: boolean): this {
    return this.push([0x1b, 0x45, on ? 1 : 0]);
  }

  /** Raw text with no line terminator. */
  text(value: string): this {
    return this.push(encoder.encode(value));
  }

  /** One text line: the value (split on \n if it contains any) plus LF. */
  line(value = ""): this {
    return this.push(encoder.encode(`${value.replace(/\r/g, "")}\n`));
  }

  /** ESC d n — print the buffer and feed n lines. */
  feed(lines: number): this {
    return this.push([0x1b, 0x64, lines]);
  }

  /**
   * GS ( k — QR Code (Model 2) as four commands:
   *   fn 65  select model:      Model 2 (n = 0)
   *   fn 67  set module size:   `moduleSize` dots
   *   fn 69  set error level:   `errorCorrection` (default M)
   *   fn 80  store the payload: length field = payload byte length + 3,
   *          little-endian (pL, pH), m = 48
   *   fn 81  print the stored symbol (m = 48)
   * The printer centres the symbol when justification is set to center
   * before this call. The payload is stored byte-for-byte as given.
   */
  qrCode(payload: string, options: EscPosQrOptions = {}): this {
    const moduleSize = options.moduleSize ?? 6;
    const errorCorrection = options.errorCorrection ?? ESC_POS_QR_ERROR_CORRECTION.M;
    const data = encoder.encode(payload);
    const storeLength = data.length + 3;
    this.push(gsParenK(0x04, 0x00, 0x31, 0x41, 0x32, 0x00));
    this.push(gsParenK(0x03, 0x00, 0x31, 0x43, moduleSize));
    this.push(gsParenK(0x03, 0x00, 0x31, 0x45, errorCorrection));
    this.push(gsParenK(storeLength & 0xff, (storeLength >> 8) & 0xff, 0x31, 0x50, 0x30));
    this.push(data);
    this.push(gsParenK(0x03, 0x00, 0x31, 0x51, 0x30));
    return this;
  }

  /** GS V 0 — full cut. Printers without a cutter ignore it. */
  cut(): this {
    return this.push([0x1d, 0x56, 0x00]);
  }

  build(): Uint8Array {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }
}

export interface QrLabelEscPosInput {
  packageNumber: string;
  description: string;
  destination: string;
  qrValue: string;
}

/**
 * Composes the ESC/POS byte stream for the Package QR Label.
 *
 * The layout deliberately derives from `renderQrLabel`'s own output (same
 * input, same rendered lines), so the byte stream and the text label can
 * never diverge in content: company + title become centred bold lines, the
 * body lines print left-aligned as rendered, and the renderer's
 * `QR: <qrValue>` line is replaced by a real QR symbol (centred) with the
 * human-readable qrValue printed under it. For the 58mm profile the body
 * lines go through the same explicit down-wrap the text route uses
 * (`formatThermalTextForPaper`); the QR payload itself is never wrapped —
 * it travels inside the GS ( k store command, not as text.
 */
export function buildQrLabelEscPos(
  input: QrLabelEscPosInput,
  profile: EscPosProfile = ESC_POS_PROFILE_80MM,
  qrOptions: EscPosQrOptions = {}
): Uint8Array {
  const rendered = renderQrLabel(input);
  const renderedLines = rendered.replace(/\n$/, "").split("\n");
  const qrLineIndex = renderedLines.findIndex((line) => line.startsWith("QR: "));
  const bodyLines = renderedLines.filter((_, index) => index !== qrLineIndex);
  const displayLines =
    profile.paperWidth === "58mm"
      ? formatThermalTextForPaper(bodyLines.join("\n"), "58mm").replace(/\n$/, "").split("\n")
      : bodyLines;

  const builder = new EscPosBuilder();
  builder.initialize().codePage(0);

  displayLines.forEach((line, index) => {
    if (index === 0) {
      // Company name + document title: the renderer centres them with
      // padding; the byte stream centres them with ESC a + bold instead.
      builder.align("center").bold(true).line(line.trim());
    } else if (index === 1) {
      builder.line(line.trim()).bold(false).align("left");
    } else {
      builder.line(line);
    }

    // The QR symbol sits exactly where the renderer's `QR: …` line was:
    // immediately after the divider line that precedes it. In displayLines
    // (which excludes the QR line itself) that divider is at
    // qrLineIndex - 1, the same index it had in the rendered line list.
    if (qrLineIndex >= 0 && index === qrLineIndex - 1) {
      builder.align("center").qrCode(input.qrValue, qrOptions).line(input.qrValue).align("left");
    }
  });

  builder.feed(3).cut();
  return builder.build();
}
