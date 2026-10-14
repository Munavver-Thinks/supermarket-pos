import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, Menu } from "electron";
import type { Db } from "@pos/database";

import { IPC_CHANNELS } from "../shared/ipc.js";

import { ACTIVATION_PUBLIC_KEYS } from "./activationPublicKey.js";
import { initActivation } from "./activationService.js";
import { bootstrap, DEFAULT_OWNER_PASSWORD, DEFAULT_OWNER_USERNAME } from "./bootstrap.js";
import { installCrashRecovery } from "./crashRecovery.js";
import type { DeviceConfig } from "./deviceConfig.js";
import { installGlobalErrorHandlers } from "./errorReporting.js";
import { registerActivationHandlers } from "./ipc/activation.js";
import { registerErrorHandlers } from "./ipc/errors.js";
import { registerIpcHandlers } from "./ipcHandlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setName("Supermarket POS");

let db: Db | undefined;
let deviceConfig: DeviceConfig | undefined;
installGlobalErrorHandlers(
  () => db,
  // Best-effort: a main-process error outside any IPC call (a background timer, a bad
  // migration) still reaches an open counter screen instead of failing silently.
  (errorId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.appErrorReported, errorId);
    }
  },
);

/**
 * Never set true in this repo's bootstrap yet: the activation public key checked into
 * activationPublicKey.ts is a pre-release placeholder with no surviving private key, so no
 * real key could ever satisfy it (see that file's comment). The handlers below are wired up
 * so activation works end-to-end once a real keypair exists and something sets
 * `activationRequired: true` on first run — until then `resolveActivationStatus` always
 * comes back "developer" or "not_activated_legacy" and nothing is gated.
 */
const ACTIVATION_BUILD = {
  isPackaged: app.isPackaged,
  forceActivation: process.env["POS_FORCE_ACTIVATION"] === "1",
};

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  installCrashRecovery(win, { getDb: () => db, getStoreId: () => deviceConfig?.storeId ?? null });

  if (process.env["VITE_DEV_SERVER_URL"]) {
    await win.loadURL(process.env["VITE_DEV_SERVER_URL"]);
    win.webContents.openDevTools();
  } else {
    await win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  // Electron's default menu binds Ctrl+R / Ctrl+Shift+R (reload), Ctrl+W (close), devtools,
  // zoom and F11, and makes Alt/F10 focus the menu bar — one stray keypress would reload or
  // close the till mid-bill. The installed app gets no menu at all; `pnpm dev` keeps the
  // default one so reload and devtools stay available while developing.
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
  }

  const result = await bootstrap();
  db = result.db;
  deviceConfig = result.deviceConfig;

  initActivation(result.deviceConfig, { ...ACTIVATION_BUILD, publicKeys: ACTIVATION_PUBLIC_KEYS });

  const ctx = { getDb: () => result.db, deviceConfig: result.deviceConfig };
  registerIpcHandlers(ctx);
  registerActivationHandlers(ctx, ACTIVATION_BUILD);
  registerErrorHandlers(ctx);

  if (result.isFirstRun) {
    console.warn(
      `First run: seeded default owner login "${DEFAULT_OWNER_USERNAME}" / "${DEFAULT_OWNER_PASSWORD}" ` +
        `(change this immediately in Settings) and a demo product catalog with opening stock — ready to bill.`,
    );
  }

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  db?.destroy();
});
