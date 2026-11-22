import { describe, expect, test } from "vitest";
import { formatMoney, formatMoneyAmount, roundMoneyHalfUp } from "../../apps/web/src/app/ui/money-format";

/**
 * Round 2 fix loop obligation #2 (R2-02 + R2-03, filed as L1
 * B2R-F1 / B2R-F2): one money format for the whole web UI —
 * grouped thousands, exactly two decimals. Before the fix the
 * decimals and grouping changed per screen: "PHP 2,758,800.6"
 * (Reports, one decimal), "PHP 350" (lists, whole pesos),
 * "PHP 1234567.89" (cargo pill, ungrouped), "PHP 0.00"
 * (receiving review, the only canonical one).
 */
describe("shared money format (R2-02/R2-03)", () => {
  test("thousands are grouped at 4, 7 and 10 digits", () => {
    expect(formatMoneyAmount(1234.5)).toBe("1,234.50");
    expect(formatMoneyAmount(1234567.89)).toBe("1,234,567.89");
    expect(formatMoneyAmount(1234567890.12)).toBe("1,234,567,890.12");
  });

  test("below a thousand there is no separator, and two decimals always show", () => {
    expect(formatMoneyAmount(999.9)).toBe("999.90");
    expect(formatMoneyAmount(1000)).toBe("1,000.00");
    expect(formatMoneyAmount(350)).toBe("350.00");
    expect(formatMoneyAmount(400.1)).toBe("400.10");
  });

  test("zero renders as PHP 0.00", () => {
    expect(formatMoneyAmount(0)).toBe("0.00");
    expect(formatMoney(0)).toBe("PHP 0.00");
  });

  test("the filed one-decimal total renders centavo-exact", () => {
    expect(formatMoney(2758800.6)).toBe("PHP 2,758,800.60");
  });

  test("negatives keep the sign after the currency label, as the screens have always placed it", () => {
    expect(formatMoneyAmount(-400)).toBe("-400.00");
    expect(formatMoney(-400)).toBe("PHP -400.00");
    expect(formatMoney(-1234.5)).toBe("PHP -1,234.50");
  });

  test("rounding is half-up at the centavo on the typed digits", () => {
    expect(formatMoneyAmount(2.675)).toBe("2.68");
    expect(formatMoneyAmount(2.674)).toBe("2.67");
    expect(formatMoneyAmount(1.005)).toBe("1.01");
    expect(formatMoneyAmount(0.005)).toBe("0.01");
    expect(formatMoneyAmount(0.004)).toBe("0.00");
    expect(formatMoneyAmount(1234.565)).toBe("1,234.57");
    // Half-up on the magnitude: a negative half centavo rounds away from zero.
    expect(formatMoneyAmount(-2.675)).toBe("-2.68");
  });

  test("binary float noise does not leak into the rendered figure", () => {
    expect(formatMoneyAmount(0.1 + 0.2)).toBe("0.30");
    expect(formatMoneyAmount(2758800.5999999998)).toBe("2,758,800.60");
  });

  test("roundMoneyHalfUp returns the rounded peso value", () => {
    expect(roundMoneyHalfUp(2.675)).toBe(2.68);
    expect(roundMoneyHalfUp(0.125)).toBe(0.13);
    expect(roundMoneyHalfUp(350)).toBe(350);
  });
});
