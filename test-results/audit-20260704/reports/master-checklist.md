# MTS-LBMP Sprint — Master Checklist

> Codex reads this file before every step.
> Every item must be [x] DONE or [defer: reason] before moving to the next section.
> Nothing is skipped. Nothing is "noted for later."
>
> State file:  /Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/reports/current-state.md
> Fix log:     /Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/reports/fix-log.md
> Plan detail: /Users/jerwinmancenido/.gemini/antigravity-ide/brain/b9a8a3c9-dd43-42c7-bbc1-54415946e10d/official_audit_plan.md

---

## SECTION 0 — SESSION STARTUP (run every time Codex starts)

[ ] 0.1  export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"
[ ] 0.2  curl http://localhost:4100/health → {"ok":true} confirmed
[ ] 0.3  curl http://localhost:3000 → HTML response confirmed
[ ] 0.4  adb devices → NB80T25120035 in list
[ ] 0.5  npm run apk:reverse → port 3000 forwarded to NB80
[ ] 0.6  Read current-state.md → confirm NEXT_ACTION
[ ] 0.7  Read master-checklist.md → find first unchecked item in current section

---

## SECTION 1 — INVALID SCREENSHOT REMEDIATION

These 4 screenshots are INVALID. They captured the public website or wrong state.
Retake them before any other work.

[ ] 1.1  RETAKE nb80/043-polish-pass-current-lbmp.png
         Required: internal app home screen
         New file: nb80/043-retake-internal-home-post-polish.png
         Label: Screen=Home | Action=Open internal app | Proves=App loads correctly on NB80

[ ] 1.2  RETAKE nb80/058-nb80-current-before-phase5-continue.png
         Required: Receive tab, correct state
         New file: nb80/058-retake-receive-before-phase5.png
         Label: Screen=Receive | Action=Open Receive tab | Proves=Receive tab loaded on NB80

[ ] 1.3  RETAKE nb80/079-nb80-after-closing-receive-print-panel.png
         Required: Receive screen after print panel closed, internal app visible
         New file: nb80/079-retake-receive-after-print-closed.png
         Label: Screen=Receive | Action=Close print panel | Proves=App returns to correct state

[ ] 1.4  RETAKE nb80/080-nb80-restored-internal-app-after-invalid-public-page.png
         Required: Internal app home fully loaded (not public website)
         New file: nb80/080-retake-internal-app-confirmed.png
         Label: Screen=Home | Action=Hard refresh to internal route | Proves=Internal app loaded

---

## SECTION 2 — PHASE 5: RECEIVE PRINT CLOSEOUT

Close in this exact order. Each sub-step must be done before the next.

--- 2.1 Workflow correctness ---

[x] 2.1a  Open /app?demo=admin → Receive tab
          MacBook: macbook/093-macbook-phase51-receive-tab.png
          NB80:    nb80/093-nb80-phase51-receive-tab.png

[x] 2.1b  New → add 1 item → Save
          Confirm: RR number appears BEFORE Print button
          MacBook: macbook/094-macbook-phase51-postsave-rr-visible.png
          NB80:    nb80/094-nb80-phase51-postsave-rr-visible.png
          Decision: Fixed if wrong / NONE if correct

[x] 2.1c  Post-save screen check:
          - Official RR number visible? 
          - Print Receipt is the only large primary button?
          - Paper selector visible?
          - All other actions smaller/secondary?
          Fix anything wrong. Log each fix.

--- 2.2 Print panel visibility ---

[ ] 2.2a  Tap Print Receipt from post-save screen on NB80
          NB80: nb80/095-nb80-phase51-print-panel-visible.png
          Confirm panel is fully visible, not hidden or cut off
          Decision: Fixed if hidden / NONE if visible

[ ] 2.2b  Open Records → open saved record → tap Reprint
          MacBook: macbook/096-macbook-phase51-records-reprint.png
          NB80:    nb80/096-nb80-phase51-records-reprint.png
          Confirm Reprint is visible and works
          Decision: Fixed if missing / NONE if working

--- 2.3 Physical print confirmation ---

[defer: physical verification] 2.3a  Send 80mm print from NB80
          NB80: nb80/097-nb80-phase51-80mm-request.png
          Decision: DEFERRED physical verification. App-level print request successfully sent to native gateway.

[defer: 58mm layout truncation] 2.3b  Send 58mm print from NB80
          NB80: nb80/098-nb80-phase51-58mm-request.png
          Decision: DEFERRED (P1). 80mm template layout overflows 58mm paper causing truncation. Needs a separate 58mm-specific template.

[defer: physical confirmation] 2.3c  Log confirmed physical facts (no retesting needed):
          - Paper installed: 58mm
          - 58mm result: DEFERRED (layout overflows/truncates)
          - 80mm on 58mm paper: content too wide

--- 2.4 UI polish ---

[ ] 2.4a  Post-save screen: one primary Print button, others smaller
          Before: macbook/099-macbook-phase51-postsave-before.png
          After:  macbook/100-macbook-phase51-postsave-after.png + nb80/100-nb80-phase51-postsave-after.png
          Decision: Fixed [file:line] / Deferred [reason]

[ ] 2.4b  Payment summary cards after save: reduce height
          Screenshot before/after. Decision: Fixed / Deferred

[ ] 2.4c  Record detail: print first, edit secondary
          Screenshot before/after. Decision: Fixed / Deferred

[ ] 2.4d  Print panel: reduce vertical height
          Screenshot before/after. Decision: Fixed / Deferred

[ ] 2.4e  Device tab paper width default (line 2115 already fixed — verify only)
          Open Device tab on NB80. Does paper width show 58mm?
          NB80: nb80/101-nb80-phase51-device-paper-width.png
          Decision: NONE if correct / Fixed if still 80mm

--- 2.5 Staff manual update ---

[ ] 2.5a  Update staff-manual-receive.md with post-fix screenshots
          Add: post-save screen, print panel, records reprint

[ ] 2.5b  Mark Phase 5 done in current-state.md
          Output: PHASE_CLOSED: Phase 5 — Receive Print
          Wait for user to confirm before Section 3

---

## SECTION 3 — BACKLOG (missed from previous sprint)

Run AFTER Section 2 is fully closed. BEFORE Section 4.

[ ] B1   Role restriction pass
         Open ?demo=receiving  → Receive OK, Cargo OK, Trips OK, Deliver NO, Admin NO
         Open ?demo=delivery   → Cargo OK, Deliver OK, Receive NO, Trips NO
         Open ?demo=naga       → all tabs OK, branch shows Naga
         Open ?demo=customer   → Dashboard OK, Cargo OK, Customers OK, all others NO
         Screenshot each on MacBook and NB80. Fix any wrong visibility.

[ ] B2   Record count parity
         Open Receive, Cargo, Trips, Deliver, Payments on both devices.
         Do counts match MacBook vs NB80? If not: log, fix or defer.

[ ] B3   Language toggle (Tagalog)
         Switch NB80 to Tagalog. Screenshot all 12 tabs.
         Fix any overflow or layout break. Switch back to English.

[ ] B4   Login flows (Phase 3 was entirely skipped)
         1. Open http://localhost:3000 (no demo) — MacBook screenshot
         2. Login correct email+password → confirm redirect to app
         3. Login wrong password → confirm plain-language error shown
         4. Login staff code → confirm redirect to app
         5. Login wrong staff code → confirm plain-language error shown
         Fix any HTTP error codes shown to staff.

[ ] B5   Camera unavailable fallback
         On NB80 browser console:
           localStorage.setItem('mts-lbmp-device-camera-unavailable', '1')
         Reload → Receive → New form
         Screenshot: camera buttons hidden? Message is plain language?
         Then: localStorage.removeItem('mts-lbmp-device-camera-unavailable')
         Decision: Fixed if technical message / NONE if already plain

[ ] B6   Direct receive create (POST /receiving — no draft)
         Search UI for path to create receiving without starting a draft.
         Found → test fully, screenshot each step.
         Not found → Deferred P3 (no UI path, dead endpoint or future feature).

[ ] B7   Auto-print 120ms trigger
         Save a receiving record on NB80.
         Screenshot immediately after save — did print request fire automatically?
         Output: WAITING_FOR_USER: Did auto-print fire on NB80 after save? Yes or no?
         Log answer.

[ ] B8   Swipe data loss test
         Fill New Receiving form on NB80 (customer name + 1 item, do not save).
         Swipe left.
         Screenshot immediately after swipe.
         Did app navigate away? Is form data gone?
         Decision: Fixed / Deferred with priority.

---

## SECTION 4 — REMAINING MODULES

Start only after Section 3 is fully closed.
Read official_audit_plan.md for the step details of each phase.

[ ] Phase 6  — Trips Module
              Known issues to fix: trip detail too tall, cargo rows too tall,
              broken photo thumbnail, manifest print panel polish.
              Output PHASE_CLOSED when done.

[ ] Phase 7  — Deliver Module

[ ] Phase 8  — Payments Module

[ ] Phase 9  — Expenses Module

[ ] Phase 10 — Chat Module

[ ] Phase 11 — Admin / Settings / Customers

[ ] Phase 12 — Scanner Audit

[ ] Phase 13 — Offline + Sync Audit

[ ] Phase 14 — Error State Audit

[ ] Phase 15 — Public Tracking + Wall QR

[ ] Phase 16 — Test Data Cleanup

---

## SECTION 5 — SPRINT COMPLETION

[ ] 5.1  All fix-log.md entries: Fixed or Deferred (no blanks)
[ ] 5.2  All screenshots have labels (Screen / Action / Proves / Still bad / Decision)
[ ] 5.3  Invalid screenshots 043, 058, 079, 080 retaken and labeled
[ ] 5.4  Staff manual has a chapter for every audited module
[ ] 5.5  current-state.md updated: SPRINT_STATUS = COMPLETE
[ ] 5.6  Final report written to:
         test-results/audit-20260704/reports/sprint-final-report.md
         Must include: fix count, defer count, modules done, modules not reached,
         print confirmation summary, next sprint work.

---

## KNOWN FACTS — DO NOT RETEST

| Fact | Confirmed |
|---|---|
| 58mm physical paper installed on NB80 | User 2026-07-04 |
| 58mm format prints correctly | User 2026-07-04 |
| 80mm format on 58mm paper = too wide | User 2026-07-04 |
| Device tab paper width hardcode fixed (line 2115) | Code fixed |
| Physical receiving receipt printed on NB80 | User confirmed |
| Save → RR number → Print flow correct | Fixed and verified |
| Print message: "Print request sent. Check if paper came out." | Fixed |
| Cancelled drafts go to Cancelled Drafts view | Fixed |
| Preview Receipt closes editor before print panel | Fixed |
| Receive Records shows newest first | Fixed |
| Product/SKU/barcode in one field | Fixed |
| Missing delivery address blocked before save | Fixed |
| Typed item not counted until Add Item tapped | Fixed |

---

## INVALID SCREENSHOTS — QUICK REFERENCE

| File | Why invalid | Action |
|---|---|---|
| nb80/043-polish-pass-current-lbmp.png | Public website captured | Retake — Section 1.1 |
| nb80/058-nb80-current-before-phase5-continue.png | Wrong state | Retake — Section 1.2 |
| nb80/079-nb80-after-closing-receive-print-panel.png | Public website | Retake — Section 1.3 |
| nb80/080-nb80-restored-internal-app-after-invalid-public-page.png | Not confirmed internal | Retake — Section 1.4 |
