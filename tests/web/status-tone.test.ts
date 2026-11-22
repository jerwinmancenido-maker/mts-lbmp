import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { statusBadgeClass, statusTone, toneBadgeClass } from "../../apps/web/src/app/ui/status-tone";

/**
 * Round 1 fix loop PR-12 — semantic status tones + pill contrast,
 * web surface (canonical finding C-M15; filed as L1 B-F1 = C-F4 for
 * contrast and B-F2 for semantics; recommendation R2).
 *
 * The findings: every status pill rendered in the signed-in role's
 * accent colour, so "Failed Delivery" wore the same blue as
 * "Arrived" and colour carried no state information; and the
 * pairing #2563eb on #dbeafe at 14px measured 4.24:1, below the
 * WCAG AA 4.5:1 floor (the round's measurements §2 — under the
 * receiving/delivery role themes the same pairing is 3.00:1 and
 * 1.93:1, computed the same way).
 *
 * These tests pin (a) the status → tone mapping for every status
 * vocabulary the shell renders, (b) the neutral fallback for
 * anything unlisted, and (c) the shipped CSS itself: every
 * text/background pair the pill system can produce — the five tone
 * pairs and the base badge pair under each role theme — is
 * recomputed from styles.css and must clear 4.5:1.
 */

describe("statusTone mapping (PR-12, C-M15/R2)", () => {
  test("the round's pair: a failed delivery is a problem, an arrived one is a success", () => {
    expect(statusTone("Failed Delivery")).toBe("problem");
    expect(statusTone("Arrived")).toBe("success");
    expect(statusTone("Failed Delivery")).not.toBe(statusTone("Arrived"));
  });

  test("cargo statuses", () => {
    expect(statusTone("Delivered")).toBe("success");
    expect(statusTone("Ready for Delivery")).toBe("progress");
    expect(statusTone("In Transit")).toBe("progress");
    expect(statusTone("Loaded")).toBe("progress");
    expect(statusTone("Received")).toBe("progress");
    expect(statusTone("Waiting for Loading")).toBe("attention");
    expect(statusTone("Waiting for Price")).toBe("attention");
    expect(statusTone("Exception")).toBe("problem");
    expect(statusTone("Draft")).toBe("neutral");
    expect(statusTone("Cancelled")).toBe("neutral");
  });

  test("trip statuses", () => {
    expect(statusTone("Completed")).toBe("success");
    expect(statusTone("Departed")).toBe("progress");
    expect(statusTone("Loading")).toBe("progress");
    expect(statusTone("Unloading")).toBe("progress");
    expect(statusTone("Partially Delivered")).toBe("attention");
    expect(statusTone("Planned")).toBe("neutral");
    expect(statusTone("Exception")).toBe("problem");
  });

  test("payment and invoice statuses", () => {
    expect(statusTone("Paid")).toBe("success");
    expect(statusTone("Partially Paid")).toBe("attention");
    expect(statusTone("Unpaid")).toBe("attention");
    expect(statusTone("Overpaid")).toBe("attention");
    expect(statusTone("Overdue")).toBe("problem");
    expect(statusTone("Issued")).toBe("progress");
    expect(statusTone("Void")).toBe("neutral");
    expect(statusTone("Voided")).toBe("neutral");
  });

  test("expense, customer, chat, intake and queue statuses", () => {
    expect(statusTone("Approved")).toBe("success");
    expect(statusTone("Rejected")).toBe("problem");
    expect(statusTone("Submitted")).toBe("attention");
    expect(statusTone("Active")).toBe("success");
    expect(statusTone("Pending")).toBe("attention");
    expect(statusTone("Archived")).toBe("neutral");
    expect(statusTone("Inactive")).toBe("neutral");
    expect(statusTone("Open")).toBe("progress");
    expect(statusTone("Needs Approval")).toBe("attention");
    expect(statusTone("Pending Review")).toBe("attention");
    expect(statusTone("In Review")).toBe("progress");
    expect(statusTone("Synced")).toBe("success");
    expect(statusTone("Syncing")).toBe("progress");
    expect(statusTone("Failed")).toBe("problem");
    expect(statusTone("Pass")).toBe("success");
    expect(statusTone("Fail")).toBe("problem");
    expect(statusTone("No Price")).toBe("attention");
  });

  test("anything unlisted renders neutral — a new status borrows no meaning", () => {
    expect(statusTone("Some Future Status")).toBe("neutral");
    expect(statusTone("")).toBe("neutral");
    expect(statusTone(null)).toBe("neutral");
    expect(statusTone(undefined)).toBe("neutral");
  });

  test("badge class helpers", () => {
    expect(statusBadgeClass("Delivered")).toBe("badge tone-success");
    expect(statusBadgeClass("Failed Delivery")).toBe("badge tone-problem");
    expect(statusBadgeClass(undefined)).toBe("badge tone-neutral");
    expect(toneBadgeClass("attention")).toBe("badge tone-attention");
  });
});

// --- Contrast pins, recomputed from the shipped CSS ---------------

function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

const css = readFileSync(new URL("../../apps/web/src/app/styles.css", import.meta.url), "utf8");

function tonePair(tone: string): { background: string; color: string } {
  const match = css.match(new RegExp(`\\.badge\\.tone-${tone}\\s*\\{\\s*background:\\s*(#[0-9a-fA-F]{6});\\s*color:\\s*(#[0-9a-fA-F]{6});`));
  if (!match) throw new Error(`tone-${tone} rule not found in styles.css`);
  return { background: match[1]!, color: match[2]! };
}

function cssVar(blockPattern: RegExp, name: string): string {
  const block = css.match(blockPattern);
  if (!block) throw new Error(`CSS block not found: ${blockPattern}`);
  const declaration = block[0].match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!declaration) throw new Error(`${name} not found in block ${blockPattern}`);
  return declaration[1]!;
}

describe("pill contrast, recomputed from styles.css (PR-12, C-M15)", () => {
  test("the round's measurement method reproduces its 4.24 for the old pairing", () => {
    expect(contrastRatio("#2563eb", "#dbeafe")).toBeCloseTo(4.24, 1);
  });

  test.each(["success", "progress", "attention", "problem", "neutral"])("tone-%s pair clears AA 4.5:1", (tone) => {
    const { background, color } = tonePair(tone);
    expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(4.5);
  });

  test("the legacy .badge.warning pair is exactly the attention tone pair", () => {
    const warning = css.match(/\.badge\.warning\s*\{\s*background:\s*(#[0-9a-fA-F]{6});\s*color:\s*(#[0-9a-fA-F]{6});/);
    expect(warning).not.toBeNull();
    const attention = tonePair("attention");
    expect({ background: warning![1], color: warning![2] }).toEqual(attention);
  });

  test("the base badge pair clears AA 4.5:1 under every role theme", () => {
    const rootSoft = cssVar(/:root\s*\{[^}]*\}/, "--role-soft");
    const rootText = cssVar(/:root\s*\{[^}]*\}/, "--badge-text");
    expect(contrastRatio(rootText, rootSoft)).toBeGreaterThanOrEqual(4.5);
    for (const role of ["admin", "receiving", "delivery", "customer"]) {
      const block = new RegExp(`\\.app\\.role-${role}\\s*\\{[^}]*\\}`);
      const soft = cssVar(block, "--role-soft");
      const text = cssVar(block, "--badge-text");
      expect(contrastRatio(text, soft), `role-${role}: ${text} on ${soft}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
