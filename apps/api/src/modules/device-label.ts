/**
 * Coarse device label for login audit entries (Phase 5 P5-5).
 *
 * Derived ONLY from the User-Agent string the client already sends with
 * every request — no fingerprinting, no extra collection. The label is
 * deliberately coarse ("Chrome on Windows", "Safari on iOS"): enough for
 * an owner reading the audit log to recognise "that was the Daet tablet"
 * vs "that was my phone", never enough to track a device. Anything
 * unrecognised collapses to "Unknown device" (or the single known side).
 */
export function deviceLabelFromUserAgent(userAgent: string | undefined | null): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "Unknown device";

  const browser = ua.includes("Edg/")
    ? "Edge"
    : ua.includes("SamsungBrowser/")
      ? "Samsung Internet"
      : ua.includes("Firefox/")
        ? "Firefox"
        : ua.includes("Chrome/") || ua.includes("CriOS/")
          ? "Chrome"
          : ua.includes("Safari/")
            ? "Safari"
            : undefined;

  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : ua.includes("Android")
      ? "Android"
      : ua.includes("Windows")
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : ua.includes("Linux")
            ? "Linux"
            : undefined;

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `Unknown browser on ${os}`;
  return "Unknown device";
}
