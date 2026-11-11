# NYX PDF Print Route — Contract

Status: **the current production print route**, as implemented in
`android/app/src/main/java/com/mancenido/lbmp/test/NyxPrinterPlugin.java`
(Capacitor plugin `NyxPrinter`, method `printText`). This document records
the route's exact behaviour so it can be regression-tested and reasoned
about without re-reading the Java. It describes what the code does today —
not what the NB80 ultimately proves on paper. **RISK-001 stays open until
physical paper output is confirmed on Jerwin's NB80.**

The route in one line: the web layer hands the plugin plain text; the
plugin renders that text into a **PDF** and fires an Android Intent at the
NYX vendor printer gateway. No ESC/POS bytes are involved on this route.

## Inputs

`printText(text, documentName, paperWidth)`:

- `text` — the document body, composed server-side by `@mts-lbmp/printing`
  at 42 columns (80mm) and passed through `prepareTextForPrint` on the web
  side (80mm text reaches the plugin byte-for-byte; 58mm text is
  down-wrapped to 24 cols first).
- `documentName` — default `"LBMP Print"`; sanitized to `[A-Za-z0-9._-]`
  (everything else → `_`) and used as the PDF file name.
- `paperWidth` — `"80mm"` (default) or `"58mm"`; selects the geometry
  profile below.

Empty/whitespace-only text is rejected with `"Nothing to print."` before
anything else happens.

## PDF geometry (from the plugin's constants)

| | 80mm | 58mm |
| --- | --- | --- |
| Page width | **227 pt** (`RECEIPT_WIDTH_80MM_PT`) | 164 pt |
| Padding (each side) | 18 pt | 12 pt |
| **Usable text width** | **191 pt** (227 − 2×18) | 140 pt (164 − 2×12) |
| Font | `Typeface.MONOSPACE`, 7.2 pt | `Typeface.MONOSPACE`, 5.8 pt |
| Line height | 10 pt | 8 pt |
| Page height | `max(2×padding + lineHeight × (wrappedLines + 3), 240)` pt | same formula, min 180 pt |

The page is a single `PdfDocument` page: white background, black text,
first baseline at `padding + round(textSize)`, each subsequent line one
line-height lower. Height grows with the wrapped line count (the `+3` is
slack built into the formula), so a document is never clipped vertically —
it just makes a taller page.

## How text lines map to the PDF

`wrapReceiptLines` processes the input before drawing:

1. `\r` is stripped; the text is split on `\n`; empty lines stay empty
   (they still consume a line height).
2. A line whose **measured** width (`Paint.measureText`) exceeds the
   usable width is wrapped: it backs off character-by-character until the
   head fits, then prefers a word break — if the last space in the fitting
   head is at index > 8, it breaks there instead. Both segments are
   trimmed. This repeats until the remainder fits.
3. Wrapping is by measured glyph width, **not** by column count.

Font metrics and the 42-column budget: the monospace advance at 7.2 pt is
≈ 0.6 em ≈ **4.32 pt/char**, so a full 42-col line measures ≈ 181 pt —
inside the 191 pt usable width, which is why the API's 42-col layout
reaches the PDF un-wrapped (the measured-width wrap could fit ~44 chars).
Note the asymmetry this creates: the PDF route guarantees *measured-width*
fit, so the columns a human counts on paper are a design budget, not
something the plugin enforces. Centering and dividers are literal spaces
and dashes in the text — the plugin has no alignment concept.

## Hand-off (the Intent)

1. The PDF is written to the app cache: `<cacheDir>/lbmp-prints/<safeName>.pdf`.
2. A content URI is minted via `FileProvider` (authority
   `<package>.fileprovider`).
3. An `Intent.ACTION_VIEW` is built with an **explicit component**:
   package `net.nyx.printerservice`, activity
   `net.nyx.printerservice.IntentGatewayActivity`; data = the PDF URI,
   type `application/pdf`; ClipData carries the same URI; flags are
   `FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK`.
4. Before launching, the plugin resolves the intent
   (`resolveActivity`, `MATCH_DEFAULT_ONLY`). If nothing resolves it
   rejects with: *"NB80 printer gateway is not available. Open the device
   Printer app test first, or install the vendor printer service/SDK."*
5. It grants the NYX package read permission on the URI and calls
   `startActivity`.

## What the result does and does not prove

On success the plugin resolves:

```json
{ "ok": true, "route": "net.nyx.printerservice.pdf", "file": "<content-uri>",
  "paperWidth": "80mm",
  "message": "Print request opened the NB80 printer gateway. Confirm paper output; if nothing prints, vendor SDK bridge is required." }
```

**`ok: true` proves only:** the PDF was generated, the NYX gateway
activity exists on the device, and the Intent was launched at it.

**It does not prove:** that the gateway rendered or printed the PDF, that
paper was present or fed, that the output was legible or complete, or that
any feed/cut happened. There is no completion callback from the gateway —
the plugin's own message says to confirm paper output by eye.

Failure surfaces as a rejection: empty text, cache-dir creation failure,
gateway not resolvable (above), or any exception wrapped as
`"NB80 print failed: <message>"`. Since PR #14 the web layer records every
attempt (success or failure) through `POST /printing/handoffs`, so the
PrintLog reflects the hand-off — but the hand-off is still only a launch.

A companion method, `printerStatus` (diagnostic only), reports whether
`net.nyx.printerservice` is installed and whether the gateway activity
resolves. It never launches anything and never prints.

## The prepared alternative: raw ESC/POS (Phase 3 PR 3)

`packages/printing` (the ESC/POS builder section of `src/index.ts`) builds a real ESC/POS byte stream for
the Package QR Label from the same input as the text renderer: `ESC @`
init, PC437 code-page select, centred/bold titles, the package QR as a
true `GS ( k` symbol (Model 2, module size 6, error correction M, payload
stored byte-for-byte), the human-readable qrValue under the symbol, a
3-line feed, and a full cut (`GS V 0`). Its output is locked by golden-byte
and structural decode tests (`tests/printing/escpos.test.ts`). Unlike this
PDF route, that stream makes the label's QR **scannable** — on the PDF
route the payload prints as a text line only.

The builder is a library only; nothing sends its bytes anywhere yet.
Device-side work remaining to use it:

1. **A raw byte channel in `NyxPrinterPlugin`** (e.g. a `printEscPos`
   method). Two candidate transports, in the audit's order of preference:
   (a) bind to `net.nyx.printerservice` as a *service* via the NYX vendor
   SDK and write the bytes to its print interface — the SDK jar/AAR is
   **not in the repo today** and must come from the vendor; (b) a generic
   Bluetooth ESC/POS transport if the NB80 exposes one.
2. **On-device proof on the physical NB80**: paper comes out, the QR
   scans back with the app's own scanner flow, feed length and cut
   behaviour are as expected, and the ASCII template set renders
   identically under PC437. Only then does RISK-001 close — and only then
   should any caller switch from this PDF contract to the byte route.
