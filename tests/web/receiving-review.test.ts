import { describe, expect, test } from "vitest";
import {
  UNRESOLVED_RECEIVING_BRANCH,
  receivingBranchCounts,
  resolveReceivingLineBranch,
  withResolvedLineBranches
} from "../../apps/web/src/app/ui/receiving-review";

/**
 * Review Receiving branch composition (Round 1 L1 re-capture
 * OBS-L1R-01).
 *
 * The defect: the review grouped the lines to save by each line's raw
 * handlingBranchName and rendered the group key as the branch name. A
 * draft created through the API stored its product line verbatim with
 * no branch; resuming that draft and opening Review Receiving grouped
 * the line under the key "undefined" and the card read «undefined —
 * 1 item will be recorded for this branch.» (with a "Changed line"
 * pill).
 *
 * The fix pinned here: the grouping resolves every line's branch
 * through the receiving session's branch context — the form branch,
 * itself restored from the draft's destination — and restored lines
 * are filled from that same context when the draft is composed into
 * the form. A branch that genuinely cannot be resolved renders as the
 * truthful generic "This branch". The key can never be "undefined"
 * and never blank.
 */

describe("resolveReceivingLineBranch (OBS-L1R-01)", () => {
  test("a line's own branch wins over the session branch", () => {
    expect(resolveReceivingLineBranch("Naga", "Daet")).toBe("Naga");
  });

  test("a branchless line resolves from the session branch context", () => {
    expect(resolveReceivingLineBranch(undefined, "Daet")).toBe("Daet");
    expect(resolveReceivingLineBranch(null, "Daet")).toBe("Daet");
    expect(resolveReceivingLineBranch("", "Daet")).toBe("Daet");
    expect(resolveReceivingLineBranch("   ", "Daet")).toBe("Daet");
  });

  test("an unresolvable branch is the truthful generic — never 'undefined', never blank", () => {
    expect(resolveReceivingLineBranch(undefined, undefined)).toBe(UNRESOLVED_RECEIVING_BRANCH);
    expect(resolveReceivingLineBranch("", "")).toBe(UNRESOLVED_RECEIVING_BRANCH);
    expect(UNRESOLVED_RECEIVING_BRANCH).not.toBe("undefined");
    expect(UNRESOLVED_RECEIVING_BRANCH.trim()).not.toBe("");
  });
});

describe("receivingBranchCounts (OBS-L1R-01)", () => {
  test("the filed case: an API-created draft's branchless line groups under the draft's branch", () => {
    // The seeded draft: destination "Daet", one product line stored
    // with no handlingBranchName at all. Before the fix this grouped
    // under the key "undefined".
    const counts = receivingBranchCounts([{ description: "Draft line item" }], "Daet");
    expect(counts).toEqual({ Daet: 1 });
    expect(Object.keys(counts)).not.toContain("undefined");
  });

  test("deliberate per-line branches survive — the 'Changed line' case", () => {
    const counts = receivingBranchCounts(
      [{ handlingBranchName: "Daet" }, { handlingBranchName: "Naga" }, { handlingBranchName: "Daet" }],
      "Daet"
    );
    expect(counts).toEqual({ Daet: 2, Naga: 1 });
  });

  test("no line can produce an 'undefined' or blank group key", () => {
    const counts = receivingBranchCounts(
      [{ handlingBranchName: undefined }, { handlingBranchName: "" }, {}],
      ""
    );
    expect(Object.keys(counts)).toEqual([UNRESOLVED_RECEIVING_BRANCH]);
    expect(counts[UNRESOLVED_RECEIVING_BRANCH]).toBe(3);
  });
});

describe("withResolvedLineBranches (OBS-L1R-01)", () => {
  test("restored branchless lines are filled from the draft/session branch", () => {
    const lines = [{ description: "Draft line item" }, { description: "Other", handlingBranchName: "Naga" }];
    const resolved = withResolvedLineBranches(lines, "Daet");
    expect(resolved[0].handlingBranchName).toBe("Daet");
    expect(resolved[1].handlingBranchName).toBe("Naga");
  });

  test("the stored lines are not mutated", () => {
    const lines = [{ description: "Draft line item" }];
    withResolvedLineBranches(lines, "Daet");
    expect(lines[0]).toEqual({ description: "Draft line item" });
  });

  test("with no session branch to resolve from, lines pass through untouched", () => {
    const lines = [{ description: "Draft line item" }];
    expect(withResolvedLineBranches(lines, "")).toBe(lines);
    expect(withResolvedLineBranches(lines, undefined)).toBe(lines);
  });
});
