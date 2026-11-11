// Width-truth tests for the native print preparation step (Phase 3, gap G3).
//
// printNativeText (apps/web) hands API-rendered text to the Android plugin
// through prepareTextForPrint. The API's 42-col layout is canonical:
//
// - 80mm: the payload must be the API render byte-for-byte — no silent
//   re-wrap to the old 34-col "safe" width. The NYX plugin renders onto a
//   227pt PDF page with 18pt side padding (191pt usable) in a 7.2pt
//   monospace font (~4.32pt/char), so 42 cols (~181pt) fits un-wrapped.
// - 58mm: the paper is narrower than the layout, so the text is
//   deliberately down-wrapped to the 24-col safe width. That adaptation is
//   explicit and locked here: width is capped and no content is lost.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { WIDTH_80MM, prepareTextForPrint } from "@mts-lbmp/printing";

function golden(name: string) {
  return readFileSync(new URL(`./golden/${name}`, import.meta.url), "utf8");
}

const DOCUMENTS = ["receiving-slip.txt", "receiving-document.txt", "qr-label.txt", "loading-manifest.txt", "delivery-receipt.txt"];
const SAFE_WIDTH_58MM = 24;

describe("prepareTextForPrint — 80mm (canonical width)", () => {
  test("passes every rendered document through byte-for-byte", () => {
    for (const name of DOCUMENTS) {
      const rendered = golden(name);
      expect(prepareTextForPrint(rendered, "80mm"), name).toBe(rendered);
    }
  });

  test("keeps the full QR payload line intact and un-split", () => {
    const payload = prepareTextForPrint(golden("qr-label.txt"), "80mm");
    expect(payload.split("\n")).toContain("QR: MTS:PKG:PKG-2026-11-000001");
  });

  test("does not shrink the 42-col dividers", () => {
    const payload = prepareTextForPrint(golden("delivery-receipt.txt"), "80mm");
    expect(payload.split("\n")).toContain("-".repeat(WIDTH_80MM));
  });

  test("only normalizes line endings: strips CR and ensures a trailing newline", () => {
    expect(prepareTextForPrint("A\r\nB", "80mm")).toBe("A\nB\n");
    expect(prepareTextForPrint("A\nB\n", "80mm")).toBe("A\nB\n");
  });
});

describe("prepareTextForPrint — 58mm (deliberate down-wrap)", () => {
  test("caps every line at the 24-col safe width", () => {
    for (const name of DOCUMENTS) {
      const payload = prepareTextForPrint(golden(name), "58mm");
      for (const line of payload.split("\n")) {
        expect(line.length, `${name}: ${JSON.stringify(line)}`).toBeLessThanOrEqual(SAFE_WIDTH_58MM);
      }
    }
  });

  test("loses no content: non-whitespace characters survive in order (divider runs shrink by design)", () => {
    const squeeze = (text: string) => text.replace(/-{2,}/g, "").replace(/\s+/g, "");
    for (const name of DOCUMENTS) {
      const rendered = golden(name);
      expect(squeeze(prepareTextForPrint(rendered, "58mm")), name).toBe(squeeze(rendered));
    }
  });
});
