# MTS LBMP Baseline Audit and Next Execution Plan

Date: 2026-07-03  
Scope: Current implementation audit before the next development phase.

## 1. Executive Summary

The current MTS LBMP build is a strong operational prototype. The core user journeys exist: receiving, product/customer setup, cargo records, trips/loading, delivery, payment, expenses, customer view, chat, admin, settings, device setup, OCR-assisted DR reading, offline cache foundation, and APK scaffolding.

The app is not production-ready yet. The biggest gap is not the screen design anymore. The biggest gap is that the implemented API still uses development file-backed operational data in `storage/dev-data/mts-lbmp.json`, while Prisma/MySQL exists only as the production target schema package. Before real operations, the service layer must be moved to MySQL through Prisma repositories.

The next best action is to freeze the current UI/workflow prototype as the baseline, then harden the production foundation in phases without disrupting the receiving workflow that staff already tested.

## 2. Verification Completed

Commands run successfully:

```text
npm run build --workspace @mts-lbmp/web
npm run build --workspace @mts-lbmp/api
npm run smoke
npm run smoke:permissions
```

Current smoke output showed:

```text
Web build: passed
API build: passed
Smoke test: passed
Permission smoke: passed
Packages generated in test data: active
Documents: receiving slip, QR label, delivery receipt, manifest, ESC/POS preview
Audit entries: 14,687
Branches: 3
Payment methods: 7
Hardware tests: 56
```

This means the current build is stable enough to continue, but the large QA data also confirms the need for pagination, virtual lists, and real database-backed queries before production.

## 3. Current Implementation Status

| Area | Status | Notes |
|---|---:|---|
| Public website | Basic implemented | Exists at root route. Needs final branding/content later. |
| Operations app shell | Implemented | Role-aware tabs, tile landing screens, mobile/POS layout. |
| Receiving | Advanced prototype | Drafts, records, intake tasks, OCR, autocomplete, compact item entry, payment-at-receiving. |
| Wall QR intake | Implemented prototype | Public intake exists, needs final privacy/security hardening. |
| Cargo | Implemented prototype | View/edit cargo, measurements, movement, print slip/label. |
| Trips/loading | Implemented prototype | Trip creation, truck autocomplete, loading, unload/remove, depart/arrive/complete, manifest. |
| Delivery | Implemented prototype | Verify arrived cargo, deliver, fail/return, collect. Needs flow simplification. |
| Payments | Implemented prototype | Operational payment tracking only. Needs billing/due-date hardening. |
| Expenses | Implemented prototype | Submit/approve expenses, category handling. Needs branch-owner approval polish. |
| Customers | Implemented prototype | Company/contact/address/billing info, customer history, reminders. |
| Chat | Implemented prototype | Global and scoped operation chat, price approval via chat. |
| Admin/settings | Implemented prototype | Users, branches, audit, payment methods, expense categories, company profile. |
| Device/NB80 | Prototype only | Scanner works as keyboard wedge. Camera unavailable on actual NB80 unit. Printer bridge still unreliable. |
| Offline/cache | Foundation implemented | IndexedDB cache, offline queue, photo queue shape exists. Needs conflict handling and UI completion. |
| OCR | Prototype implemented | Tesseract.js reads DRs; parsing improved but not fully reliable for addresses/products. |
| Printing | Partial | Text receipts and ESC/POS preview exist. Native NB80 print bridge requires deeper compatibility work. |
| Customer portal | Partial | Customer-facing visibility exists inside app patterns, not final production portal/auth. |
| Audit trail | Partial | Logs are generated in prototype service. Needs persistent DB actor/IP/before-after model. |

## 4. Architecture Findings

### 4.1 Data Persistence

Current API service uses development local JSON:

```text
storage/dev-data/mts-lbmp.json
```

Prisma schema exists at:

```text
packages/database/prisma/schema.prisma
```

But the implemented in-memory/file service has more fields and behavior than the Prisma schema. The schema is behind the app model.

Production impact:

- Cannot safely deploy real operations until Prisma/MySQL persistence matches the service model.
- Current local JSON is useful for prototyping, LSOS, and UI validation, but not for production.
- MySQL migration must be the next foundation phase before serious customer data entry.

Recommendation:

- Create a Prisma repository layer and migrate module by module.
- Update the schema first to match current `logistics.types.ts`.
- Keep service methods/business logic names stable so UI does not need a large rewrite.

### 4.2 Auth and Permissions

Current state:

- Demo users exist in code.
- Demo JWT/staff-code login exists.
- Permission smoke tests pass.
- Role presets exist in `packages/permissions`.

Production gaps:

- Real users are not fully backed by MySQL.
- Staff PIN/code security needs hashed PINs, lockouts, audit, and device/session tracking.
- Customer portal accounts need customer-level isolation and production login.

Recommendation:

- Keep current role model.
- Replace demo auth with real JWT sessions.
- Add user/device session records.
- Keep owner/admin unrestricted, but persist all role overrides and branch restrictions.

### 4.3 NB80 Hardware Reality

Actual device findings:

- The tested NB80 unit does not expose a normal camera app.
- The hardware scanner appears to work as a physical scanner/keyboard wedge.
- Staff should not depend on in-app camera scanning buttons on NB80.
- Printer has internal POS settings and can print its own tests, but LBMP native print still does not reliably reach the printer.

Production impact:

- Camera/photo workflow must be optional or routed to another phone/iPhone/web device.
- Product/package scanning should use focused text fields and the physical scan trigger.
- NB80 printing needs a native Android integration audit, not more web button changes.

Recommendation:

- Device setup must detect capabilities:
  - Camera available: yes/no.
  - Scanner mode: keyboard wedge/native.
  - Printer bridge: available/unavailable.
  - Paper width: 58mm/80mm.
- Hide or relabel camera actions on no-camera devices.
- Remove in-form scan buttons where the hardware scanner inputs into focused fields.
- Build a dedicated native printer diagnostic screen with plugin result logs.

### 4.4 Mobile/POS UI

Current state:

- The app is much better after compacting forms.
- Long text editor pattern exists.
- Home-style tiles exist and should remain the module landing standard.

Remaining UX risks:

- Some forms still carry too much vertical spacing.
- Some labels repeat obvious placeholder text.
- Some modules have different row/card density.
- Staff want receiving item lines to feel like rows, not separate boxes.
- iPhone Safari and NB80 browser display very differently; layouts must be tested on both.

Recommendation:

- Adopt one global compact field system.
- Use one-line row patterns for receiving item lines, payments, expenses, cargo lists, trip lists.
- Keep tile screens only for module landing pages.
- Forms should be dense, but not tiny: clear labels, compact spacing, large enough touch targets.

### 4.5 OCR and Address Parsing

Current state:

- Tesseract.js is installed.
- DR reading works but can be slow and inconsistent.
- Address parsing is better than before but not complete.
- No full local Philippines PSGC/address database exists yet.

Production impact:

- OCR should be treated as assistant/autofill, not final truth.
- Staff must review extracted values before saving.
- Address split should improve with local PSGC data, but OCR cannot perfectly infer every barangay/street from messy documents.

Recommendation:

- Import a local Philippines address dataset into MySQL/local JSON cache:
  - Region
  - Province
  - City/municipality
  - Barangay
  - ZIP where available
- Add fuzzy matching for OCR text.
- Keep OCR output as editable draft lines.
- Show confidence and “needs review” flags for low-confidence fields.

### 4.6 Printing

Current state:

- 58mm/80mm print preview and text rendering exist.
- ESC/POS preview bytes exist.
- Native Android plugin call exists as `NyxPrinter`.
- Actual NB80 app still reports no reliable print from LBMP.

Production impact:

- Printing is not ready for production.
- We must identify the actual SDK/API exposed by this NB80 vendor firmware.

Recommendation:

- Add printer diagnostics:
  - Detect native plugin availability.
  - Test raw text print.
  - Test 58mm/80mm width.
  - Test feed/cut.
  - Capture exact error/result.
- If vendor printer SDK is required, implement a Capacitor native plugin that calls it.
- Keep all document templates server-generated and layout-tested.

## 5. Module-by-Module Truth Check

### Home

Works as module launcher. Keep this as the visual pattern.

Next:

- Keep notification badges.
- Add “needs sync” and device status only when meaningful.

### Receive

Strongest module. Staff-tested and now close to usable.

Remaining fixes:

- Move DR number/photo/read controls to the top summary area.
- Remove separate “Customer DR” section.
- Keep product/barcode as one field.
- Ensure all product autocomplete uses same global component.
- Keep item rows compact.
- Hide camera/photo buttons on no-camera device or show “Attach image from another device”.

### Cargo

Useful as summary and correction module.

Remaining fixes:

- Make cargo list rows compact.
- Show status, branch, customer, receiver, payment state, trip state.
- Use details page for edit/audit/print.

### Trips

Workflow exists but still needs operational clarity.

Recommended flow:

```text
Trips landing
-> Create Trip
-> Trip List
-> Trucks

Trip details
-> Load cargo
-> Print manifest
-> Depart
-> Arrive
-> Complete
```

Remaining fixes:

- Delivery staff should not create normal trips.
- Delivery staff may create returns only.
- Arrived/departed/completed trips should lock inappropriate actions.
- Trip list should group by Loading, Departed, Arrived, Completed/Cancelled.

### Deliver

Needs simplification.

Recommended flow:

```text
Verify Arrived
-> scan package
-> confirm condition/shortage

Deliver Cargo
-> scan/select package
-> proof of delivery
-> payment if needed

Collect
-> payment list
-> record collected money

Failed / Return
-> reason
-> next action
```

### Payments

Operational payment tracking is correct. It should not become accounting.

Remaining fixes:

- Use autocomplete/search like customer/product.
- Show unpaid list only near the field, not far below.
- Support due date, billing term, reminders, and customer balance summaries.

### Expenses

Works, but the layout should stay compact.

Remaining fixes:

- Category chips should be compact.
- Trip search and selected trip should stay visually connected.
- Receipt photo must respect device capability.
- Owner approval state should be explicit.

### Customers

Good direction after matching company/contact behavior.

Remaining fixes:

- Customer list should open details like receive companies.
- Company/contact/address/billing must remain editable.
- Customer history should show ongoing, delivered, unpaid, invoices, reminders, contacts.

### Chat

Useful for price approvals and operational messages.

Remaining fixes:

- Keep global chat.
- Keep scoped chat from package/trip/customer.
- Approval actions must persist audit and update the related record.

### Admin and Settings

Enough for prototype.

Production needs:

- Full permission editor.
- User invite/password/PIN handling.
- Branch owner restrictions.
- Audit viewer with filters.

### Device

Must become real hardware setup, not just a checklist.

Needed:

- Scanner keyboard wedge test.
- Printer bridge test.
- Paper width.
- Camera availability.
- Offline storage status.
- App version/build number.

## 6. Immediate Production Risks

| Risk | Severity | Why it matters | Recommendation |
|---|---:|---|---|
| API uses JSON file persistence | Critical | Not safe for real operational data | Move to Prisma/MySQL before production use. |
| Prisma schema behind service model | Critical | Production DB would miss fields/workflows | Expand schema from `logistics.types.ts`. |
| Printer integration not proven | Critical | Printing is core to warehouse workflow | Native NB80 printer audit/plugin required. |
| Demo auth still present | Critical | Real users/customer data need secure login | Implement real JWT, hashed passwords/PINs. |
| NB80 no camera | High | DR/photo features fail on device | Capability detection and alternate photo flow. |
| Large data without virtual lists | High | Millions of records will slow mobile UI | Add pagination and virtualized lists. |
| OCR inconsistent | Medium | Staff may trust wrong autofill data | Use confidence/review, import PH address DB. |
| Stale Next build chunks | Medium | Device can show ugly runtime error | Add hard refresh/deployment cache strategy. |
| Offline queue not complete | Medium | Staff may think unsynced data is saved | Finish queue status, retry, conflict handling. |

## 7. Recommended Next Execution Roadmap

### Phase 1: Stabilize Staff-Facing Web/PWA

Goal: Make the iPhone/web version comfortable for real staff testing.

Tasks:

- Finalize receiving top summary: branch, DR number, DR photo status, items.
- Remove duplicate “Customer DR” section.
- Standardize all autocomplete fields.
- Remove in-app scan buttons where hardware scanner should type into focused fields.
- Compact list rows globally.
- Add device capability flags to hide unsupported camera actions.
- Re-test on iPhone 15 Pro Max width and desktop.

Recommendation: Do this first. It directly addresses staff confusion.

### Phase 2: MySQL/Prisma Production Foundation

Goal: Stop depending on local JSON for operational records.

Tasks:

- Expand Prisma schema to match current service types.
- Add migrations.
- Create repository layer.
- Move customers/products/branches/users first.
- Move receiving/cargo next.
- Move trips/delivery/payments/expenses after.
- Preserve existing API endpoints to avoid UI churn.
- Add seed/QA reset using Prisma.

Recommendation: Do this before real data entry.

### Phase 3: Device Capability and Printer Audit

Goal: Make NB80 behavior honest.

Tasks:

- Add Device Setup capability tests.
- Detect no camera and disable camera capture on NB80.
- Treat scanner as keyboard input.
- Build printer diagnostic log.
- Confirm available paper widths.
- Research/implement actual printer SDK bridge if required.

Recommendation: Do this before promising APK printing.

### Phase 4: Offline and Sync Completion

Goal: Let staff work safely during weak connection.

Tasks:

- Finalize offline queue status UI.
- Complete photo queue only for devices with photo source.
- Add retry/conflict handling.
- Warn before logout/cache clear.
- Add sync logs.

Recommendation: Do this after Prisma persistence exists, otherwise conflict handling will be wasted.

### Phase 5: Production Auth and Permissions

Goal: Prepare real users and customer portal.

Tasks:

- Real login.
- Hashed passwords and staff PINs.
- Session/device tracking.
- Branch restrictions.
- Customer account isolation.
- Permission editor.

Recommendation: Do this before customer portal pilot.

### Phase 6: Reports, Billing, and BI

Goal: Owner value after operations are stable.

Tasks:

- Billing invoices.
- Due reminders.
- Customer balance.
- Route/trip/customer profitability.
- Export PDF/Excel.
- Dashboard charts.

Recommendation: Do not prioritize this above core receiving/loading/delivery reliability.

## 8. What Not To Do Yet

- Do not force APK production yet.
- Do not add AI subscriptions for OCR yet.
- Do not build advanced analytics before MySQL persistence.
- Do not rely on tablet/browser storage as permanent photo storage.
- Do not let demo auth reach production.
- Do not keep adding layout fixes one screen at a time without the global field/list patterns.

## 9. Next Recommended Action

Start with Phase 1.

Specific next task:

```text
Receiving final cleanup:
Move DR number/photo/read controls into the top summary,
remove the separate Customer DR section,
standardize autocomplete/product entry,
and hide camera-only actions when the device has no camera.
```

Why this first:

- It is the screen staff use most.
- It reduces confusion immediately.
- It does not block future MySQL migration.
- It creates the global pattern for the rest of the app.

After Phase 1 passes web/mobile checks, start the Prisma/MySQL foundation.

