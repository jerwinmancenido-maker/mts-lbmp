import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LogisticsService } from "../../apps/api/src/modules/logistics.service";
import type { Customer, ServiceAuditLog } from "../../apps/api/src/modules/logistics.types";

/**
 * Round 1 PR-9 — C-M11 (L25-F1): customer duplicates were created
 * with no warning anywhere. The verifier's probes: with "Findability
 * Motors Inc" (phone 0917 555 0134) on file, an EXACT name+phone
 * duplicate POST returned 201 with a brand-new id, and the
 * near-duplicate "Findability Motors Incorporated" (same phone) did
 * the same; the count went 5 → 7 with no message of any kind.
 *
 * The fix: both create paths (createCustomer / createPendingCustomer)
 * run one duplicate guard before anything is written. Likely
 * duplicates refuse with 409 + the candidate records; only an
 * explicit confirmDuplicate proceeds, and the audit entry then
 * records the override. Deliberate scope, pinned below:
 * - A shared phone ALONE never warns (switchboards / agents' numbers
 *   are legitimately shared); it must come with a similar name or
 *   the same contact person.
 * - Archived records never match.
 * - The warning names only fields of the ordinary customer record —
 *   the same record GET /bootstrap hands to every staff token
 *   (customers are a shared master with no branch scoping), so the
 *   warning discloses nothing the creator cannot already see.
 */

type ServiceInternals = {
  customers: Customer[];
  auditLogs: ServiceAuditLog[];
};

function internals(service: LogisticsService): ServiceInternals {
  return service as unknown as ServiceInternals;
}

const ENV_KEYS = ["INIT_CWD", "MTS_REPOSITORY", "ALLOW_DEMO_AUTH", "NODE_ENV"];
const savedEnv: Record<string, string | undefined> = {};
const tempRoots: string[] = [];

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.MTS_REPOSITORY;
  delete process.env.ALLOW_DEMO_AUTH;
  if (process.env.NODE_ENV === "production") delete process.env.NODE_ENV;
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

/** Boots a service against a fresh throwaway state dir. */
async function bootService() {
  const dir = mkdtempSync(join(tmpdir(), "mts-customer-duplicate-"));
  tempRoots.push(dir);
  process.env.INIT_CWD = dir;
  const service = new LogisticsService();
  await service.onModuleInit();
  return service;
}

type CreateInput = Parameters<LogisticsService["createCustomer"]>[0];

function captureConflict(run: () => unknown) {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ConflictException);
  const response = (thrown as ConflictException).getResponse() as {
    message: string;
    possibleDuplicates: { id: string; businessName: string; matchedOn: string }[];
    requiresDuplicateConfirmation: boolean;
  };
  expect(response.requiresDuplicateConfirmation).toBe(true);
  return response;
}

const FINDABILITY: CreateInput = {
  businessName: "Findability Motors Inc",
  phone: "0917 555 0134",
  companyPhone: "052 555 0134",
  contactPerson: "Faye Santos"
};

describe("C-M11 — customer duplicates warn before saving", () => {
  test("the round's exact probe: identical name+phone re-create is refused 409 and writes nothing", async () => {
    const service = await bootService();
    const existing = service.createCustomer({ ...FINDABILITY });
    const countBefore = internals(service).customers.length;

    const response = captureConflict(() => service.createCustomer({ ...FINDABILITY }));

    expect(response.possibleDuplicates).toHaveLength(1);
    expect(response.possibleDuplicates[0].id).toBe(existing.id);
    expect(response.possibleDuplicates[0].matchedOn).toBe("same name");
    expect(response.message).toContain("Findability Motors Inc");
    expect(internals(service).customers.length).toBe(countBefore);
  });

  test("the round's near-duplicate probe: '…Incorporated' with the same phone is refused as the same name", async () => {
    const service = await bootService();
    const existing = service.createCustomer({ ...FINDABILITY });

    const response = captureConflict(() =>
      service.createCustomer({ businessName: "Findability Motors Incorporated", phone: "0917 555 0134", contactPerson: "Faye Santos" })
    );

    expect(response.possibleDuplicates[0].id).toBe(existing.id);
    expect(response.possibleDuplicates[0].matchedOn).toBe("same name");
    expect(internals(service).customers).toHaveLength(1);
  });

  test("an explicit confirmDuplicate creates anyway — a deliberate override, recorded in the audit entry", async () => {
    const service = await bootService();
    const existing = service.createCustomer({ ...FINDABILITY });

    const created = service.createCustomer({ ...FINDABILITY, confirmDuplicate: true });

    expect(created.id).not.toBe(existing.id);
    expect(internals(service).customers).toHaveLength(2);
    const entry = internals(service).auditLogs.find((log) => log.action === "customers.create" && log.entityId === created.id);
    expect(entry?.after).toMatchObject({ duplicateConfirmed: true, duplicateOf: [existing.id] });
  });

  test("a genuinely different customer creates with no warning", async () => {
    const service = await bootService();
    service.createCustomer({ ...FINDABILITY });

    const created = service.createCustomer({
      businessName: "Unrelated Logistics Corp",
      phone: "0918 111 2222",
      contactPerson: "Marco Reyes"
    });

    expect(created.businessName).toBe("Unrelated Logistics Corp");
    expect(internals(service).customers).toHaveLength(2);
  });

  test("a shared phone ALONE does not warn: different name and different contact create freely", async () => {
    const service = await bootService();
    service.createCustomer({ ...FINDABILITY });

    // Same handset (e.g. a shared agent number), unrelated business.
    const created = service.createCustomer({
      businessName: "Completely Different Trading",
      phone: "0917 555 0134",
      contactPerson: "Josefa Lim"
    });

    expect(created.id).toBeTruthy();
    expect(internals(service).customers).toHaveLength(2);
  });

  test("same phone (+63 format) and a similar — not identical — name warns as 'same phone and similar name'", async () => {
    const service = await bootService();
    const existing = service.createCustomer({ ...FINDABILITY });

    const response = captureConflict(() =>
      service.createCustomer({ businessName: "Findability Motors Daet", phone: "+63 917 555 0134", contactPerson: "Ramon Uy" })
    );

    expect(response.possibleDuplicates[0].id).toBe(existing.id);
    expect(response.possibleDuplicates[0].matchedOn).toBe("same phone and similar name");
    expect(internals(service).customers).toHaveLength(1);
  });

  test("same phone and the same contact person warns even when the business name differs", async () => {
    const service = await bootService();
    const existing = service.createCustomer({ ...FINDABILITY });

    const response = captureConflict(() =>
      service.createCustomer({ businessName: "F Santos Enterprises", phone: "0917 555 0134", contactPerson: "Faye Santos" })
    );

    expect(response.possibleDuplicates[0].id).toBe(existing.id);
    expect(response.possibleDuplicates[0].matchedOn).toBe("same phone and contact person");
  });

  test("the receiving path (createPendingCustomer) runs the same guard, and its override is audited", async () => {
    const service = await bootService();
    const existing = service.createPendingCustomer({
      businessName: "Findability Motors Inc",
      phone: "0917 555 0134",
      contactPerson: "Faye Santos",
      reviewBranchName: "Daet"
    });
    expect(existing.status).toBe("Pending");

    const response = captureConflict(() =>
      service.createPendingCustomer({ businessName: "Findability Motors Inc", phone: "0917 555 0134", reviewBranchName: "Daet" })
    );
    expect(response.possibleDuplicates[0].id).toBe(existing.id);
    expect(internals(service).customers).toHaveLength(1);

    const created = service.createPendingCustomer({
      businessName: "Findability Motors Inc",
      phone: "0917 555 0134",
      reviewBranchName: "Daet",
      confirmDuplicate: true
    });
    expect(created.status).toBe("Pending");
    const entry = internals(service).auditLogs.find((log) => log.action === "customer.pending_created" && log.entityId === created.id);
    expect(entry?.after).toMatchObject({ duplicateConfirmed: true, duplicateOf: [existing.id] });
  });

  test("an Archived namesake never matches — the name is free again", async () => {
    const service = await bootService();
    const existing = service.createCustomer({ ...FINDABILITY });
    internals(service).customers.find((customer) => customer.id === existing.id)!.status = "Archived";

    const created = service.createCustomer({ ...FINDABILITY });

    expect(created.id).not.toBe(existing.id);
    expect(internals(service).customers).toHaveLength(2);
  });

  test("the warning payload carries only fields of the ordinary customer record the creator can already list", async () => {
    const service = await bootService();
    const existing = service.createCustomer({ ...FINDABILITY });

    const response = captureConflict(() => service.createCustomer({ ...FINDABILITY }));
    const candidate = response.possibleDuplicates[0] as unknown as Record<string, unknown>;

    expect(Object.keys(candidate).sort()).toEqual(
      ["businessName", "companyPhone", "contactPerson", "id", "matchedOn", "phone", "status"].sort()
    );
    // Every disclosed value is exactly the value on the listed record.
    const listed = internals(service).customers.find((customer) => customer.id === existing.id)!;
    expect(candidate.businessName).toBe(listed.businessName);
    expect(candidate.phone).toBe(listed.phone);
    expect(candidate.companyPhone).toBe(listed.companyPhone);
    expect(candidate.contactPerson).toBe(listed.contactPerson);
    expect(candidate.status).toBe(listed.status);
  });
});
