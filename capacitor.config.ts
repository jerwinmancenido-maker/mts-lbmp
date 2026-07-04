import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAP_SERVER_URL || "http://127.0.0.1:3000";

const config: CapacitorConfig = {
  appId: "com.mancenido.lbmp.test",
  appName: "LBMP Test",
  webDir: "apps/web/public",
  bundledWebRuntime: false,
  server: {
    url: serverUrl,
    cleartext: true
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true
  },
  plugins: {
    Camera: {
      permissions: ["camera", "photos"]
    }
  }
};

export default config;
