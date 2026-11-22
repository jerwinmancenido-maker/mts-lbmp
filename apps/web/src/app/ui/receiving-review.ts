/**
 * Receiving review branch composition (extracted from app-shell.tsx
 * so the resolution is unit-testable — the same reason
 * search-ranking.ts, dashboard-tiles.ts and search-overlay.ts were
 * extracted before it).
 *
 * Round 1 L1 re-capture OBS-L1R-01: the Review Receiving step grouped
 * the lines to save by each line's raw handlingBranchName and rendered
 * the group key as the branch name. Drafts are stored verbatim, and a
 * draft created through the API may carry product lines with no branch
 * of their own; resuming such a draft grouped its line under the key
 * "undefined", and the review announced «undefined — 1 item will be
 * recorded for this branch.» Manual lines always carry a branch
 * (adding an item is blocked without one), so restored lines — and
 * OCR lines read before a branch is chosen — are the paths that can
 * arrive branchless.
 *
 * The resolution is the receiving flow's own order: the line's
 * branch, then the session's branch context (the form branch, itself
 * restored from the draft's destination), then a truthful generic
 * label — never "undefined", never blank.
 */

export const UNRESOLVED_RECEIVING_BRANCH = "This branch";

/** The branch a receiving line belongs to, resolved at composition. */
export function resolveReceivingLineBranch(
  lineBranch: string | null | undefined,
  sessionBranch: string | null | undefined
): string {
  const own = (lineBranch ?? "").trim();
  if (own) return own;
  const session = (sessionBranch ?? "").trim();
  return session || UNRESOLVED_RECEIVING_BRANCH;
}

/**
 * The Review Receiving branch grouping: how many lines will be
 * recorded for each branch, with every line's branch resolved through
 * {@link resolveReceivingLineBranch} so a branchless line can never
 * surface as an "undefined" (or blank) branch name.
 */
export function receivingBranchCounts(
  lines: Array<{ handlingBranchName?: string | null }>,
  sessionBranch: string | null | undefined
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const branch = resolveReceivingLineBranch(line.handlingBranchName, sessionBranch);
    counts[branch] = (counts[branch] ?? 0) + 1;
  }
  return counts;
}

/**
 * Fill branchless lines from the draft/session branch context when a
 * stored draft (server draft or the tablet's persisted form snapshot)
 * is composed back into the receiving form. Lines that already carry
 * a branch keep it — a deliberate per-line branch change is the
 * "Changed line" case the review exists to surface. With no session
 * branch to resolve from, the lines pass through untouched (the
 * review grouping still labels them truthfully).
 */
export function withResolvedLineBranches<T extends { handlingBranchName?: string | null }>(
  lines: T[],
  sessionBranch: string | null | undefined
): T[] {
  const session = (sessionBranch ?? "").trim();
  if (!session) return lines;
  return lines.map((line) => ((line.handlingBranchName ?? "").trim() ? line : { ...line, handlingBranchName: session }));
}
