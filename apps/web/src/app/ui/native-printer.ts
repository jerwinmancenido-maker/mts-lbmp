"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { prepareTextForPrint, type PrinterDiagnosticCheck } from "@mts-lbmp/printing";

type NativePrintResult = {
  ok: boolean;
  route?: string;
  file?: string;
  message?: string;
};

type NativePrinterStatus = {
  ok: boolean;
  packageInstalled?: boolean;
  gatewayAvailable?: boolean;
  route?: string;
  message?: string;
};

type NyxPrinterPlugin = {
  printText(options: { text: string; documentName?: string; paperWidth?: "58mm" | "80mm" }): Promise<NativePrintResult>;
  printerStatus(): Promise<NativePrinterStatus>;
};

const NyxPrinter = registerPlugin<NyxPrinterPlugin>("NyxPrinter");

function errorDetail(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function printNativeText(text: string, documentName = "LBMP Print", paperWidth: "58mm" | "80mm" = "80mm"): Promise<NativePrintResult> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, message: "Native printer is available only inside the Android APK." };
  }

  // The API renders documents at the canonical 42-col width; prepareTextForPrint
  // passes 80mm text through exactly as rendered (no silent re-wrap) and only
  // down-wraps deliberately for 58mm paper. See @mts-lbmp/printing.
  return NyxPrinter.printText({ text: prepareTextForPrint(text, paperWidth), documentName, paperWidth });
}

export async function getNativePrinterStatus(): Promise<NativePrinterStatus> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, message: "Native printer is available only inside the Android APK." };
  }
  return NyxPrinter.printerStatus();
}

/**
 * Runs the real Device Setup printer diagnostic and returns the measured
 * checks. Nothing here is self-attested: plugin presence is proven by the
 * plugin answering its status call, the gateway route by the plugin
 * resolving the vendor activity, and the hand-off by an actual test payload
 * print attempt. The caller persists the checks via
 * POST /hardware/printer-diagnostic, which derives Pass/Fail from them.
 */
export async function runPrinterDiagnostic(options: {
  testText: string;
  paperWidth: "58mm" | "80mm";
}): Promise<PrinterDiagnosticCheck[]> {
  const checks: PrinterDiagnosticCheck[] = [];

  if (!Capacitor.isNativePlatform()) {
    checks.push({
      name: "Native printer plugin",
      status: "Fail",
      detail: "Browser/PWA context — the NyxPrinter plugin exists only inside the Android APK"
    });
    checks.push({ name: "NB80 gateway route", status: "Fail", detail: "Not checked — no native platform" });
    checks.push({ name: "Test payload hand-off", status: "Fail", detail: "Not attempted — no native platform" });
    return checks;
  }

  let status: NativePrinterStatus | undefined;
  try {
    status = await NyxPrinter.printerStatus();
    checks.push({
      name: "Native printer plugin",
      status: "Pass",
      detail: `Plugin responded (route ${status.route ?? "net.nyx.printerservice.pdf"})`
    });
  } catch (error) {
    checks.push({
      name: "Native printer plugin",
      status: "Fail",
      detail: errorDetail(error, "Plugin status call failed")
    });
  }

  if (!status) {
    checks.push({ name: "NB80 gateway route", status: "Fail", detail: "Not checked — plugin status call failed" });
  } else if (status.gatewayAvailable) {
    checks.push({
      name: "NB80 gateway route",
      status: "Pass",
      detail: "net.nyx.printerservice gateway activity resolved"
    });
  } else {
    checks.push({
      name: "NB80 gateway route",
      status: "Fail",
      detail: status.packageInstalled
        ? "net.nyx.printerservice is installed but its gateway activity did not resolve"
        : "net.nyx.printerservice is not installed on this device"
    });
  }

  try {
    const handoff = await printNativeText(options.testText, "LBMP Device Test", options.paperWidth);
    checks.push(
      handoff.ok
        ? {
            name: "Test payload hand-off",
            status: "Pass",
            detail: handoff.message ?? "Gateway intent launched — confirm paper output"
          }
        : {
            name: "Test payload hand-off",
            status: "Fail",
            detail: handoff.message ?? "Print hand-off returned not-ok"
          }
    );
  } catch (error) {
    checks.push({
      name: "Test payload hand-off",
      status: "Fail",
      detail: errorDetail(error, "Print hand-off threw an error")
    });
  }

  return checks;
}
