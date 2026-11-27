import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

/**
 * R2-18 + R2-15 — label/value separation family.
 *
 * R2-18: the Offline Storage summary strip (.metricGrid/.metricCard) had NO
 * CSS rules at all, so each card rendered its label, value and note jammed
 * inline with a 0px gap; the Device Setup status strip's Printer cell was a
 * bare <div> with the same 0px jam. The strip now shares the detail-grid
 * stat-cell treatment, and the Printer cell uses the shared .settingTile.
 *
 * R2-15: .settingTile is display:grid with no align-content, so when a tile
 * was stretched taller than its content the default stretch distribution
 * pushed the value away from its label (measured 13.5px vs the declared 4px
 * gap in Review Receiving). The tile now packs label-over-value at the top
 * with its declared gap, like the app's other label/value rows.
 */
describe("label/value separation wiring (R2-18 + R2-15)", () => {
  const shell = readFileSync(new URL("../../apps/web/src/app/ui/app-shell.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../apps/web/src/app/styles.css", import.meta.url), "utf8");

  test("the Offline Storage metric strip has real grid/card rules (was unstyled, jammed inline)", () => {
    expect(css).toContain(".metricGrid {\n  display: grid;");
    expect(css).toContain(".metricCard {");
    expect(css).toContain(".metricCard span {");
    expect(css).toContain(".metricCard strong {");
    expect(css).toContain(".metricCard small {");
  });

  test("metric cards carry the detail-grid stat-cell treatment (border, radius, panel, grid gap)", () => {
    const cardRule = css.slice(css.indexOf(".metricCard {"), css.indexOf(".metricCard span {"));
    expect(cardRule).toContain("border: 1px solid var(--border);");
    expect(cardRule).toContain("border-radius: 8px;");
    expect(cardRule).toContain("background: var(--panel);");
    expect(cardRule).toContain("display: grid;");
    expect(cardRule).toContain("gap: 3px;");
  });

  test("the Device Setup Printer cell renders as a shared setting tile, not a bare div", () => {
    expect(shell).toContain('<div className="settingTile">\n            <span>Printer</span>');
    expect(shell).not.toContain("<div>\n            <span>Printer</span>");
  });

  test("setting tiles pack label-over-value at the top instead of stretching apart", () => {
    expect(css).toContain(".settingTile {\n  display: grid;\n  align-content: start;\n  gap: 4px;\n}");
  });
});
