# MTS LBMP Execution Status

Last updated: 2026-07-01

## Running URLs

```text
Public website: http://localhost:3000
Operations app: http://localhost:3000/app
API: http://localhost:4100
Tracking example: http://localhost:3000/tracking/PKG-2026-07-000003
```

## Implemented

- Monorepo structure
- Next.js app
- NestJS API
- Shared domain constants
- Permission presets
- Prisma/MySQL schema planning
- Local JSON persistence
- Public website
- Operations app shell
- Public tracking page
- Receiving workflow
- Package QR value generation
- Price update before loading
- Trip creation
- Loading validation
- Depart / arrive
- Delivery and failed delivery
- Payment recording
- Expense recording
- Basic dashboard
- Demo auth guard for protected API routes
- Permission metadata enforcement for protected actions
- Role-switching demo login UI
- Owner audit log screen
- Admin-only package soft delete with required reason
- Admin-only package restore with required reason
- Owner company profile settings
- Owner branch capability settings
- Owner configurable payment methods
- Owner configurable expense categories
- NB80 hardware prototype screen
- Hardware test result logging
- Scanner/printer/camera/signature/PWA validation checklist in app
- Shipment messages
- Barcode-to-description link flow
- 80mm receipt text preview
- QR label preview
- Loading manifest preview
- Delivery receipt preview
- ESC/POS text byte preview endpoint
- PWA manifest
- Generated logistics hero bitmap
- Client-side image compression
- Image upload endpoint
- Static upload serving
- Smoke test script

## Current Persistence

Development persistence uses:

```text
storage/dev-data/mts-lbmp.json
```

Production persistence target remains:

```text
MySQL + Prisma
```

## Latest Verification

```text
API typecheck: passed
Web typecheck: passed
API build: passed
Web build: passed
Smoke test: passed
Latest package: PKG-2026-07-000009
Document smoke test: passed
Protected route check: passed
Permission smoke test: passed
Audit smoke coverage: passed
Settings smoke coverage: passed
Hardware smoke coverage: passed
```

## Next Recommended Execution

- Replace local JSON service with Prisma repository layer
- Add real JWT guards and password hashing
- Add role-aware UI navigation enforcement
- Add document template screens for delivery receipt and manifest
- Add NB80 print adapter prototype
