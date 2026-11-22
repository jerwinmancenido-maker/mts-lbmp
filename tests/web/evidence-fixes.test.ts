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

describe("customer list pills keep their full width (R2-01)", () => {
  test("customer badges are exempt from the shared max-width cap at every width", () => {
    expect(css).toMatch(/\.compactDataRow\.customerListRow \.compactRowMeta \.badge \{\s*max-width: none;/);
  });

  test("at phone widths the customer row restacks: info on top, pills on their own line", () => {
    const phone = mediaBlock(css, "(max-width: 640px)");
    expect(phone).toMatch(/\.compactDataRow\.customerListRow \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(phone).toMatch(
      /\.compactDataRow\.customerListRow \.compactRowMeta \{\s*grid-column: 1 \/ -1;\s*width: 100%;\s*min-width: 0;/
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

describe("one shared money format across the web UI (R2-02/R2-03)", () => {
  const moneyModule = readFileSync(new URL("../../apps/web/src/app/ui/money-format.ts", import.meta.url), "utf8");
  const tiles = readFileSync(new URL("../../apps/web/src/app/ui/dashboard-tiles.ts", import.meta.url), "utf8");
  const paymentDisplay = readFileSync(new URL("../../apps/web/src/app/ui/payment-display.ts", import.meta.url), "utf8");
  const overlay = readFileSync(new URL("../../apps/web/src/app/ui/search-overlay.ts", import.meta.url), "utf8");
  const queueView = readFileSync(new URL("../../apps/web/src/app/ui/queue-view.ts", import.meta.url), "utf8");
  const tracking = readFileSync(new URL("../../apps/web/src/app/tracking/[reference]/page.tsx", import.meta.url), "utf8");

  test("the shared module pins grouped thousands and exactly two decimals", () => {
    expect(moneyModule).toContain("minimumFractionDigits: 2");
    expect(moneyModule).toContain("maximumFractionDigits: 2");
    expect(moneyModule).toContain("export function formatMoney(");
    expect(moneyModule).toContain("export function formatMoneyAmount(");
  });

  test("every in-scope render module routes through the shared formatter", () => {
    expect(shell).toContain('from "./money-format"');
    expect(tiles).toContain('from "./money-format"');
    expect(paymentDisplay).toContain('from "./money-format"');
    expect(overlay).toContain('from "./money-format"');
    expect(queueView).toContain('from "./money-format"');
    expect(tracking).toContain('from "../../ui/money-format"');
  });

  test("no screen keeps a local money format: no bare-locale money renders remain in the shell", () => {
    // The Reports screen's local helper is gone.
    expect(shell).not.toContain("const money = (value: number)");
    // No money site formats with a bare toLocaleString any more
    // (formatNumber's weight/volume rendering and date renders are
    // not money and stay).
    expect(shell).not.toMatch(/PHP[^`"\n]{0,40}toLocaleString/);
    expect(shell).not.toContain("`PHP ${pkg.price}`");
    expect(shell).not.toContain("`PHP ${value.toLocaleString()}`");
    expect(tiles).not.toMatch(/PHP[^`"\n]{0,40}toLocaleString/);
    expect(overlay).not.toMatch(/PHP[^`"\n]{0,40}toLocaleString/);
  });

  test("the receiving money helper delegates to the shared module", () => {
    expect(shell).toMatch(/function formatReceivingMoney[\s\S]{0,600}formatMoneyAmount\(numericValue\)/);
  });
});

describe("money figures stay on one line (R2-05)", () => {
  test("money dashboard tiles never wrap and step down from the headline size", () => {
    expect(css).toMatch(/\.metric strong\.metricMoney \{\s*white-space: nowrap;/);
    expect(shell).toContain('card.money ? "metricMoney" : undefined');
  });

  test("the receiving Due badge carries the no-wrap treatment", () => {
    expect(css).toMatch(/\.badge\.noWrap \{\s*white-space: nowrap;/);
    expect(shell).toContain('<span className="badge noWrap">Due PHP {formatReceivingMoney(receivingAmountDue)}</span>');
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
