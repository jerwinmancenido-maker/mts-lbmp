import { describe, expect, test } from "vitest";
import { summarizePrinterDiagnostic, type PrinterDiagnosticCheck } from "@mts-lbmp/printing";

describe("summarizePrinterDiagnostic", () => {
  test("all checks passing derives Pass and a per-check breakdown", () => {
    const checks: PrinterDiagnosticCheck[] = [
      { name: "Native printer plugin", status: "Pass", detail: "Plugin responded" },
      { name: "NB80 gateway route", status: "Pass", detail: "Gateway activity resolved" },
      { name: "Test payload hand-off", status: "Pass" }
    ];

    const summary = summarizePrinterDiagnostic(checks);

    expect(summary.printerResult).toBe("Pass");
    expect(summary.notes).toContain("Native printer plugin: Pass — Plugin responded");
    expect(summary.notes).toContain("NB80 gateway route: Pass — Gateway activity resolved");
    expect(summary.notes).toContain("Test payload hand-off: Pass");
  });

  test("any failed check derives Fail and keeps the error text in the breakdown", () => {
    const checks: PrinterDiagnosticCheck[] = [
      { name: "Native printer plugin", status: "Pass" },
      {
        name: "NB80 gateway route",
        status: "Fail",
        detail: "net.nyx.printerservice is not installed on this device"
      },
      { name: "Test payload hand-off", status: "Fail", detail: "Not attempted — gateway unavailable" }
    ];

    const summary = summarizePrinterDiagnostic(checks);

    expect(summary.printerResult).toBe("Fail");
    expect(summary.notes).toContain(
      "NB80 gateway route: Fail — net.nyx.printerservice is not installed on this device"
    );
    expect(summary.notes).toContain("Test payload hand-off: Fail");
  });

  test("a run with no checks is a Fail, never a pass", () => {
    const summary = summarizePrinterDiagnostic([]);

    expect(summary.printerResult).toBe("Fail");
    expect(summary.notes).toContain("No checks ran");
  });
});
