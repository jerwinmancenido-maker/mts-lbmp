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

const WIDTH_80MM = 42;

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
