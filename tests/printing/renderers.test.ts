// Golden tests for the five printed documents (Phase 3, audit gaps G1 + G3).
//
// The golden files under ./golden were captured from the pre-refactor code
// (the Receiving Slip / Receiving Document composition still lived inline in
// LogisticsService then), so these tests also prove the extraction of those
// two renderers into @mts-lbmp/printing changed no output byte.
//
// Every document is composed at the canonical WIDTH_80MM (42 cols). The one
// known exception is locked deliberately: the Loading Manifest's "Print:"
// audit line embeds an ISO timestamp and is 48 chars — it is asserted
// verbatim below instead of being hidden or shortened.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  WIDTH_80MM,
  renderDeliveryReceipt,
  renderLoadingManifest,
  renderQrLabel,
  renderReceivingDocument,
  renderReceivingSlip
} from "@mts-lbmp/printing";

function golden(name: string) {
  return readFileSync(new URL(`./golden/${name}`, import.meta.url), "utf8");
}

function expectWithinRenderWidth(text: string, allowLonger: (line: string) => boolean = () => false) {
  for (const line of text.split("\n")) {
    if (allowLonger(line)) continue;
    expect(line.length, `line exceeds ${WIDTH_80MM} cols: ${JSON.stringify(line)}`).toBeLessThanOrEqual(WIDTH_80MM);
  }
}

const CREATED_AT = "2026-11-12T01:02:03.456Z";
const QR_VALUE = "MTS:PKG:PKG-2026-11-000001";
const QR_LINE = `QR: ${QR_VALUE}`;

const slipInput = {
  documentNumber: "RR-2026-11-000001",
  packageNumber: "PKG-2026-11-000001",
  customerName: "Fixture Customer",
  description: "Angle bar",
  quantity: 2,
  unit: "bundle",
  handlingBranchName: "Daet",
  destination: "Daet",
  deliveryType: "Deliver to consignee",
  city: "Daet",
  province: "Camarines Norte",
  condition: "Good",
  weight: 24.5,
  weightUnit: "kg",
  length: 120,
  width: 20,
  height: 15,
  dimensionUnit: "cm",
  unitPrice: 1800,
  price: 3600,
  qrValue: QR_VALUE,
  printLine: `Printed ${CREATED_AT}`,
  copyNumber: 1
};

describe("renderReceivingSlip", () => {
  test("matches the golden output byte-for-byte", () => {
    expect(renderReceivingSlip(slipInput)).toBe(golden("receiving-slip.txt"));
  });

  test("is deterministic", () => {
    expect(renderReceivingSlip(slipInput)).toBe(renderReceivingSlip(slipInput));
  });

  test("keeps every line within the 42-col render width", () => {
    expectWithinRenderWidth(renderReceivingSlip(slipInput));
  });

  test("prints the package number and QR payload verbatim", () => {
    const text = renderReceivingSlip(slipInput);
    expect(text).toContain("Package: PKG-2026-11-000001");
    expect(text).toContain(QR_LINE);
    expect(text).toContain("Price: PHP 3600.00");
  });

  test("omits measurement and unit-price lines when the cargo has none, and shows the unpriced state", () => {
    const text = renderReceivingSlip({
      ...slipInput,
      quantity: 1,
      unit: "pcs",
      handlingBranchName: null,
      city: null,
      province: null,
      weight: null,
      length: null,
      width: null,
      height: null,
      unitPrice: null,
      price: null
    });
    expect(text).not.toContain("Weight/Size:");
    expect(text).not.toContain("Unit Price:");
    expect(text).toContain("Price: Waiting for Price");
    expect(text).toContain("Delivery Area: Not provided");
    expectWithinRenderWidth(text);
  });
});

const documentInput = {
  recordNumber: "RR-2026-11-000001",
  customerName: "Fixture Customer",
  customerDrNumber: "DR-12345",
  destination: "Daet",
  packages: [
    { quantity: 2, unit: "bundle", description: "Angle bar", handlingBranchName: "Daet", destination: "Daet", price: 3600 },
    { quantity: 1, unit: "pcs", description: "Cement bag", handlingBranchName: "Daet", destination: "Daet", price: null }
  ],
  // The API formats this from the print log; the fixture pins one rendering of it.
  copyLine: "1 / 11/12/2026, 01:02:03"
};

describe("renderReceivingDocument", () => {
  test("matches the golden output byte-for-byte", () => {
    expect(renderReceivingDocument(documentInput)).toBe(golden("receiving-document.txt"));
  });

  test("is deterministic", () => {
    expect(renderReceivingDocument(documentInput)).toBe(renderReceivingDocument(documentInput));
  });

  test("keeps every line within the 42-col render width", () => {
    expectWithinRenderWidth(renderReceivingDocument(documentInput));
  });

  test("prints the totals verbatim, counting unpriced packages", () => {
    const text = renderReceivingDocument(documentInput);
    expect(text).toContain("Items: 2 lines / Qty 3");
    expect(text).toContain("Total: PHP 3600.00 / 1 no price");
    expect(text).toContain("1: 2 bundle Angle bar / Daet / P3600");
    expect(text).toContain("2: 1 pcs Cement bag / Daet / NP");
  });

  test("truncates item descriptions to fit the 42-col line, cutting at a word boundary (L4-F3)", () => {
    const text = renderReceivingDocument({
      ...documentInput,
      packages: [{ quantity: 3, unit: "pcs", description: "Steel pipes 6m schedule 40", handlingBranchName: "Naga", destination: "Naga", price: 750 }]
    });
    // The old fixed 22-char cap produced "Steel pipes 6m schedu..."
    // on a 45-char line — over the render width and cut mid-word.
    // The description now gets only the width the composed line
    // leaves, and the ellipsis replaces a whole word.
    expect(text).toContain("1: 3 pcs Steel pipes 6m... / Naga / P750");
    expect(text).toContain("Total: PHP 750.00");
    expectWithinRenderWidth(text);
  });

  test("prints centavo prices exactly, so the item lines sum to the printed total (C-M10)", () => {
    const text = renderReceivingDocument({
      ...documentInput,
      packages: [
        { quantity: 2, unit: "box", description: "Alpha sewing machines", handlingBranchName: "Daet", destination: "Daet", price: 1500 },
        { quantity: 3, unit: "roll", description: "Bravo textile rolls", handlingBranchName: "Daet", destination: "Daet", price: 2750.5 },
        { quantity: 1, unit: "pcs", description: "Needle pack", handlingBranchName: "Daet", destination: "Daet", price: 1075.25 }
      ]
    });
    // The L4 evidence case: 2750.50 used to print as "P2751" and the
    // lines summed ₱0.50 above the document's own total.
    expect(text).toContain("/ P1500");
    expect(text).toContain("/ P2750.50");
    expect(text).toContain("/ P1075.25");
    expect(text).not.toContain("P2751");
    expect(text).toContain("Total: PHP 5325.75");
    const itemCentavos = text
      .split("\n")
      .filter((line) => /^\d+: /.test(line))
      .map((line) => Math.round(Number(line.match(/P([\d.]+)$/)?.[1] ?? "0") * 100));
    expect(itemCentavos).toEqual([150000, 275050, 107525]);
    expect(itemCentavos.reduce((sum, value) => sum + value, 0)).toBe(532575);
  });

  test("keeps long-description item lines inside the width without mid-word cuts (L4-F3)", () => {
    const text = renderReceivingDocument({
      ...documentInput,
      packages: [
        { quantity: 2, unit: "box", description: "L4 Alpha sewing machines", handlingBranchName: "Daet", destination: "Daet", price: 1500 },
        { quantity: 3, unit: "roll", description: "L4 Bravo textile rolls", handlingBranchName: "Daet", destination: "Daet", price: 2750.5 }
      ]
    });
    // The exact L4 evidence shape: these lines rendered at 48/47
    // chars with "sewing machi..." cut mid-word.
    expect(text).toContain("1: 2 box L4 Alpha sewing... / Daet / P1500");
    expect(text).not.toContain("machi");
    expectWithinRenderWidth(text);
  });
});

const qrLabelInput = {
  packageNumber: "PKG-2026-11-000001",
  description: "Angle bar",
  destination: "Daet",
  qrValue: QR_VALUE
};

describe("renderQrLabel", () => {
  test("matches the golden output byte-for-byte", () => {
    expect(renderQrLabel(qrLabelInput)).toBe(golden("qr-label.txt"));
  });

  test("is deterministic", () => {
    expect(renderQrLabel(qrLabelInput)).toBe(renderQrLabel(qrLabelInput));
  });

  test("keeps every line within the 42-col render width", () => {
    expectWithinRenderWidth(renderQrLabel(qrLabelInput));
  });

  test("prints the package number and the full QR payload line verbatim", () => {
    const text = renderQrLabel(qrLabelInput);
    expect(text.split("\n")).toContain("PKG-2026-11-000001");
    expect(text.split("\n")).toContain(QR_LINE);
  });
});

const manifestInput = {
  tripNumber: "TRIP-2026-11-000001",
  origin: "Origin Warehouse",
  destination: "Daet",
  vehicle: "Isuzu Elf Dropside",
  driver: "Fixture Driver",
  cargo: [
    { packageNumber: "PKG-2026-11-000001", description: "Angle bar", destination: "Daet", status: "Loaded", price: 3600 },
    { packageNumber: "PKG-2026-11-000002", description: "Cement bag", destination: "Naga", status: "Loaded", price: null }
  ],
  auditLine: `Printed ${CREATED_AT} / Copy 1`
};

describe("renderLoadingManifest", () => {
  test("matches the golden output byte-for-byte", () => {
    expect(renderLoadingManifest(manifestInput)).toBe(golden("loading-manifest.txt"));
  });

  test("is deterministic", () => {
    expect(renderLoadingManifest(manifestInput)).toBe(renderLoadingManifest(manifestInput));
  });

  test("keeps every composed line within 42 cols; the print-audit line is the locked exception", () => {
    const text = renderLoadingManifest(manifestInput);
    // The audit line embeds an ISO timestamp, so it is 48 chars by
    // construction. It is asserted verbatim rather than silently allowed.
    expect(text).toContain(`Print: Printed ${CREATED_AT} / Copy 1`);
    expectWithinRenderWidth(text, (line) => line.startsWith("Print: "));
  });

  test("lists every cargo package number verbatim", () => {
    const text = renderLoadingManifest(manifestInput);
    expect(text).toContain("1. Package: PKG-2026-11-000001");
    expect(text).toContain("2. Package: PKG-2026-11-000002");
    expect(text).toContain("Cargo Count: 2");
  });
});

const deliveryReceiptInput = {
  // Round 1 PR-8 (C-M9): the service passes the REGISTERED document
  // number — the same value the print metadata/log carries — so the
  // golden shows what the signed paper now carries. The fixture used
  // to enshrine the "DR-PREVIEW-…" placeholder the service hardcoded.
  documentNumber: "DR-PKG-2026-11-000001",
  packageNumber: "PKG-2026-11-000001",
  customerName: "Fixture Customer",
  description: "Angle bar",
  destination: "Daet",
  deliveredTo: "Fixture Receiver",
  price: 3600,
  paymentStatus: "Paid",
  qrValue: QR_VALUE
};

describe("renderDeliveryReceipt", () => {
  test("matches the golden output byte-for-byte", () => {
    expect(renderDeliveryReceipt(deliveryReceiptInput)).toBe(golden("delivery-receipt.txt"));
  });

  test("is deterministic", () => {
    expect(renderDeliveryReceipt(deliveryReceiptInput)).toBe(renderDeliveryReceipt(deliveryReceiptInput));
  });

  test("keeps every line within the 42-col render width", () => {
    expectWithinRenderWidth(renderDeliveryReceipt(deliveryReceiptInput));
  });

  test("prints the package number, price total and QR payload verbatim", () => {
    const text = renderDeliveryReceipt(deliveryReceiptInput);
    expect(text).toContain("Package: PKG-2026-11-000001");
    expect(text).toContain("Price: PHP 3600.00");
    expect(text).toContain("Payment: Paid");
    expect(text).toContain(QR_LINE);
  });

  test("prints the given document number as the receipt's number line (C-M9)", () => {
    const text = renderDeliveryReceipt(deliveryReceiptInput);
    expect(text.split("\n")[2]).toBe("DR-PKG-2026-11-000001");
    expect(text).not.toContain("PREVIEW");
  });
});
