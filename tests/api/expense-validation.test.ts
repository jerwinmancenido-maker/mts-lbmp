import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type { ExpenseRecord, Trip } from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 PR-3 — C-M2 / C-M3 expense validation & write ordering.
 *
 * Before this fix the expense-create path validated nothing about the
 * amount and nothing about the category: ₱0 and ₱−500 expenses were
 * recorded verbatim as Submitted (L6-F2 / L6 E3b — a negative expense
 * ADDS profit in the P6-5 reports), and an empty body {} pushed its
 * record first and only then threw while the notification text was
 * being formatted, so the caller saw a 500 and a ghost expense with
 * undefined category/amount was left behind (L6-F3 / L6 E1c).
 *
 * The fix lives in createExpenseOnce — the single choke point every
 * expense creation funnels through (verified: the only expenses.push
 * and the only ExpenseRecord construction in the API) — mirroring the
 * C-M1 payment validation in recordPaymentOnce: category required,
 * amount must be a positive finite number, both checked before any
 * record exists, and the notification text is formatted before the
 * push so nothing that can throw runs after the record lands.
 *
 * Each test builds a fresh LogisticsService against a throwaway
 * INIT_CWD so the JSON state store writes into a temp dir.
 */

type ServiceInternals = {
  expenses: ExpenseRecord[];
  trips: Trip[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

function makeTrip(id: string): Trip {
  return {
    id,
    tripNumber: "TR-PR3-001",
    origin: "Daet",
    destination: "Naga",
    status: "Completed",
    isMixedTrip: false,
    cargoPackageIds: [],
    createdAt: "2026-11-01T00:00:00.000Z"
  };
}

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-round1-pr3-"));
  previousInitCwd = process.env.INIT_CWD;
  previousRepository = process.env.MTS_REPOSITORY;
  process.env.INIT_CWD = tempRoot;
  delete process.env.MTS_REPOSITORY;
});

afterAll(() => {
  if (previousInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = previousInitCwd;
  if (previousRepository === undefined) delete process.env.MTS_REPOSITORY;
  else process.env.MTS_REPOSITORY = previousRepository;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("C-M2 — non-positive expense amounts are refused (L6 E3b)", () => {
  test("a ₱0 expense is refused and creates no record", () => {
    const service = new LogisticsService();
    expect(() => service.createExpense({ category: "Meals", amount: 0 })).toThrow(/greater than zero/);
    expect(internals(service).expenses).toHaveLength(0);
  });

  test("a ₱−500 expense is refused and creates no record (it used to add profit)", () => {
    const service = new LogisticsService();
    expect(() => service.createExpense({ category: "Meals", amount: -500 })).toThrow(/greater than zero/);
    expect(internals(service).expenses).toHaveLength(0);
  });

  test("a NaN expense amount is refused and creates no record", () => {
    const service = new LogisticsService();
    expect(() => service.createExpense({ category: "Meals", amount: Number.NaN })).toThrow(/greater than zero/);
    expect(internals(service).expenses).toHaveLength(0);
  });

  test("the refusal is a 400-class error, not a 500", () => {
    const service = new LogisticsService();
    let caught: unknown;
    try {
      service.createExpense({ category: "Meals", amount: -500 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getStatus()).toBe(400);
    expect(internals(service).expenses).toHaveLength(0);
  });
});

describe("C-M3 — an empty or incomplete body is a clean 400 and leaves no ghost (L6 E1c)", () => {
  test("an empty body {} is refused with a 400 and creates no record", () => {
    const service = new LogisticsService();
    let caught: unknown;
    try {
      service.createExpense({} as Parameters<LogisticsService["createExpense"]>[0]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getStatus()).toBe(400);
    expect(internals(service).expenses).toHaveLength(0);
  });

  test("a blank category is refused and creates no record", () => {
    const service = new LogisticsService();
    expect(() => service.createExpense({ category: "   ", amount: 100 })).toThrow(/category is required/);
    expect(internals(service).expenses).toHaveLength(0);
  });

  test("a body with a category but no amount is refused and creates no record", () => {
    const service = new LogisticsService();
    const input = { category: "Meals" } as Parameters<LogisticsService["createExpense"]>[0];
    expect(() => service.createExpense(input)).toThrow(/greater than zero/);
    expect(internals(service).expenses).toHaveLength(0);
  });
});

describe("C-M3 — failures after the new checks still leave no record behind", () => {
  test("a queued-device receipt reference is refused and creates no record", () => {
    const service = new LogisticsService();
    expect(() =>
      service.createExpense({ category: "Meals", amount: 100, receiptUrl: "local-photo://local-photo-7" })
    ).toThrow(/still queued on the device/);
    expect(internals(service).expenses).toHaveLength(0);
  });

  test("a trip-category expense naming a missing trip is refused and creates no record", () => {
    const service = new LogisticsService();
    expect(() => service.createExpense({ category: "Fuel", amount: 100, tripId: "trip_missing" })).toThrow(
      /was not found/
    );
    expect(internals(service).expenses).toHaveLength(0);
  });
});

describe("valid expenses and the trip discipline are unchanged", () => {
  test("a valid expense is created as Submitted and, once approved, appears in the report totals", () => {
    const service = new LogisticsService();
    const expense = service.createExpense({ category: "Meals", amount: 75, description: "Crew meals" });
    expect(expense).toMatchObject({ category: "Meals", amount: 75, status: "Submitted" });
    expect(internals(service).expenses).toHaveLength(1);

    service.approveExpense(expense.id);
    const report = service.getProfitabilityReport();
    expect(report.unallocatedExpenses.count).toBe(1);
    expect(report.unallocatedExpenses.total).toBe(75);
  });

  test("Fuel without a trip is still refused (Phase 6 Q6 regression)", () => {
    const service = new LogisticsService();
    expect(() => service.createExpense({ category: "Fuel", amount: 100 })).toThrow(/must name the trip/);
    expect(internals(service).expenses).toHaveLength(0);
  });

  test("Fuel with a real trip still saves normally", () => {
    const service = new LogisticsService();
    internals(service).trips.push(makeTrip("trip_pr3_1"));
    const fuel = service.createExpense({ category: "Fuel", amount: 100, tripId: "trip_pr3_1" });
    expect(fuel).toMatchObject({ category: "Fuel", amount: 100, tripId: "trip_pr3_1", status: "Submitted" });
    expect(internals(service).expenses).toHaveLength(1);
  });
});
