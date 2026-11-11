# MTS LBMP Change-Control Log

Blueprint v2.0 is the baseline. Future changes should be recorded here before they become final.

## Change Types

```text
CR   - Change Request
NCR  - Non-Conformance / Gap
ENH  - Enhancement
RISK - Risk Item
P2   - Phase 2 Backlog
ASM  - Assumption
```

## Priority Levels

```text
P0 - Blocks development or release
P1 - Required for MVP
P2 - Important but can follow MVP
P3 - Nice to have
```

## Statuses

```text
New
Under Review
Approved
Rejected
Deferred
In Progress
Done
Closed
```

## Log

| ID | Date | Type | Priority | Module | Title | Decision | Status |
|---|---|---|---|---|---|---|---|
| CR-001 | 2026-07-01 | CR | P1 | Receiving | Add package condition at receiving | Approved for MVP | Approved |
| CR-002 | 2026-07-01 | CR | P1 | Delivery | Add failed delivery workflow | Approved for MVP | Approved |
| CR-003 | 2026-07-01 | CR | P1 | Receiving | Use Product / Package Description only | Approved for MVP | Approved |
| CR-004 | 2026-07-01 | CR | P2 | Receiving | Customer DR OCR assist | Approved as assistive, not authoritative | Approved |
| RISK-001 | 2026-07-01 | RISK | P0 | Hardware | NB80 PWA hardware access uncertain | Validate with prototype; prepare APK path | New |
| RISK-002 | 2026-07-01 | RISK | P1 | Security | npm audit reports transitive Next/Nest dependency advisories requiring forced breaking changes | Do not force downgrade; monitor patched releases and retest before production | New |
| ASM-001 | 2026-07-01 | ASM | P1 | UX | Premium look, simple operation | Accepted design rule | Approved |
| CR-005 | 2026-11-11 | CR | P1 | Platform | Production database is Supabase Postgres (via Prisma) instead of self-hosted MySQL | Jerwin approved 2026-11-11; hosting + pooling managed by Supabase, API and endpoints unchanged | Approved |

## Entry Template

| Field | Value |
|---|---|
| ID |  |
| Date |  |
| Type |  |
| Priority |  |
| Module |  |
| Title |  |
| Description |  |
| Reason |  |
| Requested by |  |
| MVP impact |  |
| Decision |  |
| Owner |  |
| Status |  |
