# MTS LBMP Audit Plan Compliance Tracker

Audit date: 2026-07-04

This file exists to keep the sprint aligned with `/Users/jerwinmancenido/Downloads/official_audit_plan.md`.

## Current Truth

The official plan says this is a fix sprint, not a status report:

`Find problem -> Fix it immediately -> Screenshot the fix -> Write the manual chapter -> Move on`

## What Has Been Done

- NB80 wireless ADB connection verified.
- APK reverse ports verified for web `3000` and API `4100`.
- Production web/API for tablet restarted and APK hard-refreshed.
- Smoke test passed after changes.
- Typecheck passed after the latest Receive UI change.
- Baseline screenshots exist for Home and all main modules on MacBook and NB80.
- Receive New screen was opened on NB80.
- Receive product/SKU/barcode autocomplete was verified on NB80.
- Receive customer autocomplete was verified on NB80.
- Receive receiver autocomplete was verified on NB80.
- On-screen Scan button is no longer present in Add Item, matching the physical side-scanner workflow.
- Receive saved-record detail now exposes:
  - Save Changes with Audit
  - Reprint Receipt
  - Preview Receipt
  - Add DR Image
- Receive missing delivery address is now blocked before server save with a plain-language warning and blackbox issue log.
- Receive no longer counts a typed/scanned product as an item until staff taps Add Item.
- Receive valid save path was verified on NB80 with official RR number and Print Receipt controls visible.
- Physical NB80 receiving print was confirmed by the user for `RR-2026-07-000620`.
- Receive saved-record `Preview Receipt` visibility issue was found on MacBook, fixed, rebuilt, and screenshot-verified.
- Receive saved-record print request on NB80 was screenshot-verified through the native printer gateway.
- Receive saved-record print panel was retested on NB80 after the visibility fix.
- Receive saved-record `View Preview` now auto-scrolls receipt content into view on NB80.
- Receive print request success message now uses staff-facing wording: `Print request sent. Check if paper came out.`
- Receive receipt paper-size selector was validated on NB80 with 80mm and 58mm choices.
- Receive receipt 58mm print request was sent on NB80 and screenshot-verified.
- Screenshot discipline correction logged after a tablet capture landed on the public website instead of the internal app.
- Receive Active Drafts list was validated on NB80 and MacBook.
- Receive draft Resume was validated on NB80 and MacBook.
- Receive draft Cancel initially failed the view-label rule, was fixed, rebuilt, retested, and validated on NB80 and MacBook.
- Receive staff manual chapter was updated with corrected new receiving, records, reprint, active draft, and cancelled draft workflow.

## What Was Missed / Incomplete

- Phase 1 readiness is not fully written as a checklist result.
- Phase 2 role restriction pass is not complete.
- Phase 3 real login flow is not complete.
- Phase 4 Receive is complete for the current audit scope. Remaining receive work is UI polish/backlog only.
- Phase 5 Print is partially complete:
  - Receiving saved record reprint controls exist.
  - Receiving saved record preview visibility was fixed on MacBook.
  - NB80 print panel visibility was retested after the preview visibility fix.
  - NB80 View Preview auto-scroll was fixed and screenshot-verified.
  - NB80 print request staff wording was fixed and screenshot-verified.
  - NB80 58mm request was screenshot-verified.
  - Remaining: physical paper confirmation for the latest saved-record flow, 58mm/80mm output sizing confirmation, and remaining document print buttons.
- Staff manual does not exist yet.
- One earlier Receive audit report contains false failures from a bad automation selector:
  `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/reports/phase4-receive-live-audit.json`
- Screenshot index does not yet include every new screenshot.
- Fix log is incomplete because it only contains the Receive reprint fix.
- Error state library is not complete.
- Offline/sync audit is not complete.
- Public tracking and wall QR intake are not complete.
- Cleanup phase is not complete.

## Correction Rule From This Point

Do not mark a phase complete until:

- Every required step is tested or explicitly deferred.
- Every live-fix issue is fixed and retested on NB80.
- Every fix has an NB80 screenshot.
- Every relevant screenshot is shown to the user or explicitly referenced with its absolute path.
- Every screenshot includes a short note for:
  - what it proves
  - what should be improved
- Every deferred item has priority and reason.
- The staff manual chapter for the completed module is written.

## Screenshot Validity Gate

Every screenshot must be classified before it can count as proof:

- `VALID PROOF` - expected screen, expected action result, and expected status/message are visible.
- `INVALID - wrong screen` - screenshot landed on the wrong page or public website.
- `INVALID - no action result shown` - action was tapped, but the result is not visible.
- `INVALID - needs physical confirmation` - app request is visible, but paper/device output cannot be proven by screenshot.
- `DEFERRED - cannot verify by ADB` - requires human/device confirmation or unsupported hardware access.

For every valid screenshot, record:

- screen name
- action tested
- what it proves
- what should improve
- whether tracker/manual/fix log was updated

Do not stop after one proof unless the current phase is complete, blocked, or the user explicitly asks for status.

## Immediate Next Steps

1. Continue Phase 5 Print audit on NB80:
   - Confirm physical paper output after the latest staff-wording fix.
   - Confirm 80mm and 58mm sizing with actual paper.
   - Log any mismatch between MacBook and NB80.
2. Continue the remaining Phase 5 print matrix:
   - Receiving Slip
   - QR Label
   - Loading Manifest
   - Delivery Receipt
   - ESC/POS Preview
3. Continue Phase 6 Trips only after Phase 5 is passed or deferred with reason.
