"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

type NativePrintResult = {
  ok: boolean;
  route?: string;
  file?: string;
  message?: string;
};

type NyxPrinterPlugin = {
  printText(options: { text: string; documentName?: string; paperWidth?: "58mm" | "80mm" }): Promise<NativePrintResult>;
};

const NyxPrinter = registerPlugin<NyxPrinterPlugin>("NyxPrinter");

function wrapPrintLine(line: string, width: number) {
  const normalized = line.trimEnd();
  if (!normalized.trim()) return [""];
  if (/^-{8,}$/.test(normalized.trim())) return ["-".repeat(width)];

  const trimmedLeft = normalized.trimStart();
  const shouldCenter = normalized.length > trimmedLeft.length && !trimmedLeft.includes(":");
  const source = shouldCenter ? trimmedLeft.trim() : normalized.trim();
  const lines: string[] = [];
  let remaining = source;

  while (remaining.length > width) {
    let breakAt = width;
    const lastSpace = remaining.slice(0, width + 1).lastIndexOf(" ");
    if (lastSpace > Math.floor(width * 0.45)) breakAt = lastSpace;
    lines.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }

  if (remaining) lines.push(remaining);
  if (shouldCenter) {
    return lines.map((value) => value.padStart(Math.max(value.length, Math.floor((width + value.length) / 2))));
  }
  return lines;
}

function normalizeReceiptTextForPaper(text: string, paperWidth: "58mm" | "80mm") {
  const width = paperWidth === "58mm" ? 32 : 42;
  return `${text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((line) => wrapPrintLine(line, width))
    .join("\n")}\n`;
}

export async function printNativeText(text: string, documentName = "LBMP Print", paperWidth: "58mm" | "80mm" = "80mm"): Promise<NativePrintResult> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, message: "Native printer is available only inside the Android APK." };
  }

  return NyxPrinter.printText({ text: normalizeReceiptTextForPaper(text, paperWidth), documentName, paperWidth });
}
