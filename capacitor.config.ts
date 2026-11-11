import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAP_SERVER_URL || "http://127.0.0.1:3000";

/**
 * Phase 5 P5-5: production-safe by default. Cleartext HTTP, mixed
 * content, and WebView debugging are DEV-ONLY conveniences (they let a
 * local shell talk to a plain-HTTP dev server and be inspected from
 * Chrome) and must never ship in a production build — a production
 * shell points at an HTTPS origin (CAP_SERVER_URL) and gets all three
 * flags off. Local development opts back in explicitly:
 *
 *   CAP_DEV=true CAP_SERVER_URL=http://<dev-host>:3000 npx cap sync
 *
 * Dev implication: without CAP_DEV=true the shell will refuse the
 * default http://127.0.0.1:3000 dev server — that refusal is the point.
 */
const devMode = process.env.CAP_DEV === "true";

const config: CapacitorConfig = {
  appId: "com.mancenido.lbmp.test",
  appName: "LBMP Test",
  webDir: "apps/web/public",
  bundledWebRuntime: false,
  server: {
    url: serverUrl,
    cleartext: devMode
  },
  android: {
    allowMixedContent: devMode,
    webContentsDebuggingEnabled: devMode
  },
  plugins: {
    Camera: {
      permissions: ["camera", "photos"]
    }
  }
};

export default config;
