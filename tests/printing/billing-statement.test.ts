// Golden tests for the billing statement (Phase 6 P6-1).
//
// The statement is the document that kills the old client-side defect: the
// preview staff used to print listed only the customer's 8 most recent
// packages while its totals covered all of them. The fixture below carries
// TWELVE packages and the suite asserts every one of them appears — the
// renderer takes the invoice's actual package list and truncates nothing.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { WIDTH_80MM, renderBillingStatement, type BillingStatementInput } from "@mts-lbmp/printing";

function golden(name: string) {
  return readFileSync(new URL(`./golden/${name}`, import.meta.url), "utf8");
}

const packages = Array.from({ length: 12 }, (_, index) => ({
  packageNumber: `PKG-2026-11-${String(index + 1).padStart(6, "0")}`,
  description: `Item ${index + 1}`,
  quantity: 1,
  unit: "pcs",
  price: 1000,
  amountPaid: index === 0 ? 400 : 0,
  balance: index === 0 ? 600 : 1000
}));

const statementInput: BillingStatementInput = {
  invoiceNumber: "BILL-2026-11-000001",
  customerName: "Fixture Customer",
  status: "Partially Paid",
  dueRule: "Net 15",
  dueDate: "2026-11-27",
  packages,
  amountDue: 12000,
  amountPaid: 400,
  balance: 11600,
  copyLine: "Copy 1"
};

describe("renderBillingStatement", () => {
  test("matches the golden output byte-for-byte", () => {
    expect(renderBillingStatement(statementInput)).toBe(golden("billing-statement.txt"));
  });

  test("is deterministic", () => {
    expect(renderBillingStatement(statementInput)).toBe(renderBillingStatement(statementInput));
  });

  test("keeps every line within the 42-col render width", () => {
    for (const line of renderBillingStatement(statementInput).split("\n")) {
      expect(line.length, `line exceeds ${WIDTH_80MM} cols: ${JSON.stringify(line)}`).toBeLessThanOrEqual(WIDTH_80MM);
    }
  });

  test("lists ALL of the invoice's packages — no 8-line truncation", () => {
    const text = renderBillingStatement(statementInput);
    for (const pkg of packages) {
      expect(text).toContain(pkg.packageNumber);
    }
    expect(text).toContain("Items: 12");
    expect(text).toContain("Amount Due: PHP 12000.00");
    expect(text).toContain("Amount Paid: PHP 400.00");
    expect(text).toContain("Balance: PHP 11600.00");
  });
});
