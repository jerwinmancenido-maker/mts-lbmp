# Staff Manual Chapter: Receive

Audience: Receiving staff using the NB80 tablet or phone web app.

Goal: Receive cargo quickly, make sure the branch is correct, add item lines clearly, save one receiving document, then print the receiving receipt.

## Plain Workflow

1. Open `Receive`.
2. Tap `New`.
3. Select the branch first.
   - Choose `Daet` or `Naga`.
   - This controls branch owner visibility and branch finances.
4. Add the customer.
   - Type the customer name.
   - If the customer exists, select it from the suggestions.
   - If the customer is new, create it only when the app shows the create option.
5. Add the delivery area if the cargo will be delivered to the consignee.
   - This is required before saving.
   - If it is missing, the app blocks saving and tells staff what to fix.
6. Add drop-off person and receiver/consignee.
   - Type the name.
   - If there is saved history, select it from the suggestions.
   - If not found, continue with the typed name.
7. Add the customer DR.
   - Type the DR number if available.
   - Add a DR photo only when the device supports photo capture or file attach.
   - `Read DR Photo` can help fill details, but staff must still check the result.
8. Add items one line at a time.
   - Type product name, SKU, or barcode in the same product field.
   - On the NB80, use the physical side scanner while the product field is focused.
   - The app no longer needs an on-screen scan button for products.
9. Tap `Add Item`.
   - The item must appear under `Items Added`.
   - A typed product is not saved until staff taps `Add Item`.
10. Repeat item entry for all cargo lines.
11. Record payment at receiving if money was collected.
   - This is operational collection only.
   - It does not replace accounting.
12. Tap `Save Receiving`.
13. Review the confirmation page.
   - If anything is wrong, go back and edit before saving.
14. Save the receiving record.
15. The system generates the official receiving number, such as `RR-2026-07-000626`.
16. Choose paper size based on the paper loaded in the NB80.
17. Tap `Print Receipt`.
18. If the app says `Print request sent. Check if paper came out.`, check the printer paper.
19. If no paper comes out, open `Device` and check printer setup before trying again.

## Rules Staff Must Remember

- No item is saved until it appears in `Items Added`.
- No receiving receipt can be printed until the receiving record is saved and has an RR number.
- Delivery address is required when delivery type is `Deliver to consignee`.
- The branch must be correct before saving.
- If an error appears, follow the highlighted field first.
- If paper does not come out, do not create a new receiving record. Open `Records`, find the receiving record, and use `Reprint Receipt`.

## Records And Reprint

1. Open `Receive`.
2. Tap `Records`.
3. Search by customer, RR number, package number, or item.
4. Tap the receiving record.
5. Use:
   - `Reprint Receipt` to print again.
   - `Preview Receipt` to view before printing.
   - `Save Changes with Audit` if an allowed edit was made.
6. When preview is opened, the app should move the receipt preview into view.
7. If the receipt does not print, stay on the same record and use `Reprint Receipt`; do not create another receiving record.

## Drafts

Use drafts when receiving work is started but not ready to save as an official receiving record.

1. Open `Receive`.
2. Tap `Records`.
3. Tap `Active Drafts`.
4. Find the draft by draft number, customer, item count, or update time.
5. Tap `Resume`.
6. Review the draft before saving.
   - Check branch.
   - Check customer.
   - Check delivery area.
   - Check drop-off person and receiver.
   - Check item lines.
7. Continue adding items or save the receiving record.

If a draft is not needed anymore:

1. Open `Active Drafts`.
2. Tap `Cancel` on the draft.
3. The draft moves to `Cancelled Drafts`.
4. Cancelled drafts are read-only history and cannot be resumed.

Staff rule:
- Only resume drafts that still represent real cargo at the receiving counter.
- Empty old drafts should not be used for new cargo. Start a new receiving instead.

## Common Errors

`Delivery address is required before saving`

What to do:
- Add the delivery area/address.
- Add the item again if the item line was created before the address was entered.

`Add Item First`

What to do:
- Type or scan product.
- Tap `Add Item`.
- Confirm the item appears in `Items Added`.

`No saved product found`

What to do:
- Continue typing the product name if it is new.
- Staff may save it as a new product if the workflow allows it.

## Screenshot Proof

Validated NB80 saved state:

`/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/038-phase4-corrected-save-print-visible-nb80.png`

What it proves:
- Official RR number is generated after saving.
- Print Receipt appears only after save.
- Paper size is selectable.
- Staff can go to Preview, New Receiving, Records, or View Items.

What should still improve:
- The saved receiving page is better, but the print panel still uses too much vertical space.
- Recommended next UI pass: keep `Print Receipt` as the single primary action, make paper size and audit status more compact, and keep secondary actions smaller.

Validated saved-record print panel:

`/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/073-nb80-phase5-preview-from-record-detail-retry.png`

What it proves:
- Saved receiving records can open the receiving receipt print panel from Records.
- Paper size, audit status, Print, Reprint, and View Preview are visible.

`/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/074-nb80-phase5-print-message-staff-wording-valid.png`

What it proves:
- After tapping Print, the app gives staff a plain message: `Print request sent. Check if paper came out.`

What should still improve:
- Physical print output still needs repeated confirmation for 58mm and 80mm.
- Other printed documents still need the same NB80 validation.

Validated draft behavior:

`/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/054-nb80-active-draft-resumed.png`

What it proves:
- Resume opens the draft back into Receive Items.
- The draft number is visible.
- The app tells staff to review before finalizing.

`/Users/jerwinmancenido/mts-lbmp/test-results/audit-20260704/screenshots/nb80/056-nb80-cancel-draft-after-fix.png`

What it proves:
- Cancelled drafts now appear under `Cancelled Drafts`.
- Cancelled drafts are read-only.
