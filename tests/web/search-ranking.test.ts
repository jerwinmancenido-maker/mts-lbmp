import { describe, expect, test } from "vitest";
import {
  fuzzyRankSearchResult,
  rankSearchResult,
  tieredSearchScores
} from "../../apps/web/src/app/ui/search-ranking";

/**
 * Round 1 fix loop PR-10 — typo-tolerant staff search, web surfaces
 * (canonical finding C-M12; filed as L25-F2, Major).
 *
 * rankSearchResult moved here from app-shell.tsx unchanged; the first
 * describe pins its scores against the round's own L25 transcript,
 * which ran the app function over the planted "Findability Motors Inc"
 * record with this exact field order (businessName, tin, companyPhone,
 * contactPerson, phone — the Customers screen's core fields):
 * "Findability" 80, "Motors Inc" 50, "Faye Santos" 97, "555 0134" 48,
 * "0917 555 0134" 96 — and "Findabilty" 0 (the finding).
 *
 * The PR-10 fix is the tier rule in tieredSearchScores: substring
 * scores are used untouched whenever any record scores above 0; the
 * fuzzy tier (fuzzyRankSearchResult, one-edit token tolerance) is
 * consulted only when the substring tier found nothing at all.
 */

const findabilityCustomerValues = [
  "Findability Motors Inc",
  "010-555-013-000",
  "052 555 0134",
  "Faye Santos",
  "0917 555 0134"
];

describe("rankSearchResult — the pre-PR-10 substring ranking, unchanged", () => {
  test("the round's L25 transcript scores reproduce exactly", () => {
    expect(rankSearchResult(findabilityCustomerValues, "Findability")).toBe(80);
    expect(rankSearchResult(findabilityCustomerValues, "Motors Inc")).toBe(50);
    expect(rankSearchResult(findabilityCustomerValues, "Faye Santos")).toBe(97);
    expect(rankSearchResult(findabilityCustomerValues, "555 0134")).toBe(48);
    expect(rankSearchResult(findabilityCustomerValues, "0917 555 0134")).toBe(96);
  });

  test("the round's failing leg: a one-letter typo still scores 0 in the substring tier", () => {
    expect(rankSearchResult(findabilityCustomerValues, "Findabilty")).toBe(0);
  });

  test("an empty query scores 1 (unfiltered), a nonsense query scores 0", () => {
    expect(rankSearchResult(findabilityCustomerValues, "")).toBe(1);
    expect(rankSearchResult(findabilityCustomerValues, "   ")).toBe(1);
    expect(rankSearchResult(findabilityCustomerValues, "Zebra Xylophone")).toBe(0);
  });
});

describe("fuzzyRankSearchResult — the one-edit fallback tier", () => {
  test("the round's typo now scores in the fuzzy band", () => {
    const score = fuzzyRankSearchResult(findabilityCustomerValues, "Findabilty");
    expect(score).toBeGreaterThan(0);
    // Below every substring band: an exact/prefix/substring hit on the
    // same field always outranks a typo hit.
    expect(score).toBeLessThan(50);
  });

  test("substitution, deletion and transposition typos each match", () => {
    expect(fuzzyRankSearchResult(["Santos Logistics"], "Santoz")).toBeGreaterThan(0);
    expect(fuzzyRankSearchResult(["Santos Logistics"], "Sntos")).toBeGreaterThan(0);
    expect(fuzzyRankSearchResult(["Findability Motors Inc"], "Motros")).toBeGreaterThan(0);
  });

  test("a multi-word query must be satisfied inside one field, like the substring tier", () => {
    expect(fuzzyRankSearchResult(findabilityCustomerValues, "Findabilty Motors")).toBeGreaterThan(0);
    // Name typo + a word that only exists in a different field: no
    // single field satisfies the whole query, so no match.
    expect(fuzzyRankSearchResult(findabilityCustomerValues, "Findabilty Santos")).toBe(0);
  });

  test("a two-letter garble matches nothing (distance bound holds)", () => {
    expect(fuzzyRankSearchResult(["Findability Motors Inc"], "Motxrz")).toBe(0);
    expect(fuzzyRankSearchResult(["Findability Motors Inc"], "Findxbilty")).toBe(0);
  });

  test("short tokens stay strict", () => {
    // A 3-letter garble of Motor/Motors: no edit distance under 4
    // chars, and it is contained in no field token.
    expect(fuzzyRankSearchResult(["Motor Parts Trading"], "Mtr")).toBe(0);
    // ...while a 3-letter partial typing still counts via containment,
    // the same partial-name behaviour the substring tier gives.
    expect(fuzzyRankSearchResult(["Santos Logistics"], "San")).toBeGreaterThan(0);
  });

  test("numeric tokens stay exact: a mistyped digit does not match", () => {
    expect(fuzzyRankSearchResult(["PKG-2026-11-000105"], "000205")).toBe(0);
    expect(fuzzyRankSearchResult(["PKG-2026-11-000105"], "000105")).toBeGreaterThan(0);
  });
});

describe("tieredSearchScores — substring results are never disturbed", () => {
  test("when the substring tier hits, its scores come back untouched and fuzzy-only records stay hidden", () => {
    const exactRecord = ["Findability Motors Inc"];
    const typoOnlyRecord = ["Motor Parts Trading"];
    // "Motors" substring-hits the first record (contains -> 50);
    // "Motor" is one edit away in the second, but the fuzzy tier must
    // not run.
    expect(tieredSearchScores([exactRecord, typoOnlyRecord], "Motors")).toEqual([50, 0]);
  });

  test("when the substring tier misses everywhere, the fuzzy tier answers", () => {
    const scores = tieredSearchScores([findabilityCustomerValues, ["Santos Logistics"]], "Findabilty");
    expect(scores[0]).toBeGreaterThan(0);
    expect(scores[1]).toBe(0);
  });

  test("ranking: exact above typo, and fuzzy hits order by field index", () => {
    // Query "Findability": the exactly-named record leads with its
    // substring score; the record literally named with the typo is a
    // substring miss for this query and the fuzzy tier stays off, so
    // it stays hidden — correct spellings never share the list with
    // typo-tier guesses.
    const scores = tieredSearchScores(
      [["Findability Motors Inc"], ["Findabilty Motors Inc"]],
      "Findability"
    );
    expect(scores[0]).toBe(80);
    expect(scores[1]).toBe(0);
    // Inside the fuzzy tier (band 30 - index), a match on an earlier
    // field outranks the same match on a later field.
    const fuzzyScores = tieredSearchScores(
      [["Unrelated Traders", "Findability Motors Inc"], ["Findability Logistics"]],
      "Findabilty"
    );
    expect(fuzzyScores).toEqual([29, 30]);
  });

  test("an empty query keeps the unfiltered all-1s behaviour", () => {
    expect(tieredSearchScores([["A"], ["B"]], "")).toEqual([1, 1]);
    expect(tieredSearchScores([["A"], ["B"]], "   ")).toEqual([1, 1]);
  });
});
