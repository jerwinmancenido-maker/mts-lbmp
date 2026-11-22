/**
 * Semantic status tones for the pill/badge system (extracted from
 * app-shell.tsx in Round 1 fix loop PR-12 so the mapping is
 * unit-testable, the same reason search-ranking.ts was extracted in
 * PR-10 and dashboard-tiles.ts in PR-11).
 *
 * PR-12 (canonical findings C-M15 + recommendation R2; filed as
 * L1 B-F1 = C-F4 for contrast and B-F2/F3 for semantics) — before
 * this fix every status pill rendered in the signed-in role's
 * accent colour: "Failed Delivery" wore the same blue as "Arrived",
 * so colour carried no state information at all, and the pairing
 * (#2563eb on #dbeafe at 14px) measured 4.24:1, below the WCAG AA
 * 4.5:1 floor for normal text. Under the receiving and delivery
 * role themes the same pairing was worse (3.00:1 and 1.93:1).
 *
 * The mapping below is keyed by the status STRING across every
 * status vocabulary the shell renders (cargo, trips, payments,
 * invoices, expenses, customers, chat threads, intake tasks, the
 * offline queue, device checks). Strings that appear in more than
 * one vocabulary were checked to carry the same meaning in each
 * ("Arrived", "Cancelled", "Approved", "Pending", "Active", …),
 * so one flat table stays honest. Any status not listed renders
 * neutral — a new status can never accidentally borrow a meaning.
 *
 * The tone colours live in styles.css (.badge.tone-*); every
 * text/background pair there measures at least 4.5:1 (the table is
 * filed with PR-12 and pinned by tests/web/status-tone.test.ts,
 * which recomputes the ratios from the shipped CSS).
 */

export type StatusTone = "success" | "progress" | "attention" | "problem" | "neutral";

const STATUS_TONES: Record<string, StatusTone> = {
  // Success — the work reached a good end state.
  Delivered: "success",
  Arrived: "success",
  Completed: "success",
  Paid: "success",
  Approved: "success",
  Active: "success",
  Synced: "success",
  Pass: "success",

  // Progress — the work is moving through the pipeline.
  Received: "progress",
  Loaded: "progress",
  "In Transit": "progress",
  "Ready for Delivery": "progress",
  Loading: "progress",
  Departed: "progress",
  Unloading: "progress",
  Issued: "progress",
  Open: "progress",
  "In Review": "progress",
  Syncing: "progress",

  // Attention — waiting on a person, a price, a payment, a review.
  "Waiting for Price": "attention",
  "Waiting for Loading": "attention",
  "Partially Paid": "attention",
  "Partially Delivered": "attention",
  Unpaid: "attention",
  Overpaid: "attention",
  Pending: "attention",
  Submitted: "attention",
  "Needs Approval": "attention",
  "Pending Review": "attention",
  "No Price": "attention",

  // Problem — something failed or is late; staff must act.
  "Failed Delivery": "problem",
  Exception: "problem",
  Overdue: "problem",
  Rejected: "problem",
  Failed: "problem",
  Fail: "problem",

  // Neutral — not yet started, or closed with nothing left to do.
  Draft: "neutral",
  Planned: "neutral",
  Cancelled: "neutral",
  Void: "neutral",
  Voided: "neutral",
  Archived: "neutral",
  Inactive: "neutral"
};

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONES[status] ?? "neutral";
}

/** Badge class for an explicit tone (sites whose text is a label, not a status string). */
export function toneBadgeClass(tone: StatusTone): string {
  return `badge tone-${tone}`;
}

/** Badge class for a rendered status string — the shared pill treatment. */
export function statusBadgeClass(status: string | null | undefined): string {
  return toneBadgeClass(statusTone(status));
}
