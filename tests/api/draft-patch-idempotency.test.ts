import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type { ServiceAuditLog } from "../../apps/api/src/modules/logistics.types";

/**
 * Phase 4 PR 3 — A3 server half: queued receiving-draft updates.
 *
 * Draft PATCHes became queueable offline (queueablePatch), so the API now
 * honours the Idempotency-Key header on PATCH /receiving/drafts/:id with
 * the same runIdempotent seam as the other queueable writes (Phase 4 B1):
 * a replayed update — first response lost, queue replays with the same
 * key — returns the stored result and does not re-apply the update, so a
 * draft can never gain duplicate versions from retries. Unkeyed updates
 * keep the historical behaviour.
 */

type ServiceInternals = {
  auditLogs: ServiceAuditLog[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

function draftUpdatedAudits(service: LogisticsService): number {
  return internals(service).auditLogs.filter((log) => log.action === "receiving.draft_updated").length;
}

let tempRoot = "";
let previousInitCwd: string | undefined;
let previousRepository: string | undefined;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "mts-lbmp-phase4-pr3-"));
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

describe("A3 — draft PATCH idempotency", () => {
  test("same key twice applies the update once and returns the original result", () => {
    const service = new LogisticsService();
    const draft = service.createReceivingDraft({ formState: { senderName: "Before" }, productLines: [] });

    const update = { formState: { senderName: "After" }, productLines: [{ id: "line-1" }] };
    const first = service.updateReceivingDraft(draft.id, { ...update, idempotencyKey: "queue_draft_patch_key" });
    const second = service.updateReceivingDraft(draft.id, { ...update, idempotencyKey: "queue_draft_patch_key" });

    expect(second).toEqual(first);
    expect(second).not.toBe(first); // stored result is a copy, like B1
    expect(second.updatedAt).toBe(first.updatedAt);
    expect(draftUpdatedAudits(service)).toBe(1); // applied exactly once
    expect(first.formState).toEqual({ senderName: "After" });
  });

  test("a different key is a new intent and applies again", () => {
    const service = new LogisticsService();
    const draft = service.createReceivingDraft({ formState: {}, productLines: [] });

    service.updateReceivingDraft(draft.id, { customerDrNumber: "DR-1", idempotencyKey: "queue_key_a" });
    const again = service.updateReceivingDraft(draft.id, { customerDrNumber: "DR-2", idempotencyKey: "queue_key_b" });

    expect(draftUpdatedAudits(service)).toBe(2);
    expect(again.customerDrNumber).toBe("DR-2");
  });

  test("unkeyed updates keep applying (historical behaviour)", () => {
    const service = new LogisticsService();
    const draft = service.createReceivingDraft({ formState: {}, productLines: [] });

    service.updateReceivingDraft(draft.id, { customerDrNumber: "DR-1" });
    service.updateReceivingDraft(draft.id, { customerDrNumber: "DR-2" });

    expect(draftUpdatedAudits(service)).toBe(2);
  });
});
