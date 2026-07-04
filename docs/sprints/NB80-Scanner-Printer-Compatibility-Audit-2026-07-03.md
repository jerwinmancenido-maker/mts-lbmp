# NB80 Scanner and Printer Compatibility Audit

Date: 2026-07-03

## Summary

The NB80 test device behaves like a POS terminal, not a normal phone.

- Camera capture is not available on the tested unit.
- QR/barcode scanning is hardware-triggered and works like keyboard input into the focused field.
- Printer hardware exists and the NB80 system app reports normal status, but LBMP does not yet have a confirmed vendor SDK print bridge.

## Scanner Findings

Confirmed behavior:

- The scanner is a physical side-trigger scanner.
- The scanner should type the decoded QR/barcode into whichever input is focused.
- App screens should not rely on a camera-based scan overlay for the NB80.

Recommended app rule:

- Scanner buttons should focus the correct input only, or be removed where the field is already obvious.
- Field copy should say: `Scan or type`.
- Operational screens should support Enter suffix after scan.

Current readiness:

- Receiving product/barcode field supports type-or-scan.
- Trip loading package field supports type-or-scan.
- Delivery/package/payment fields support type-or-scan.
- Device Setup includes a scanner input test.

## Camera Findings

Confirmed behavior:

- Capacitor camera fails on the tested NB80 with `Unable to resolve camera activity`.
- The unit appears to have scanner hardware, but no normal Android camera app available for document capture.

Implemented rule:

- Once the app detects no camera app, it stores that as a device capability.
- Photo buttons stop opening the image picker unexpectedly.
- Device Setup includes `Reset Camera Check` for future retesting.

Production recommendation:

- Use iPhone/web or another camera-capable device for DR/POD photos.
- Keep NB80 focused on receiving, scanning, loading, printing, and offline queue.

## Printer Findings

Confirmed from device screenshots:

- Device app: `Handheld-POS`
- Printer status: normal
- Paper width shown: `80mm`
- Printer service version and firmware are visible in system tools.
- Built-in printer test exists in the device system app.

Current LBMP implementation:

- The APK registers a Capacitor plugin named `NyxPrinter`.
- The plugin generates a PDF receipt and sends it to:
  - package: `net.nyx.printerservice`
  - activity: `net.nyx.printerservice.IntentGatewayActivity`
- This is a gateway test, not a confirmed direct thermal printer SDK bridge.

Risk:

- Android can accept the intent but still not physically print.
- If no paper comes out, the current route is not enough for production.

Implemented safeguard:

- The Android plugin now checks whether the NB80 printer gateway activity can resolve before launching it.
- UI now says `gateway test` and asks staff to confirm paper output.

Production requirement:

- Get NB80/Nyx printer SDK or vendor integration notes.
- Implement direct thermal printing when the SDK method is confirmed.
- Keep 58mm/80mm selection in the app.

## Compatibility Matrix

| Feature | Current Status | Production Status |
| --- | --- | --- |
| Hardware scanner input | Compatible | Ready after field-by-field testing |
| Camera DR photo on NB80 | Not available on tested unit | Use another camera-capable device |
| iPhone/web DR photo | Expected to work through browser file/camera input | Needs iPhone smoke test |
| 80mm print layout | Preview ready | Needs physical paper validation |
| 58mm print layout | Preview ready | Needs physical paper validation |
| Native print bridge | Gateway test only | Needs vendor SDK confirmation |
| Offline cached data | Implemented foundation | Needs full offline workflow test |

## Next Test Steps

1. Open Device Setup on the NB80.
2. Tap `Ready Scanner`.
3. Focus Scanner Input and press the physical scan trigger.
4. Confirm the scanned text appears.
5. Select `80mm`.
6. Tap `Test Print`.
7. Tap `Print` in the print panel.
8. Confirm whether paper actually prints.
9. If paper does not print, request the NB80/Nyx printer SDK or developer documentation from the supplier.

## Recommendation

Treat scanner as ready for controlled QA. Treat printer as partially ready until physical print output is proven from LBMP, not only from the built-in POS test app.
