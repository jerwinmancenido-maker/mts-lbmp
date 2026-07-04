# NB80 Prototype Test Plan

## Purpose

Validate the NB80 Android POS hardware before committing to full hardware integration.

## Prototype Flow

```text
Scan QR
-> Open cargo record
-> Print 80mm receipt
-> Upload photo
-> Capture signature
```

## Hardware To Validate

- Built-in 2D scanner
- Product barcode scanning
- MTS QR scanning
- 80mm ESC/POS printer
- Camera upload
- Signature capture
- PWA behavior
- Need for Capacitor/APK wrapper
- QR readability
- Receipt layout fit

## Scanner Tests

- Scan MTS QR label
- Scan existing product barcode
- Confirm if scanner behaves like keyboard input
- Test scan speed
- Test low-light scan
- Test wrinkled or thermal-paper QR

## Printer Tests

- Print receiving slip
- Print QR label
- Print delivery receipt
- Test long customer names
- Test long package descriptions
- Test price hidden/shown
- Test QR size
- Test paper width fit
- Test cutoff behavior if available

## Camera Tests

- Upload customer DR photo
- Upload cargo photo
- Upload delivery photo
- Upload payment proof
- Confirm compression quality

## Signature Tests

- Capture finger signature
- Save signature image
- Render signature on proof of delivery
- Render signature on printable document if needed

## PWA vs APK Decision Rule

```text
If PWA cannot reliably access printer/scanner hardware, build Capacitor APK wrapper for NB80 hardware integration.
```

## Output

Create a hardware validation report with:

- Works in PWA
- Needs APK wrapper
- Printer command notes
- Scanner behavior notes
- Layout issues
- Recommended implementation path

