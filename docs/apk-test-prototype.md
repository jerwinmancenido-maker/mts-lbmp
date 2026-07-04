# LBMP Test APK Prototype

This is a test APK setup for validating LBMP on the NB80 Android POS tablet. It is not the production APK path yet.

## Current Wrapper Behavior

- Capacitor app id: `com.mancenido.lbmp.test`
- App name: `LBMP Test`
- Android project: `android/`
- Default test server inside APK: `http://127.0.0.1:3000`
- Cleartext HTTP is enabled for test builds.
- WebView debugging is enabled for prototype testing.

The APK currently loads the running web app from the Mac through `adb reverse`.
Keep the web app and API servers running while testing. This avoids problems when the Mac IP changes or Wi-Fi blocks device-to-device traffic.

## Mac Setup Required

Install:

- Android Studio
- Android SDK Platform Tools
- Java JDK included/managed by Android Studio

Then reopen Terminal and verify:

```bash
npm run apk:doctor
```

Expected ready state:

- Java JDK: PASS
- ADB: PASS
- Connected Android devices: PASS after NB80 is connected
- Capacitor Android project: PASS
- Android Gradle wrapper: PASS

## NB80 Setup

On the NB80:

1. Enable Developer Options.
2. Enable USB Debugging.
3. Connect the tablet to the Mac by USB.
4. Accept the USB debugging prompt.
5. Run:

```bash
adb devices
```

The device must show as `device`, not `unauthorized`.

## Build And Install

With the web app running:

```bash
npm run dev
npm run dev:api
```

In another terminal:

```bash
npm run apk:sync
npm run apk:build:debug
npm run apk:install
npm run apk:reverse
```

If you intentionally want to test over LAN instead of `adb reverse`, run sync with the Mac IP:

```bash
CAP_SERVER_URL=http://YOUR_MAC_IP:3000 npm run apk:sync
```

For normal NB80 hardware testing, prefer:

```bash
npm run apk:reverse
```

## Hardware Test Order

1. App opens and loads Home tiles.
2. Receive module opens.
3. Camera opens for DR photo.
4. DR photo saves or queues.
5. Scanner writes scanned text into the focused field.
6. Offline queue survives close/reopen.
7. Print preview opens.
8. Built-in printer test.

## Known Limit

The built-in NB80 printer may not work from browser print or basic WebView. If it does not react, production APK work needs a native ESC/POS bridge or the NB80 printer SDK.
