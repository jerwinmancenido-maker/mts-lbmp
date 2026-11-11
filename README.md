# MTS LBMP

Mancenido Trucking Services Logistics Business Management Platform.

This workspace is the planning and future implementation home for the app-first logistics platform.

## Baseline

- Blueprint baseline: `docs/blueprint/MTS-LBMP-Blueprint-v2.0-Baseline.md`
- Refinement plan: `docs/blueprint/MTS-LBMP-Blueprint-v2.1-Refinement-Plan.md`
- Sprint roadmap: `docs/sprints/MTS-LBMP-Full-Sprint-Roadmap-v1.md`

## Build Direction

- App-first
- PWA core
- APK/Capacitor-ready
- NB80 Android POS targeted
- Print documents rendered server-side as fixed-width text, printed on the NB80 via the Android NYX gateway route (raw ESC/POS transport planned)
- Package-level QR traceability
- Premium look, simple operation
- Large-button tablet workflows
- English/Tagalog switchable
- Dark mode configurable

## Core MVP

Package traceability comes first:

```text
Receiving
-> QR label
-> Trip assignment
-> Loading
-> Arrival
-> Delivery / failed delivery
-> Proof of delivery
-> Payment status
-> Basic expenses
-> Basic dashboard
```

## Testing

The gate is `npm run typecheck`, `npm run test:unit`, `npm run build`, then
the two smoke suites against a running API (`npm run smoke`,
`npm run smoke:permissions`).

**Credential scan (standing rule, Phase 5 P5-5):** before any PR merges,
scan the diff AND the built web bundle for credential-shaped <redacted>
`password=`, token-shaped values, `sk-`-style API keys, and any real
secret value. The Phase 5 audit found a working credential shipped in
the web bundle; the demo doors that made that possible are deleted, and
this scan is the checklist step that keeps them from creeping back.
Hits must be removed (and, for a real secret, rotated) before merge —
never explained away.

The smoke suites sign in with dedicated smoke accounts, not the demo users.
Boot the API with `ALLOW_DEMO_AUTH=true` (never in production) and a
test-only seed hook provisions the accounts at startup; credentials come
from `SMOKE_EMAIL` / `SMOKE_PASSWORD` and `SMOKE_LIMITED_EMAIL` /
`SMOKE_LIMITED_PASSWORD`, with throwaway local defaults so a fresh clone
passes with zero setup. Full details: `tools/smoke-credentials.mjs` and
`apps/api/src/modules/smoke-seed.ts`.

## Error Policy

Technical and UX issues should be resolved with the best practical recommendation and documented.

Business-rule changes that affect pricing, payment, customer visibility, approvals, legal proof, or owner control must be logged in change control before becoming final.

