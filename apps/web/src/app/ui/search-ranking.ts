/**
 * Staff search ranking for the web shell (moved out of app-shell.tsx in
 * Round 1 fix loop PR-10 so the ranking is unit-testable, the same
 * reason payment-display.ts was extracted in P6-2).
 *
 * rankSearchResult is the original substring ranking, unchanged:
 * exact field match 100, prefix 80, substring 50 (each minus the
 * field's index, so earlier fields weigh more), 0 = hidden.
 *
 * PR-10 (canonical finding C-M12; filed as L25-F2) adds a typo-tolerant
 * fallback tier. Every search surface was substring-only, so a
 * one-letter typo ("Findabilty" for "Findability") scored 0 and the
 * record vanished. The tiering rule (tieredSearchScores, and the
 * two-pass filters in the shell): substring scores are used untouched
 * — same records, same order — whenever ANY record scores above 0.
 * The fuzzy tier is consulted only when the substring tier found
 * nothing at all, so a correctly-spelled search can never gain or lose
 * a record because of this code.
 *
 * Fuzzy scoring mirrors the API list search (applySearchTiers in
 * logistics.service.ts): the whole query must be satisfied inside ONE
 * field value, comparing word tokens — every query token must match a
 * token of that value by equality, by containment (partial typing:
 * "mot" inside "motors"), or by a bounded Damerau edit distance
 * (at most ONE edit for tokens of 4+ chars, none under 4 chars, so
 * short tokens stay strict and a two-letter garble never matches
 * anything). Typo tolerance applies to words only:
 * purely numeric tokens match by equality/containment alone, so a
 * mistyped digit cannot surface the wrong record. Fuzzy scores sit in
 * their own band (30 − index, floored at 5): below every substring
 * score at the same field index, and — because the tiers never mix
 * within one list — they only ever order fuzzy hits among themselves.
 */

export function rankSearchResult(values: unknown[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 1;
  return values.reduce<number>((score, value, index) => {
    const text = String(value ?? "").toLowerCase();
    if (!text) return score;
    if (text === normalizedQuery) return Math.max(score, 100 - index);
    if (text.startsWith(normalizedQuery)) return Math.max(score, 80 - index);
    if (text.includes(normalizedQuery)) return Math.max(score, 50 - index);
    return score;
  }, 0);
}

function searchTokens(value: unknown): string[] {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function maxFuzzyEdits(tokenLength: number): number {
  return tokenLength < 4 ? 0 : 1;
}

/** Bounded Damerau (optimal string alignment) distance check. */
function withinEditDistance(a: string, b: string, maxEdits: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > maxEdits) return false;
  let twoRowsBack: number[] | undefined;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1);
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      // Rows are fully populated for indices 0..b.length by
      // construction, so the ?? 0 fallbacks below never engage; they
      // only satisfy noUncheckedIndexedAccess.
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + substitutionCost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (twoRowsBack?.[j - 2] ?? 0) + 1);
      }
      current[j] = best;
    }
    twoRowsBack = previous;
    previous = current;
  }
  return (previous[b.length] ?? Number.POSITIVE_INFINITY) <= maxEdits;
}

function searchTokenMatches(queryToken: string, fieldToken: string): boolean {
  if (queryToken === fieldToken) return true;
  // Partial typing only in this direction: the query token is a piece
  // of the field token ("mot" inside "motors"). The reverse — a query
  // token that merely CONTAINS a field token — is deliberately not a
  // match: "findxbilty" contains "find", and record ids tokenize to
  // fragments like that, which would rescue a two-letter garble
  // through an unrelated field.
  if (queryToken.length >= 3 && fieldToken.includes(queryToken)) return true;
  if (!/[a-z]/.test(queryToken) || !/[a-z]/.test(fieldToken)) return false;
  const maxEdits = Math.min(maxFuzzyEdits(queryToken.length), maxFuzzyEdits(fieldToken.length));
  if (maxEdits === 0) return false;
  return withinEditDistance(queryToken, fieldToken, maxEdits);
}

/**
 * Typo-tolerant counterpart of rankSearchResult: same per-field shape,
 * token-based matching, scores in the fuzzy band (30 − index, min 5)
 * or 0 when no field satisfies the whole query.
 */
export function fuzzyRankSearchResult(values: unknown[], query: string) {
  const queryTokens = searchTokens(query.trim());
  if (!queryTokens.length) return 0;
  return values.reduce<number>((score, value, index) => {
    const fieldTokens = searchTokens(value);
    if (!fieldTokens.length) return score;
    const satisfied = queryTokens.every((queryToken) =>
      fieldTokens.some((fieldToken) => searchTokenMatches(queryToken, fieldToken))
    );
    return satisfied ? Math.max(score, Math.max(30 - index, 5)) : score;
  }, 0);
}

/**
 * The two-tier rule for ranked lists: substring scores when any record
 * scores above 0 (identical to the pre-PR-10 behaviour, including the
 * empty-query all-1s case); fuzzy scores only when the substring tier
 * found nothing.
 */
export function tieredSearchScores(valuesList: unknown[][], query: string): number[] {
  const substringScores = valuesList.map((values) => rankSearchResult(values, query));
  if (!query.trim() || substringScores.some((score) => score > 0)) return substringScores;
  return valuesList.map((values) => fuzzyRankSearchResult(values, query));
}
