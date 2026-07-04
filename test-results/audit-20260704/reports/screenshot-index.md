# MTS LBMP Audit Screenshot Index

Audit date: 2026-07-04

## NB80 Tablet Screenshots

- `001-home-nb80-adb.png` - Home baseline on NB80.
- `003-receive-nb80-adb.png` - Receive module baseline on NB80.
- `014-receive-new-nb80-adb.png` - New receiving screen baseline on NB80.
- `015-receive-test-start-20260703202816-adb.png` - Receive test start.
- `016-receive-test-new-20260703202816-adb.png` - New receiving test data entry.
- `017-receive-test-item-added-20260703202816-adb.png` - Item added during receiving.
- `018-receive-test-review-20260703202816-adb.png` - Confirm receiving review screen.
- `019-receive-test-saved-20260703202816-adb.png` - Receiving saved and ready to print.
- `020-receive-print-click-20260703203011-adb.png` - Receive print action clicked.
- `021-receive-print-physical-confirmed-adb.png` - Physical print confirmation state.
- `026-record-detail-reprint-after-rebuild-adb.png` - Saved receiving record detail with reprint controls after rebuild.
- `027-phase4-receive-landing.png` - Receive landing screen during Phase 4 audit.
- `031-phase4-new-receiving-open.png` - New receiving screen during corrected Phase 4 audit.
- `032-phase4-product-field-after-type.png` - Product/SKU/barcode autocomplete state on NB80.
- `033-phase4-receive-new-after-dr-photo-label.png` - New receiving screen after replacing redundant `DR Photo / Missing` with compact `Photo / No photo`.
- `034-phase4-autocomplete-current-nb80.png` - NB80 Receive autocomplete check after typing customer, drop-off, receiver, and product/SKU/barcode values.
- `035-phase4-missing-address-validation-nb80.png` - NB80 Receive save blocked before server submission when delivery address is missing.
- `038-phase4-corrected-save-print-visible-nb80.png` - NB80 corrected Receive save flow showing official RR number and Print Receipt controls.
- `039-before-final-receive-pass-current.png` - NB80 pre-pass state before continuing final Receive audit.
- `040-phase4-receive-records-list-nb80.png` - NB80 Receive Records list showing saved records order issue.
- `040-macbook-receive-records-list.png` - MacBook comparison for Receive Records list.
- `043-polish-pass-current-lbmp.png` - NB80 current APK screen showing public landing page after relaunch, proving startup/navigation must be verified before workflow screenshots.
- `044-nb80-internal-home-after-navigation.png` - NB80 internal app Home after explicit navigation to `/app?demo=admin`.
- `041-macbook-internal-home-comparison.png` - MacBook internal app Home comparison for the same admin account.

## MacBook Screenshots

- `001-home-macbook.png` through `013-device-macbook.png` - Desktop baseline module pass.
- `014-receive-new-macbook.png` - Receive new screen on MacBook.

## Capture Notes

- For NB80, prefer `adb exec-out screencap -p` for proof screenshots.
- Playwright can inspect button text and state through WebView CDP, but long page screenshots may timeout.
- Every future fix should include both:
  - a machine-readable validation result in `reports/`
  - an NB80 screenshot in `screenshots/nb80/`

- `nb80/046-nb80-records-list-shows-newest-rr.png` - Receive Records on NB80 showing `RR-2026-07-000626` first.
- `macbook/042-macbook-records-list-shows-newest-rr.png` - Receive Records on MacBook showing the same newest RR ordering.
- `nb80/047-nb80-record-detail-reprint-actions.png` - NB80 saved receiving record detail with Reprint Receipt, Preview Receipt, edit, and audit controls.
- `macbook/043-macbook-record-detail-reprint-actions.png` - MacBook comparison of the same saved receiving record detail.
- `nb80/048-nb80-record-preview-receipt.png` - NB80 after Preview Receipt action opened print-ready state.
- `nb80/050-nb80-record-detail-lower-actions-after-swipe.png` - NB80 lower saved-record detail showing reprint/action controls and audit trail.
- `nb80/051-nb80-record-reprint-request-sent.png` - NB80 after Reprint Receipt request returned success through native printer gateway.
- `nb80/052-nb80-reprint-global-confirmation.png` - NB80 after live-fix showing visible print request confirmation for a receiving record reprint.
- `nb80/053-nb80-receive-active-drafts.png` - NB80 Receive Active Drafts list showing resumable drafts and old empty drafts.
- `macbook/044-macbook-receive-active-drafts.png` - MacBook comparison for Receive Active Drafts list.
- `nb80/054-nb80-active-draft-resumed.png` - NB80 after resuming `DRAFT-2026-07-000009`.
- `macbook/045-macbook-active-draft-resumed.png` - MacBook comparison after resuming the same active draft.
- `nb80/055-nb80-active-draft-cancel-after.png` - NB80 before fix showing cancelled draft under the wrong `Active Drafts` heading.
- `nb80/056-nb80-cancel-draft-after-fix.png` - NB80 after fix showing cancelled drafts under `Cancelled Drafts`.
- `macbook/046-macbook-cancelled-drafts-after-fix.png` - MacBook comparison after cancelled draft view fix.
- `nb80/057-nb80-phase5-receiving-document-print-request.png` - NB80 saved receiving record after Reprint Receipt sent a native print request.
- `macbook/050-macbook-phase5-preview-hidden-by-modal-before-fix.png` - MacBook before fix: Preview Receipt opened internally, but the print panel was hidden behind the saved record editor.
- `macbook/052-macbook-phase5-print-panel-viewport-after-fix.png` - MacBook after fix: Preview Receipt closes the editor and shows the Receiving Receipt print panel with paper selection and Print/Reprint/View Preview actions.
- `nb80/058-nb80-current-before-phase5-continue.png` - Invalid workflow proof: NB80 opened to the public landing page, proving startup/navigation must be verified before accepting screenshots.
- `nb80/059-nb80-after-open-operations-tap.png` - NB80 internal Home after tapping Open Operations App.
- `nb80/060-nb80-phase5-receive-landing.png` - NB80 Receive landing page before Phase 5 print retest.
- `nb80/061-nb80-phase5-receive-records.png` - NB80 Receive Records list used for saved-record print testing.
- `nb80/062-nb80-phase5-record-detail-opened.png` - NB80 saved receiving record detail showing Reprint Receipt and Preview Receipt actions.
- `nb80/063-nb80-phase5-preview-receipt-after-fix.png` - NB80 print panel opened from a saved receiving record after the MacBook visibility fix.
- `nb80/064-nb80-phase5-print-request-from-panel.png` - NB80 print request sent from the visible print panel.
- `nb80/065-nb80-phase5-view-preview-from-panel.png` - NB80 View Preview clicked, showing the button changed to Hide Preview but content was still below the fold.
- `nb80/066-nb80-phase5-preview-content-after-scroll.png` - NB80 receipt preview content after manual scroll, proving the preview existed but needed auto-scroll.
- `nb80/067-nb80-phase5-preview-after-scroll-fix.png` - Invalid proof attempt: automation landed on record detail, not the print panel.
- `nb80/068-nb80-phase5-record-detail-actions-long-record.png` - NB80 long saved-record detail showing print actions were reachable but too low on the page.
- `nb80/069-nb80-phase5-preview-panel-long-record-after-fix.png` - NB80 print panel after Preview Receipt from a long saved record.
- `nb80/070-nb80-phase5-view-preview-scrolls-into-view.png` - NB80 after fix: View Preview auto-scrolls receipt content into view.
- `nb80/071-nb80-phase5-print-request-after-wording-fix.png` - NB80 before final wording fix: print status still exposed technical vendor SDK wording.
- `nb80/072-nb80-phase5-print-message-staff-wording.png` - Invalid proof attempt: screenshot landed back on saved-record detail instead of the print panel.
- `nb80/073-nb80-phase5-preview-from-record-detail-retry.png` - NB80 valid print panel after retry, showing plain helper text and print actions.
- `nb80/074-nb80-phase5-print-message-staff-wording-valid.png` - NB80 after final wording fix: Print status says `Print request sent. Check if paper came out.`
- `nb80/075-nb80-current-after-checkpoint-resume.png` - NB80 checkpoint resume screenshot showing the receiving receipt print panel still open with the fixed print message.
- `nb80/076-nb80-paper-size-dropdown-open.png` - NB80 paper-size selector opened, showing 80mm and 58mm choices.
- `nb80/077-nb80-paper-size-58mm-selected.png` - NB80 receiving receipt print panel with 58mm selected.
- `nb80/078-nb80-receive-58mm-print-request.png` - NB80 58mm receiving receipt print request sent with staff-readable status message.
