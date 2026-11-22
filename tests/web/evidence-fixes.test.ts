import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * Structural pins for the Round 1 evidence fix batch items whose
 * behaviour is determined by source layout rather than by a pure
 * derivation — the same source-reading idiom status-tone.test.ts
 * uses for pill contrast. Each pin fails on the base code; the
 * behavioural proof for each item is the browser capture filed with
 * the PR.
 *
 * OBS-L1R-02 (cargo list pills) is pure CSS: the layout either
 * restacks or it does not, so the shipped stylesheet is the behaviour.
 * OBS-L17-V2-1 / V2-2 live inside the app shell component, which has
 * no render harness in tests/web; the pins guard the exact wiring
 * the defects broke (an unmounted input ref; a preview opening
 * behind a still-open modal).
 */

const css = readFileSync(new URL("../../apps/web/src/app/styles.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../apps/web/src/app/ui/app-shell.tsx", import.meta.url), "utf8");

function mediaBlock(cssText: string, query: string): string {
  const start = cssText.indexOf(`@media ${query}`);
  if (start < 0) throw new Error(`media query ${query} not found in styles.css`);
  const next = cssText.indexOf("@media", start + 1);
  return cssText.slice(start, next < 0 ? undefined : next);
}

describe("cargo list pills keep their full width (OBS-L1R-02)", () => {
  test("cargo badges are exempt from the shared max-width cap at every width", () => {
    expect(css).toMatch(/\.compactDataRow\.cargoListRow \.compactRowMeta \.badge \{\s*max-width: none;/);
  });

  test("at phone widths the cargo row restacks: info on top, pills on their own line", () => {
    const phone = mediaBlock(css, "(max-width: 640px)");
    expect(phone).toMatch(/\.compactDataRow\.cargoListRow \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(phone).toMatch(
      /\.compactDataRow\.cargoListRow \.cargoListMeta \{\s*grid-column: 1 \/ -1;\s*width: 100%;\s*min-width: 0;/
    );
  });
});

describe("Add Product dialog photo button (OBS-L17-V2-1)", () => {
  test("the dialog mounts its own file input", () => {
    expect(shell).toMatch(/<input ref=\{productDialogPhotoInputRef\} className="hiddenInput" type="file" accept="image\/\*"/);
  });

  test("the Add Product Image button drives the dialog's input and wires a fallback message", () => {
    const labelAt = shell.indexOf("Add Product Image");
    expect(labelAt).toBeGreaterThanOrEqual(0);
    const button = shell.slice(Math.max(0, labelAt - 400), labelAt);
    expect(button).toContain("capturePhotoOrOpenPicker(productDialogPhotoInputRef");
    expect(button).toContain("attachCurrentProductPhoto");
    // The call's last argument is onFallback: a camera-less device
    // must tell the user what happened instead of silently no-opping.
    expect(button).toContain("setReceiveMessage");
  });
});

describe("cargo detail previews close the detail modal first (OBS-L17-V2-2)", () => {
  test.each(["Load receiving slip", "Load QR label"])("%s clears the selection before opening the PrintPanel", (label) => {
    const handler = shell.match(new RegExp(`onAction\\("${label}", async \\(\\) => \\{([\\s\\S]*?)\\}\\)`));
    expect(handler).not.toBeNull();
    const body = handler?.[1] ?? "";
    const closeAt = body.indexOf('setSelectedPackage("")');
    const previewAt = body.indexOf("setReceiptPreview(");
    expect(closeAt).toBeGreaterThanOrEqual(0);
    expect(previewAt).toBeGreaterThan(closeAt);
  });
});
