"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { formatThermalTextForPaper } from "@mts-lbmp/printing";

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

export async function printNativeText(text: string, documentName = "LBMP Print", paperWidth: "58mm" | "80mm" = "80mm"): Promise<NativePrintResult> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, message: "Native printer is available only inside the Android APK." };
  }

  return NyxPrinter.printText({ text: formatThermalTextForPaper(text, paperWidth), documentName, paperWidth });
}
