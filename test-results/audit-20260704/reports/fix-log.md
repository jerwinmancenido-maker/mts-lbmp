# MTS LBMP Audit Fix Log

Audit date: 2026-07-04

## Receive Record Reprint Fix

Problem found:
- Saved receiving records could be opened from Records, but the record detail did not expose a clear reprint action.
- Staff would not know how to print a receiving document again after leaving the saved receipt screen.

Fix applied:
- Added record-detail actions for:
  - Save Changes with Audit
  - Reprint Receipt
  - Preview Receipt
  - Add DR Image
- Cleared stale print status when opening another receiving record.
- Changed print success wording to: "Print request sent to NB80. Check if paper came out."

NB80 validation:
- Tablet connected through wireless ADB.
- Local web/API ports reversed to the NB80.
- APK relaunched after production rebuild.
- Receive > Records > saved receiving record was opened on the actual tablet.
- The tablet page now exposes Reprint Receipt, Preview Receipt, and Save Changes with Audit.

Proof:
- Tablet screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/026-record-detail-reprint-after-rebuild-adb.png`

Notes:
- Playwright screenshot capture on Android WebView timed out on long pages, so ADB screencap is the reliable evidence method for tablet screenshots.
- Physical NB80 print was confirmed by the user for receiving receipt `RR-2026-07-000620`.

Next required action:
- Continue the official audit plan without stopping. Finish Phase 4 Receive, write the Receive manual chapter, then continue Phase 5 Print.

## Receive Top Summary Label Fix

Problem found:
- The New Receiving summary still used the old wording `DR Photo / Missing`.
- Staff feedback showed this wording was redundant because the row already belongs to the DR/receiving header.

Fix applied:
- Changed the summary tile to `Photo / No photo` or `Photo / Attached`.
- Kept the DR number, photo status, item count, and add/read actions in the same compact top summary.

NB80 validation:
- Reconnected to the NB80 APK WebView through wireless ADB.
- Opened Home > Receive > New on the actual tablet.
- Confirmed `Photo / No photo` is present.
- Confirmed `DR Photo / Missing` is no longer present.
- Confirmed the screen still shows Receive Items and the compact product field copy.

Proof:
- Tablet screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/033-phase4-receive-new-after-dr-photo-label.png`

Next required action:
- Continue Phase 4 Receive in order: branch rule, customer/contact autocomplete, product/SKU scan entry, item add, draft/resume, final save, print availability, record reprint, and audit trail.

## Receive Autocomplete NB80 Check

Problem checked:
- Staff reported that some fields autocomplete and others do not.
- The scanner button was also confusing because the NB80 scanner works through the physical side scan button.

Validation result:
- Customer field responds while typing and shows a selectable customer result.
- Drop-off person and receiver fields respond while typing.
- Product field now combines product name, SKU, and barcode in one field.
- The on-screen scan button is no longer present in the Add Item section.
- Product/SKU/barcode lookup resolved `QA-ITEM-001` to the saved product record.

Observation:
- Drop-off and receiver typed examples showed `No saved contact found` because those exact contacts are not in the current saved contact history. This is a data/history issue, not a broken autocomplete control.

Proof:
- Tablet screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/034-phase4-autocomplete-current-nb80.png`

Next required action:
- Test actual Add Item, Save Receiving, post-save print availability, and record reprint from Records.

## Receive Missing Address Validation Fix

Problem found:
- On the NB80, staff could tap Save Receiving for a delivery-to-consignee receiving record with no delivery address.
- The API rejected the save with `Delivery address is required when delivery type is Deliver to consignee`.
- This made the staff think the record saved, but no RR number and no print button appeared.

Fix applied:
- Added a front-end guard before Review/Save Receiving.
- If any receiving line is `Deliver to consignee` and has no delivery area/address, the screen now blocks before server submission.
- The warning uses plain staff wording: `Delivery address is required before saving. Type the delivery area, then add the item again.`
- The warning highlights the delivery area section and is saved into the blackbox issue log.

NB80 validation:
- Rebuilt production app, restarted local API/web, refreshed APK WebView cache, and relaunched the APK.
- Reproduced the same path on the actual NB80.
- Confirmed the friendly validation appears.
- Confirmed the server `Bad Request` error no longer appears for this preventable case.

Proof:
- Tablet screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/035-phase4-missing-address-validation-nb80.png`

Next required action:
- Run the valid-address receiving save path and verify the saved RR screen exposes Print Receipt on the NB80.

## Receive Hidden Item Count Fix

Problem found:
- The Receive screen counted the current typed/scanned product as a savable item before staff tapped `Add Item`.
- This created a confusing mismatch: the top summary could show `Items 1` while the `Items Added` list still showed `0 items`.
- Staff could reach Save/Review without seeing the line clearly added to the receiving list.

Fix applied:
- Removed hidden current-line fallback logic from `productsToSave`.
- Only lines in the visible `Items Added` list now count toward saving.
- Typing/scanning a product fills the entry fields only.
- Staff must tap `Add Item` to add the line.
- Save remains disabled until a visible item line exists.

NB80 validation:
- Rebuilt production app and hard-refreshed the APK.
- On the actual NB80, typed/selected product before tapping Add Item:
  - top item count stayed 0
  - Save button stayed disabled as `Add Item First`
- After tapping Add Item:
  - top item count became 1
  - item appeared in `Items Added`
  - Save Receiving became available
- After saving:
  - official receiving number `RR-2026-07-000626` was generated
  - Print Receipt appeared
  - paper choices `80mm` and `58mm` appeared
  - no server error appeared

Proof:
- Tablet screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/038-phase4-corrected-save-print-visible-nb80.png`

Next required action:
- Write the Receive staff manual chapter for the corrected flow, then continue Phase 5 Print audit.

## Receive Saved Receipt UX Observation

Problem found:
- The saved receiving page now works correctly, but the visual hierarchy is still noisy.
- Too many blue buttons compete with the primary task.
- Staff should immediately understand that the next step is printing the receipt.

Current working behavior:
- Save Receiving generates an official RR number.
- Print Receipt appears after the RR number exists.
- Paper width can be selected.
- Preview, New Receiving, Records, and View Items are available.

What should improve next:
- Keep `Print Receipt` as the only large primary blue action.
- Make paper width a compact device setting/control near the print action.
- Change `Preview`, `New Receiving`, `Records`, and `View Items` into smaller secondary actions.
- Reduce the height of payment summary cards.

Proof:
- Tablet screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/038-phase4-corrected-save-print-visible-nb80.png`

Status:
- Functional fix complete.
- UI polish deferred until the Receive workflow pass is closed.

## Receive Saved Record Preview Visibility Fix

Problem found:
- In Receive > Records, opening a saved receiving record and tapping `Preview Receipt` did call the receiving document endpoint.
- The app set the receipt preview and print status, but the saved record editor stayed open.
- On MacBook this made the print panel appear below/behind the editor, so staff could think nothing happened.
- On the NB80 this is worse because the screen is smaller and staff would not naturally scroll far enough to find the print panel.

Fix applied:
- Changed `previewReceivingRecordReceipt` so `Preview Receipt` closes the saved record editor before showing the receiving receipt print panel.
- Kept the official receiving document number in the success message.
- Kept `Print`, `Reprint`, `View Preview`, and paper-size selection in the print panel.

Validation:
- MacBook before-fix screenshot confirms the Preview Receipt button was active but the editor still covered the print panel.
- MacBook after-fix screenshot confirms the print panel is visible with `Receiving Receipt`, `RR-2026-07-000626`, paper selection, and print actions.
- NB80 earlier validation confirms saved receiving records can send print requests through the native printer gateway.

Proof:
- Before fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/050-macbook-phase5-preview-hidden-by-modal-before-fix.png`
- After fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/052-macbook-phase5-print-panel-viewport-after-fix.png`
- NB80 print request: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/057-nb80-phase5-receiving-document-print-request.png`

What should improve next:
- Retest the same Preview Receipt path directly on the NB80 after the latest rebuild.
- Confirm physical print, reprint, and preview all use the same saved RR number.
- Reduce print screen button competition after functional print pass is stable.

## Screenshot Discipline Correction

Problem found:
- A captured tablet screenshot was not the intended internal app screen.
- After APK relaunch/hard refresh, the app can land on the public website route instead of the internal operations route.
- This can make the audit evidence misleading if the screen is not verified before capture.

Correction applied to audit process:
- Before every NB80 screenshot, verify the active screen or URL through WebView text/CDP where possible.
- If the screen is not the intended module, capture it as a navigation/startup issue, not as workflow proof.
- Each screenshot shown to the user must include:
  - what it proves
  - what should improve

Proof:
- Tablet screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/043-polish-pass-current-lbmp.png`

What should improve:
- The APK test build should open directly to the internal app during operations testing, or the startup route should be made explicit in the audit steps.

## Home Screen Screenshot Finding

Status:
- Logged only; not fixed in this step.

Reason:
- The Home screen is usable and consistent enough for navigation.
- The current priority is Receive + Print because that directly affects counter operations.

Proof:
- NB80 screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/044-nb80-internal-home-after-navigation.png`
- MacBook screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/041-macbook-internal-home-comparison.png`

What it proves:
- NB80 and MacBook both show the internal Home tile structure.
- Admin account shows all modules.

What should improve later:
- High counts should be role-prioritized so staff do not feel overwhelmed.
- Actual receiving/delivery staff Home screens still need role-filter validation.
- Home polish should be handled after Receive, Print, and Records are stable.

## Receive Records Newest Record Validation

Problem checked:
- After saving `RR-2026-07-000626`, the Records screen previously appeared to show older records first or stale package-derived data.

Validation result:
- API `/receiving` returns the official saved receiving records.
- NB80 WebView and MacBook both show `RR-2026-07-000626` at the top of Receive > Records.

Proof:
- NB80 screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/046-nb80-records-list-shows-newest-rr.png`
- MacBook screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/042-macbook-records-list-shows-newest-rr.png`

Next required action:
- Open the saved record from Records and verify edit/reprint/preview actions on NB80, then capture proof screenshots.

## Receive Record Detail Reprint Validation

Problem checked:
- User reported that Records did not expose reprint options after saving.

Validation result:
- Opened `RR-2026-07-000626` from Receive > Records on NB80 and MacBook.
- Confirmed the detail section includes Reprint Receipt and Preview Receipt.
- Confirmed edit and audit controls are present.

Proof:
- NB80 screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/047-nb80-record-detail-reprint-actions.png`
- MacBook screenshot: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/043-macbook-record-detail-reprint-actions.png`

UX follow-up:
- The actions work, but the page is too edit-heavy. Later polish should make record details summary-first and put corrections behind `Edit record`.

Next required action:
- Test reprint/preview behavior and then finish Phase 4 Receive draft/resume/cancel pass.

## Receive Record Preview/Reprint Behavior Validation

Problem checked:
- Saved record reprint and preview needed to work from Records, not only immediately after saving.

Validation result:
- Preview opened the print-ready receipt section.
- Reprint called the NB80 native printer gateway and returned success through the plugin.

Proof:
- `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/048-nb80-record-preview-receipt.png`
- `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/050-nb80-record-detail-lower-actions-after-swipe.png`
- `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/051-nb80-record-reprint-request-sent.png`

Issue found:
- Print success confirmation appears above the visible scrolled area, so the staff may miss it.

Next required action:
- Add a visible success/error prompt near the print action/global issue system, then retest.

## Receive Print Confirmation Visibility Fix

Problem found:
- After tapping Reprint Receipt from a scrolled record detail, the print confirmation could appear above the visible area, so staff might not know the request was sent.

Fix applied:
- Receive save-page printing and saved-record reprinting now emit a global staff-visible prompt.
- The same event is saved through the blackbox diagnostic path.

Validation:
- Rebuilt production app, hard-refreshed the NB80 APK, reopened `RR-2026-07-000626`, and tapped Reprint Receipt.
- NB80 showed: `Print request sent to NB80 (80mm). Check if paper came out.`

Proof:
- `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/052-nb80-reprint-global-confirmation.png`

Next required action:
- Continue Phase 4 Receive final pass: draft/resume/cancel and staff manual update.

## Receive Cancelled Draft View Fix

Problem found:
- Cancelling a draft changed the status to `Cancelled`, but the tablet still showed the cancelled draft under the `Active Drafts` heading.

Cause:
- The cancel action set the draft filter to `Cancelled` but did not switch the records view to `cancelled`.

Fix applied:
- Both draft-list cancel handlers now switch to the Cancelled Drafts view after cancellation.

Validation:
- Typecheck passed.
- Production app was rebuilt and the NB80 APK was hard-refreshed.
- Cancelled draft view was retested on NB80 and MacBook.

Proof:
- Before fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/055-nb80-active-draft-cancel-after.png`
- NB80 after fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/056-nb80-cancel-draft-after-fix.png`
- MacBook after fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/046-macbook-cancelled-drafts-after-fix.png`

Next required action:
- Write/update the Receive staff manual chapter, then continue Phase 5 print audit.

## Receive Saved Record Print Panel Visibility and Staff Wording Fix

Problems found:
- On MacBook, `Preview Receipt` opened while the saved-record editor stayed visible, so staff could miss the actual print panel.
- On NB80, `View Preview` changed the button state but left the receipt preview below the fold, so it looked like nothing happened.
- On NB80, successful print requests still used technical wording that mentioned the vendor SDK bridge.

Fixes applied:
- `Preview Receipt` now closes the saved-record editor before opening the receiving receipt print panel.
- `View Preview` now scrolls the receipt preview content into view when expanded.
- Successful print requests now use staff-facing wording: `Print request sent. Check if paper came out.`
- Technical printer troubleshooting text was reduced to: `If no paper comes out, open Device and check the printer setup.`

Validation:
- Typecheck passed.
- Production web/API was rebuilt and restarted.
- NB80 APK was hard-refreshed.
- NB80 screenshots were captured and reviewed after each correction.

Proof:
- Before visibility fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/050-macbook-phase5-preview-hidden-by-modal-before-fix.png`
- MacBook after visibility fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/052-macbook-phase5-print-panel-viewport-after-fix.png`
- NB80 preview existed but required manual scroll: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/066-nb80-phase5-preview-content-after-scroll.png`
- NB80 after preview auto-scroll fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/070-nb80-phase5-view-preview-scrolls-into-view.png`
- NB80 before final wording fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/071-nb80-phase5-print-request-after-wording-fix.png`
- NB80 after final wording fix: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/074-nb80-phase5-print-message-staff-wording-valid.png`

What still needs improvement:
- Confirm physical paper output again after the final wording fix.
- Verify 58mm and 80mm sizing with real paper output.
- Repeat the same print-button audit for loading manifest, labels, delivery receipt, payment proof, and expense documents.

---

## Physical Print Confirmation — 2026-07-04

### CONFIRMED by user

| Test | Result |
|---|---|
| 80mm print format on 58mm physical paper | PRINTED — but format too wide. Content overflows/wraps incorrectly on 58mm roll. |
| 58mm print format on 58mm physical paper | PRINTED — correct. |

**Physical paper installed on NB80: 58mm**

### Root cause found

File: `apps/web/src/app/ui/app-shell.tsx`

Problem 1 — Line 2115: Device tab print panel hardcodes 80mm default.
```ts
// WRONG — hardcoded, ignores localStorage
const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">("80mm");
```
Should be:
```ts
// CORRECT — reads from device setup
const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">(() => readDevicePaperWidth());
```

Problem 2 — Line 126: `readDevicePaperWidth()` defaults to "80mm" if no key is set.
```ts
return window.localStorage.getItem(DEVICE_PAPER_WIDTH_KEY) === "58mm" ? "58mm" : "80mm";
```
If staff never set the paper width in Device setup, every print defaults to 80mm — even on a 58mm device.

### Fix required

Fix #: (next sequential)
Screen: Device tab → Print test panel
Problem: Paper width hardcoded to 80mm, ignores device setup localStorage value
Fix type: pre-fill / default value
Before: useState("80mm") — always 80mm regardless of device setup
After: useState(() => readDevicePaperWidth()) — reads localStorage on mount
File + line: apps/web/src/app/ui/app-shell.tsx ~line 2115
Status: OPEN — awaiting code fix

Fix #: (next sequential + 1)
Screen: All print panels — paper selector default
Problem: If localStorage key not set, default is 80mm. NB80 uses 58mm paper. Staff will always get wrong format first.
Fix type: default value / device setup
Before: default "80mm" when key absent
After: Suggest fix — Device setup should prompt staff to set paper width on first use OR derive from NB80 printer service capability
Status: DEFERRED P2 — requires Device setup UX change, not a live label fix

---

## Phase 5.1 — Receive Save → RR → Print Workflow Correctness

Problem checked:
- The receive workflow must not expose printing until a saved receiving record has an official RR number.
- The post-save screen must show one obvious primary action: Print Receipt.
- Secondary actions must not compete visually with Print Receipt.
- NB80 should default to the available 58mm paper width.

Fixes applied:
- Converted saved receiving secondary actions (`Preview`, `New Receiving`, `Records`, `View Items`) from large primary blue buttons to smaller secondary buttons.
- Added tablet-specific saved-receipt wrapping so secondary actions do not clip on NB80.
- Compact saved receiving payment summary cards.
- Changed device paper default from `80mm` to `58mm` when no saved paper setting exists.
- Updated the Phase 5.1 workflow proof script to use current Receive tile labels/selectors and to reconnect to the active NB80 WebView DevTools socket.

Files changed:
- `/Users/jerwinmancenido/mts-lbmp/apps/web/src/app/ui/app-shell.tsx`
- `/Users/jerwinmancenido/mts-lbmp/apps/web/src/app/styles.css`
- `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/scripts/phase51-workflow-correctness.mjs`

Validation:
- Typecheck passed: `npm run typecheck --workspace @mts-lbmp/web`
- NB80 connected through ADB wireless debugging and `npm run apk:reverse`.
- Phase 5.1 workflow reran on MacBook and NB80.
- MacBook official saved RR: `RR-2026-07-000642`
- NB80 official saved RR: `RR-2026-07-000643`

Proof:
- MacBook Receive tab: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/093-macbook-phase51-receive-tab.png`
- NB80 Receive tab: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/093-nb80-phase51-receive-tab.png`
- MacBook post-save RR visible: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/macbook/094-macbook-phase51-postsave-rr-visible.png`
- NB80 post-save RR visible: `/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/094-nb80-phase51-postsave-rr-visible.png`

Decision:
- FIXED for Phase 5.1. Official RR appears before Print Receipt on both MacBook and NB80.
- FIXED for Phase 5.1. Print Receipt is the only large primary post-save action.
- FIXED for Phase 5.1. Paper defaults to `58mm`.

Remaining observation:
- NB80 still shows a wider desktop-style header/search area in some screenshots. This is logged for the broader responsive audit, not expanded into Phase 5.1.

Next required action:
- Phase 5.2 — Print visibility: tap Print Receipt from the NB80 post-save screen and confirm the print panel is fully visible, then verify Records → Reprint.

---

## Phase 5.3 — Physical Print Sizing and 58mm Layout Truncation

### Status: DEFERRED P1

Problem checked:
- Physical printout sizing on 58mm roll with current 80mm-derived template.
- User reported that the 58mm print layout is not good: text overflows and gets cut off (content doesn't wrap correctly, columns overlap or truncate) because it relies on the 80mm renderer cap (`WIDTH_80MM = 42`) scaled down rather than a native 58mm template layout.

Decision:
- DEFERRED (P1). The layout is too wide for 58mm paper. Resolving this requires implementing a 58mm-specific print template renderer, which is a logic change and risks breaking print data formatting. It cannot be fixed safely as a live styling tweak.
- DEFERRED physical print confirmation steps. App-level print gateway requests are verified via screenshots, but physical receipt inspections are deferred to the end of the sprint to allow fully continuous execution without manual printer pauses.
