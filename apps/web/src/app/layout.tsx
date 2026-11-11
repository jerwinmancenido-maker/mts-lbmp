import type { Metadata, Viewport } from "next";
import "./styles.css";
import { ServiceWorkerRegistrar } from "./sw-registrar";

export const metadata: Metadata = {
  title: "LBMP",
  description: "Mancenido Trucking Services Logistics Business Management Platform",
  manifest: "/manifest.json",
  applicationName: "LBMP",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg"
  },
  formatDetection: {
    telephone: false
  },
  appleWebApp: {
    capable: true,
    title: "LBMP",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#102033"
};

const criticalFallbackCss = `
  :root{color-scheme:light;--role-accent:#2563eb;--role-soft:#dbeafe;--surface:#f8fafc;--panel:#fff;--border:#e2e8f0;--text:#0f172a;--muted:#64748b;--font-page-title:28px;--font-body:16px;--font-label:14px;--font-caption:12px;--font-button:16px;--font-tile-title:22px;--font-tile-note:13px}
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%;background:var(--surface);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-x:hidden;font-size:var(--font-body)}
  button,input,select,textarea{font:inherit}
  button{min-height:44px;border:1px solid var(--border);border-radius:12px;background:var(--panel);color:var(--text);font-weight:800}
  input,select,textarea{width:100%;min-height:52px;border:1px solid var(--border);border-radius:12px;background:var(--panel);padding:0 14px;color:var(--text);font-weight:800}
  .app{min-height:100dvh;background:var(--surface);overflow-x:hidden}
  .app.role-admin{--role-accent:#2563eb;--role-soft:#dbeafe}
  .app.role-receiving{--role-accent:#16a34a;--role-soft:#dcfce7}
  .app.role-delivery{--role-accent:#f59e0b;--role-soft:#fef3c7}
  .mobileTopbar,.mobileTabs{display:none}
  .swipeContent,.homeScreen{display:grid;gap:14px;min-width:0}
  .topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:18px;margin:0 0 10px;padding:18px;border:1px solid var(--border);border-radius:10px;background:var(--panel);min-width:0}
  .topbar>div:first-child{min-width:220px}
  .topbar h2{margin:0;font-size:var(--font-page-title);line-height:1.1}
  .eyebrow{margin:0 0 6px;color:var(--role-accent);text-transform:uppercase;font-size:var(--font-caption);font-weight:900}
  .searchBox{min-height:52px;width:min(420px,34vw);min-width:min(280px,100%);max-width:420px;flex:1 1 280px;display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:0 12px}
  .searchBox input{border:0;background:transparent;min-height:46px;padding:0}
  .accountHeaderButton,.syncPill,.statusPill{min-height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:0 14px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .accountHeaderButton{border:0;background:var(--role-soft);color:var(--role-accent);gap:8px}
  .syncPill,.statusPill{border:1px solid var(--border);background:var(--surface);color:var(--text)}
  .mobileHeaderTitle span,.pageSubtitle,.muted{color:var(--muted)}
  .content,.pageContent,.moduleContent{width:min(1120px,100%);margin:0 auto;padding:14px;display:grid;gap:14px}
  .panel,.subPanel,.workflow,.homeHero{border:1px solid var(--border);border-radius:14px;background:var(--panel);padding:clamp(14px,2vw,18px);display:grid;gap:14px}
  .tileGrid,.moduleTileGrid,.homeTileGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:12px}
  .tile,.moduleTile,.homeTile{min-height:112px;border:1px solid var(--border);border-radius:12px;background:var(--panel);padding:16px;text-align:left;display:grid;gap:10px;align-content:space-between;box-shadow:0 10px 24px rgba(15,23,42,.06)}
  .tile.active,.moduleTile.active,.homeTile.active,.tile.dark,.moduleTile.dark,.homeTile.dark{background:var(--role-accent);border-color:var(--role-accent);color:#fff}
  .tile.medium,.moduleTile.medium,.homeTile.medium{background:var(--role-soft);border-color:color-mix(in srgb,var(--role-accent) 32%,var(--border));color:var(--role-accent)}
  .tile.light,.moduleTile.light,.homeTile.light{background:var(--panel);color:var(--text)}
  .tile strong,.moduleTile strong,.homeTile strong{font-size:var(--font-tile-title);line-height:1.1}
  .tile span,.moduleTile span,.homeTile span{font-size:var(--font-tile-note)}
  .homeTileTop{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .homeTileBadge{min-width:32px;min-height:32px;border-radius:999px;background:var(--role-soft);color:var(--role-accent);display:inline-flex;align-items:center;justify-content:center;padding:0 8px;font-weight:900}
  .badge,.syncBadge{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:var(--role-soft);color:var(--role-accent);padding:6px 10px;font-weight:900}
  .primaryButton,.actionButton{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--role-accent);border-color:var(--role-accent);color:#fff;font-size:var(--font-button)}
  .smallButton,.iconOnlyButton{min-height:40px}
  .formGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .row,.denseRow{border:1px solid var(--border);border-radius:12px;background:var(--panel);padding:12px;display:grid;gap:6px;text-align:left}
  @media(max-width:760px){
    :root{--font-page-title:22px;--font-body:14px;--font-label:12px;--font-caption:10.5px;--font-button:14px;--font-tile-title:18px;--font-tile-note:11px}
    .content,.pageContent,.moduleContent{padding:8px 10px 18px}
    .topbar{display:none}
    .mobileTopbar{position:sticky;top:0;z-index:20;display:grid;gap:4px;margin:0 -10px;padding:6px 10px;border-bottom:1px solid var(--border);background:var(--panel)}
    .mobileAppBar{min-height:48px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px}
    .mobileBrand{display:grid;min-width:0;border:0;background:transparent;padding:0;text-align:left}
    .mobileBrand strong{color:var(--role-accent);font-size:23px;line-height:1;font-weight:900}
    .mobileBrand span{color:var(--muted);font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .mobileHeaderActions{display:flex;gap:8px}
    .mobileIconButton,.mobileAccountButton,.mobileBackButton{width:44px;height:44px;min-height:44px;border-radius:999px;padding:0}
    .mobileAccountButton{background:var(--role-accent);color:#fff}
    .mobileSyncLine{justify-self:start;min-height:24px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--muted);padding:3px 10px;font-size:11px;font-weight:900}
    .homeScreen{gap:10px}
    .tileGrid,.moduleTileGrid,.homeTileGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .tile,.moduleTile,.homeTile{min-height:112px;padding:12px}
    .tile strong,.moduleTile strong,.homeTile strong{font-size:var(--font-tile-title)}
  }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: criticalFallbackCss }} />
      </head>
      <body>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
