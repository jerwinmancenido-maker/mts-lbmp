# MTS LBMP JavaScript Library Gap Audit

Date: 2026-07-02

## Summary

This audit identifies open-source JavaScript libraries that are still needed or likely needed for MTS LBMP before production, NB80 Android APK testing, and Phase 2 growth.

This is not an instruction to install every library. The platform should stay lean. Install dependencies only when the related feature is being implemented or hardened.

Current stack found in the repo:

- Web: Next.js 15, React 19, lucide-react, Tesseract.js, custom IndexedDB cache/offline queue, custom photo compression/stamping.
- API: NestJS 11, class-validator/class-transformer, Zod, custom demo auth guard, custom logistics services.
- Database: Prisma package exists, MySQL is the production target, but current API service still uses file-backed operational data during development.
- Printing: custom 80mm/ESC/POS text helpers exist.

Network note: live `npm view` registry checks failed during this audit because `registry.npmjs.org` DNS/network lookup was unavailable from the local machine. Before installing, run the pre-install verification commands in this document.

## Dependency Matrix

| Library | Purpose | Module affected | Why needed | Urgency | APK/NB80 relevance | Risk | Hostinger/MySQL compatibility | Install phase | Workspace |
|---|---|---|---|---|---|---|---|---|---|
| `@nestjs/jwt` | JWT issuing/verification | Auth/API | Replace demo tokens with production JWT | Required before production | Low | Low | Compatible | Auth hardening | `apps/api` |
| `passport` + `passport-jwt` | Auth strategy middleware | Auth/API | Standard Nest JWT guard pattern | Required before production | Low | Medium added auth complexity | Compatible | Auth hardening | `apps/api` |
| `argon2` | Password hashing | Auth/API | Secure real passwords/staff PINs | Required before production | Low | Native module can complicate Hostinger builds | Verify Hostinger Node/native support first | Auth hardening | `apps/api` |
| `bcryptjs` | Password hashing fallback | Auth/API | Safer deployment fallback if `argon2` native build is risky | Required before production if `argon2` is not viable | Low | Slower than native hashing, but simple | Compatible | Auth hardening | `apps/api` |
| `helmet` | HTTP security headers | API | Baseline production security | Required before production | Low | Low | Compatible | API hardening | `apps/api` |
| `@nestjs/throttler` | Rate limiting | Login/public intake/tracking/API | Protect public QR intake, login, tracking, uploads | Required before production | Low | Low/medium tuning needed | Compatible | API hardening | `apps/api` |
| `react-hook-form` | Form state/performance | Receiving, trips, delivery, payments, expenses, customers | Current large controlled forms are hard to maintain and can rerender heavily | Required before production UX hardening | Medium | Low | Browser only | Form refactor | `apps/web` |
| `@hookform/resolvers` | Zod integration for forms | Web forms | Use existing Zod rules cleanly in UI | Recommended with `react-hook-form` | Low | Low | Browser only | Form refactor | `apps/web` |
| `multer` or Nest file upload adapter | Multipart uploads | Photos/documents | Current base64 upload works for demo but is inefficient for large photos | Required before production photo scale | Medium | Medium implementation change | Compatible | Upload hardening | `apps/api` |
| `date-fns` | Date formatting/calculation | Dashboards, billing due dates, receipts, filters | Avoid ad hoc date formatting and due-date bugs | Required before production billing/reporting | Low | Low | Compatible | Shared utility hardening | `apps/web`, optionally `apps/api` |
| `vitest` | Unit/service tests | Web/API/shared packages | Add fast test coverage for pricing, payments, trips, permissions | Required before production | Low | Low | Compatible | Test foundation | root dev dependency |
| `@playwright/test` | Browser E2E tests | Web workflows | Test receiving, loading, delivery, mobile layouts | Required before production | Medium | Medium install size | Compatible in CI/local, not runtime | Test foundation | root dev dependency |
| `msw` | API mocks | Web tests | Stable UI tests without requiring API server for every case | Recommended soon | Low | Low | Dev only | Test foundation | root dev dependency |
| `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` | Android APK wrapper | NB80 app | Required to package APK and access native device features when PWA is insufficient | Required before APK/NB80 testing | Critical | Medium Android build setup | Not Hostinger runtime | APK prototype | root + `apps/web` |
| `@capacitor/camera` | Native camera | Photos/POD/DR | More reliable camera capture than browser file input on NB80 | Required before APK/NB80 testing | High | Low/medium permissions | Not Hostinger runtime | APK prototype | `apps/web` |
| `@capacitor/filesystem` | Temporary offline photo/file storage | Offline photos | Safer handling of pending photo files in APK | Required before APK/NB80 testing | High | Medium lifecycle cleanup | Not Hostinger runtime | APK prototype | `apps/web` |
| `@capacitor/network` | Network status | Offline sync badge/queue | More reliable online/offline detection inside APK | Required before APK/NB80 testing | High | Low | Not Hostinger runtime | APK prototype | `apps/web` |
| `@capacitor/preferences` | Device settings | Device setup/session settings | Persist device/branch/printer profile in APK | Recommended for APK | High | Low | Not Hostinger runtime | APK prototype | `apps/web` |
| `@capacitor/app` | App lifecycle | Offline sync/photo queue | Handle background/resume sync safely | Recommended for APK | High | Low | Not Hostinger runtime | APK prototype | `apps/web` |
| `signature_pad` | Finger signature capture | Delivery/POD | Replace typed signature fallback with real signature image | Required before POD production | High | Low | Browser/APK compatible | Delivery hardening | `apps/web` |
| `@zxing/browser` | Camera barcode/QR scanner fallback | Receiving/loading/wall QR | Browser/PWA scan fallback when hardware scanner acts as keyboard or camera scan is needed | Required before APK/NB80 testing | High | Medium camera performance | Browser only | Scanner prototype | `apps/web` |
| `qrcode` | QR image/data generation | Package labels, wall QR, tracking | Generate QR consistently instead of text-only previews | Required before print production | High | Low | Compatible | Print/QR hardening | `apps/web` and/or `apps/api` |
| `esc-pos-encoder` | ESC/POS byte generation | NB80 printer | Improve byte-level printer output beyond text preview | Required for printer prototype | Critical | Medium; may still need native bridge | Compatible, but APK bridge may be needed | NB80 print prototype | `packages/printing` |
| `@tanstack/react-query` | Server cache/fetch state | Web app | Replace scattered fetch state, improve refresh, offline stale data handling | Recommended soon | Medium | Medium refactor | Browser only | Data layer hardening | `apps/web` |
| `@tanstack/react-virtual` | Virtualized large lists | Cargo, trips, payments, customers | Required for hundreds of thousands/millions of records in UI | Required before large-data production | Medium | Low | Browser only | Performance hardening | `apps/web` |
| `@tanstack/react-table` | Table/list behavior | Records, reports, customer history | Sorting/filtering/pagination without custom fragile table logic | Recommended soon | Low/medium | Medium learning curve | Browser only | Data UI hardening | `apps/web` |
| `recharts` | Charts | Dashboards/BI | Revenue, expense, route/customer profitability charts | Recommended soon, not core workflow | Low | Medium bundle size | Browser only | Dashboard phase | `apps/web` |
| `exceljs` | Excel export | Billing/reports | Customer billing reports, operational exports | Recommended soon | Low | Medium bundle/server memory if huge files | Compatible; prefer server-side exports | Reporting phase | `apps/api` |
| `papaparse` | CSV import/export | Products/customers/reports | Bulk product/customer import and lightweight export | Recommended soon | Low | Low | Compatible | Data import/export | `apps/web` and/or `apps/api` |
| `pdf-lib` | Programmatic PDF creation/editing | Documents | A4 PDFs, billing statements, proof packets | Optional until PDF templates are locked | Low | Medium template complexity | Compatible | Document phase | `apps/api` |
| `@react-pdf/renderer` | React-style PDF templates | Documents | Alternative if document templates should share React component style | Optional; choose only one PDF approach | Low | Higher bundle/render complexity | Server compatible with testing | Document phase | `apps/api` |
| `serwist` | Service worker/PWA | Offline app shell/cache | Modern service worker option for Next.js | Optional / Phase 2 | Medium | Medium; must not conflict with custom IndexedDB queue | Hostinger static/runtime compatible | PWA hardening | `apps/web` |
| `next-pwa` | Service worker/PWA | Offline app shell/cache | Older/common Next PWA option | Do not add yet unless Serwist rejected | Medium | Compatibility risk with newer Next versions | Verify before use | PWA hardening | `apps/web` |

## Recommended Install Order

1. Production security foundation:
   - `@nestjs/jwt`, `passport`, `passport-jwt`, `helmet`, `@nestjs/throttler`
   - Choose `argon2` only if Hostinger supports native builds reliably; otherwise use `bcryptjs`.
2. Test foundation:
   - `vitest`, `@playwright/test`, `msw`
3. Form and data stability:
   - `react-hook-form`, `@hookform/resolvers`, `date-fns`
4. Large-data performance:
   - `@tanstack/react-query`, `@tanstack/react-virtual`, then `@tanstack/react-table`
5. NB80/APK prototype:
   - Capacitor core packages, `@zxing/browser`, `signature_pad`, `qrcode`, `esc-pos-encoder`
6. Reporting and dashboard:
   - `exceljs`, `papaparse`, `recharts`
7. PWA and PDF expansion:
   - `serwist`, then choose either `pdf-lib` or `@react-pdf/renderer`

## Do Not Add Yet

- Maps/routing libraries: not needed unless the business wants map-based delivery routing.
- SMS SDKs: use plain HTTP integration later after SMS provider is selected.
- Heavy UI component frameworks: current app needs a custom POS-style UI, not a desktop admin theme.
- AI/OCR SDKs: keep `tesseract.js` for now; add AI extraction later only after DR document examples are collected.
- Both `pdf-lib` and `@react-pdf/renderer`: select one after document template requirements are final.
- Both `serwist` and `next-pwa`: select one service worker strategy only.

## Pre-Install Verification Commands

Run these before installing any recommended library:

```bash
npm ls --depth=0 --workspaces --if-present
npm view <package-name> version peerDependencies engines --json
npm audit --omit=dev
```

After installing a batch:

```bash
npm run typecheck
npm run build
npm run smoke
npm run smoke:permissions
```

For APK/NB80 libraries, also run a device prototype:

- Open APK on NB80.
- Scan package QR/barcode.
- Take DR/product/delivery photo.
- Capture signature.
- Print 80mm receipt/manifest.
- Turn Wi-Fi off, queue payment/photo, turn Wi-Fi on, confirm sync.

## Implementation Notes

- Keep runtime dependencies per workspace. Do not install frontend-only libraries into `apps/api`.
- Prefer server-side generation for heavy exports and PDFs to keep NB80 tablets fast.
- Keep browser/tablet storage temporary. Permanent photos/documents must be server/cloud-backed.
- For Hostinger/MySQL production, prioritize libraries that do not require special native binaries unless confirmed by deployment testing.
- Every new library should have a direct workflow owner: receiving, loading, delivery, payments, printing, reports, security, or APK device support.

