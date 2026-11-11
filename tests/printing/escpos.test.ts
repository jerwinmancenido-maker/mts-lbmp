// ESC/POS QR Label builder tests (Phase 3, audit gap G2).
//
// The builder in @mts-lbmp/printing (the ESC/POS section of src/index.ts) composes a real ESC/POS
// byte stream for the Package QR Label — including the GS ( k QR commands
// the text route lacks — so the label's payload becomes a scannable symbol
// instead of the literal text line `QR: MTS:PKG:…`.
//
// The golden fixture (./golden/qr-label-escpos.hex) was generated from the
// builder for the same fixture input the text renderer golden uses, and
// the decoded stream was verified by eye against the ESC/POS command spec
// before being committed. The structural tests below decode the stream
// independently of the builder, so a future edit cannot change the wire
// format silently even if the golden is regenerated carelessly.
//
// Nothing here proves paper output: no transport sends these bytes yet.
// RISK-001 stays open until the physical NB80 prints.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  ESC_POS_PROFILE_58MM,
  ESC_POS_PROFILE_80MM,
  ESC_POS_QR_ERROR_CORRECTION,
  EscPosBuilder,
  WIDTH_80MM,
  buildQrLabelEscPos,
  renderQrLabel
} from "@mts-lbmp/printing";

const QR_VALUE = "MTS:PKG:PKG-2026-11-000001";

const qrLabelInput = {
  packageNumber: "PKG-2026-11-000001",
  description: "Angle bar",
  destination: "Daet",
  qrValue: QR_VALUE
};

function goldenHex() {
  return readFileSync(new URL("./golden/qr-label-escpos.hex", import.meta.url), "utf8").trim();
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// --- Minimal ESC/POS stream decoder (test-side, independent of the builder)

type DecodedEvent =
  | { type: "command"; name: string; bytes: number[] }
  | { type: "qr-store"; declaredLength: number; payload: Uint8Array }
  | { type: "text-line"; text: string };

function decodeEscPos(bytes: Uint8Array): DecodedEvent[] {
  const events: DecodedEvent[] = [];
  let text = "";
  const flushText = () => {
    events.push({ type: "text-line", text });
    text = "";
  };

  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte === 0x1b && bytes[i + 1] === 0x40) {
      events.push({ type: "command", name: "init", bytes: [0x1b, 0x40] });
      i += 2;
    } else if (byte === 0x1b && bytes[i + 1] === 0x74) {
      events.push({ type: "command", name: "code-page", bytes: Array.from(bytes.slice(i, i + 3)) });
      i += 3;
    } else if (byte === 0x1b && bytes[i + 1] === 0x61) {
      events.push({ type: "command", name: "align", bytes: Array.from(bytes.slice(i, i + 3)) });
      i += 3;
    } else if (byte === 0x1b && bytes[i + 1] === 0x45) {
      events.push({ type: "command", name: "bold", bytes: Array.from(bytes.slice(i, i + 3)) });
      i += 3;
    } else if (byte === 0x1b && bytes[i + 1] === 0x64) {
      events.push({ type: "command", name: "feed", bytes: Array.from(bytes.slice(i, i + 3)) });
      i += 3;
    } else if (byte === 0x1d && bytes[i + 1] === 0x56) {
      events.push({ type: "command", name: "cut", bytes: Array.from(bytes.slice(i, i + 3)) });
      i += 3;
    } else if (byte === 0x1d && bytes[i + 1] === 0x28 && bytes[i + 2] === 0x6b) {
      const declaredLength = bytes[i + 3] + bytes[i + 4] * 256;
      const fn = bytes[i + 6];
      const commandBytes = Array.from(bytes.slice(i, i + 5 + declaredLength));
      if (fn === 0x50) {
        events.push({
          type: "qr-store",
          declaredLength,
          payload: bytes.slice(i + 8, i + 5 + declaredLength)
        });
      } else {
        const name = fn === 0x41 ? "qr-model" : fn === 0x43 ? "qr-module-size" : fn === 0x45 ? "qr-error-correction" : fn === 0x51 ? "qr-print" : "gs-k";
        events.push({ type: "command", name, bytes: commandBytes });
      }
      i += 5 + declaredLength;
    } else if (byte === 0x0a) {
      flushText();
      i += 1;
    } else {
      text += String.fromCharCode(byte);
      i += 1;
    }
  }
  if (text) flushText();
  return events;
}

function commandBytes(events: DecodedEvent[], name: string): number[][] {
  return events
    .filter((event): event is Extract<DecodedEvent, { type: "command" }> => event.type === "command" && event.name === name)
    .map((event) => event.bytes);
}

function textLines(events: DecodedEvent[]): string[] {
  return events
    .filter((event): event is Extract<DecodedEvent, { type: "text-line" }> => event.type === "text-line")
    .map((event) => event.text);
}

describe("buildQrLabelEscPos — golden bytes", () => {
  test("matches the golden byte stream byte-for-byte", () => {
    expect(toHex(buildQrLabelEscPos(qrLabelInput))).toBe(goldenHex());
  });

  test("is deterministic", () => {
    expect(buildQrLabelEscPos(qrLabelInput)).toEqual(buildQrLabelEscPos(qrLabelInput));
  });
});

describe("buildQrLabelEscPos — stream structure", () => {
  const bytes = buildQrLabelEscPos(qrLabelInput);
  const events = decodeEscPos(bytes);

  test("starts with ESC @ (init) followed by the PC437 code-page select", () => {
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x00]);
    expect(events[0]).toEqual({ type: "command", name: "init", bytes: [0x1b, 0x40] });
    expect(events[1]).toEqual({ type: "command", name: "code-page", bytes: [0x1b, 0x74, 0x00] });
  });

  test("ends with a 3-line feed and a full cut (GS V 0) as the last bytes", () => {
    expect(Array.from(bytes.slice(-6))).toEqual([0x1b, 0x64, 0x03, 0x1d, 0x56, 0x00]);
    const names = events.filter((event) => event.type === "command").map((event) => (event as { name: string }).name);
    expect(names[names.length - 1]).toBe("cut");
  });

  test("issues the QR commands in spec order with the chosen parameters", () => {
    // Model 2: GS ( k, len 4, cn 0x31, fn 0x41, m 0x32 ('2'), n 0.
    expect(commandBytes(events, "qr-model")).toEqual([[0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]]);
    // Module size 6: fn 0x43, n 6.
    expect(commandBytes(events, "qr-module-size")).toEqual([[0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]]);
    // Error correction M: fn 0x45, n 0x31 ('1').
    expect(commandBytes(events, "qr-error-correction")).toEqual([
      [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ESC_POS_QR_ERROR_CORRECTION.M]
    ]);
    // Print: fn 0x51, m 0x30 — and it comes after the store.
    expect(commandBytes(events, "qr-print")).toEqual([[0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]]);
    const order = events.map((event) => (event.type === "qr-store" ? "qr-store" : event.type === "command" ? event.name : "text"));
    expect(order.indexOf("qr-model")).toBeLessThan(order.indexOf("qr-store"));
    expect(order.indexOf("qr-store")).toBeLessThan(order.indexOf("qr-print"));
  });

  test("stores the qrValue byte-for-byte, with length fields = payload bytes + 3", () => {
    const stores = events.filter((event): event is Extract<DecodedEvent, { type: "qr-store" }> => event.type === "qr-store");
    expect(stores).toHaveLength(1);
    const payloadBytes = new TextEncoder().encode(QR_VALUE);
    expect(stores[0].declaredLength).toBe(payloadBytes.length + 3);
    expect(stores[0].payload).toEqual(payloadBytes);
    expect(new TextDecoder().decode(stores[0].payload)).toBe(QR_VALUE);
  });

  test("centres and bolds the titles, and centres the QR block", () => {
    const aligns = commandBytes(events, "align").map((bytes) => bytes[2]);
    expect(aligns).toEqual([1, 0, 1, 0]); // titles, body, QR block, footer block
    const bolds = commandBytes(events, "bold").map((bytes) => bytes[2]);
    expect(bolds).toEqual([1, 0]);
  });
});

describe("buildQrLabelEscPos — content parity with the text renderer", () => {
  test("embeds the renderer's lines, with the QR line replaced by the symbol + bare value", () => {
    const events = decodeEscPos(buildQrLabelEscPos(qrLabelInput));
    const renderedLines = renderQrLabel(qrLabelInput).replace(/\n$/, "").split("\n");
    const expected = renderedLines.map((line, index) => {
      if (index < 2) return line.trim(); // titles: printer centres via ESC a, not padding
      if (line.startsWith("QR: ")) return QR_VALUE; // human-readable value under the symbol
      return line;
    });
    expect(textLines(events)).toEqual(expected);
  });

  test("keeps every text line within the 80mm profile width", () => {
    const events = decodeEscPos(buildQrLabelEscPos(qrLabelInput));
    for (const line of textLines(events)) {
      expect(line.length, `line exceeds 42 cols: ${JSON.stringify(line)}`).toBeLessThanOrEqual(ESC_POS_PROFILE_80MM.columns);
    }
  });

  test("58mm profile down-wraps text to 24 cols but never touches the QR payload", () => {
    const bytes = buildQrLabelEscPos(qrLabelInput, ESC_POS_PROFILE_58MM);
    const events = decodeEscPos(bytes);
    for (const line of textLines(events)) {
      // Locked exception: the human-readable qrValue under the symbol is
      // 26 chars and is never split or truncated — a wrapped payload would
      // defeat its purpose as the scan fallback. It is asserted verbatim
      // below instead of being hidden by the width check.
      if (line === QR_VALUE) continue;
      expect(line.length, `line exceeds 24 cols: ${JSON.stringify(line)}`).toBeLessThanOrEqual(ESC_POS_PROFILE_58MM.columns);
    }
    expect(textLines(events)).toContain(QR_VALUE);
    const store = events.find((event): event is Extract<DecodedEvent, { type: "qr-store" }> => event.type === "qr-store");
    expect(store && new TextDecoder().decode(store.payload)).toBe(QR_VALUE);
  });

  test("honours explicit QR options (module size + error correction)", () => {
    const events = decodeEscPos(buildQrLabelEscPos(qrLabelInput, ESC_POS_PROFILE_80MM, {
      moduleSize: 4,
      errorCorrection: ESC_POS_QR_ERROR_CORRECTION.H
    }));
    expect(commandBytes(events, "qr-module-size")[0][7]).toBe(4);
    expect(commandBytes(events, "qr-error-correction")[0][7]).toBe(ESC_POS_QR_ERROR_CORRECTION.H);
  });
});

describe("EscPosBuilder primitives", () => {
  test("composes the exact expected command sequence", () => {
    const bytes = new EscPosBuilder()
      .initialize()
      .align("center")
      .bold(true)
      .line("TEST")
      .bold(false)
      .qrCode("HELLO")
      .feed(2)
      .cut()
      .build();

    const expected = [
      0x1b, 0x40, // init
      0x1b, 0x61, 0x01, // align center
      0x1b, 0x45, 0x01, // bold on
      0x54, 0x45, 0x53, 0x54, 0x0a, // "TEST\n"
      0x1b, 0x45, 0x00, // bold off
      0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // QR model 2
      0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06, // QR module size 6
      0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31, // QR error correction M
      0x1d, 0x28, 0x6b, 0x08, 0x00, 0x31, 0x50, 0x30, 0x48, 0x45, 0x4c, 0x4c, 0x4f, // QR store "HELLO"
      0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30, // QR print
      0x1b, 0x64, 0x02, // feed 2
      0x1d, 0x56, 0x00 // full cut
    ];
    expect(Array.from(bytes)).toEqual(expected);
  });

  test("profiles stay consistent with the text renderers' widths", () => {
    expect(ESC_POS_PROFILE_80MM.columns).toBe(WIDTH_80MM);
    expect(ESC_POS_PROFILE_58MM.columns).toBe(24);
  });
});
