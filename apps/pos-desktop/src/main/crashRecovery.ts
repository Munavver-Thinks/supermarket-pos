import { shouldAutoReload } from "@pos/business-logic";
import type { Db } from "@pos/database";
import { app, dialog, type BrowserWindow } from "electron";

import { reportError } from "./errorReporting.js";

/**
 * Keeps the counter usable when the screen itself fails. A crashed renderer is reloaded
 * straight away (open bills are autosaved as drafts, so the recovery window offers them
 * back); a renderer that keeps crashing, or hangs, gets a dialog instead of a loop. Every
 * event is logged with a reference id the cashier can quote.
 *
 * Nothing here may throw: an exception from a crash handler would take the main process
 * down with the renderer.
 */

export interface LastCrash {
  errorId: string;
  reason: string;
  at: string;
}

let lastCrash: LastCrash | null = null;

/** The last renderer crash, cleared on read so the recovery notice shows once. */
export function takeLastCrash(): LastCrash | null {
  const crash = lastCrash;
  lastCrash = null;
  return crash;
}

export function installCrashRecovery(
  win: BrowserWindow,
  deps: { getDb: () => Db | undefined; getStoreId: () => string | null },
): void {
  const wc = win.webContents;
  const crashTimes: number[] = [];
  let unresponsiveDialog: AbortController | null = null;
  // Set when we kill a hung renderer ourselves, so its "gone" event doesn't count as a crash loop.
  let deliberateKill = false;

  const report = (context: string, error: unknown): string =>
    reportError(deps.getDb(), { storeId: deps.getStoreId(), userId: null, context }, error);

  const safely = (context: string, fn: () => void | Promise<void>): void => {
    try {
      const pending = fn();
      if (pending) pending.catch((error: unknown) => report(`${context}:handler`, error));
    } catch (error) {
      try {
        report(`${context}:handler`, error);
      } catch {
        // Nothing left to do; never rethrow from here.
      }
    }
  };

  wc.on("render-process-gone", (_event, details) => {
    safely("render-process-gone", async () => {
      const errorId = report(
        "render-process-gone",
        new Error(`Renderer gone: ${details.reason} (exit code ${details.exitCode})`),
      );
      if (deliberateKill) {
        // We killed a hung screen; the unresponsive handler reloads it and already set the
        // reference the cashier saw.
        deliberateKill = false;
        return;
      }
      if (details.reason === "clean-exit") return;
      lastCrash = { errorId, reason: details.reason, at: new Date().toISOString() };
      if (win.isDestroyed()) return;

      const now = Date.now();
      const reload = shouldAutoReload(crashTimes, now);
      crashTimes.push(now);
      if (reload) {
        wc.reload();
        return;
      }

      const { response } = await dialog.showMessageBox(win, {
        type: "error",
        title: "Supermarket POS",
        message: `The screen stopped working (ref: ${errorId}).`,
        detail:
          "It has stopped several times in the last few minutes. Open bills are saved automatically and can be " +
          "restored in Billing after reloading.",
        buttons: ["Reload", "Quit"],
        defaultId: 0,
        cancelId: 0,
      });
      if (win.isDestroyed()) return;
      if (response === 1) app.quit();
      else wc.reload();
    });
  });

  win.on("unresponsive", () => {
    safely("unresponsive", async () => {
      if (unresponsiveDialog || win.isDestroyed()) return; // one dialog at a time
      const errorId = report("unresponsive", new Error("Renderer is not responding"));
      const controller = new AbortController();
      unresponsiveDialog = controller;
      try {
        const { response } = await dialog.showMessageBox(win, {
          type: "warning",
          title: "Supermarket POS",
          message: `Supermarket POS is not responding (ref: ${errorId}).`,
          detail: "You can wait for it, or reload the screen. Open bills are saved automatically.",
          buttons: ["Wait", "Reload"],
          defaultId: 0,
          cancelId: 0,
          signal: controller.signal,
        });
        // An aborted dialog (the screen recovered on its own) resolves with the cancel id.
        if (response === 1 && !controller.signal.aborted && !win.isDestroyed()) {
          deliberateKill = true;
          lastCrash = { errorId, reason: "unresponsive", at: new Date().toISOString() };
          wc.forcefullyCrashRenderer();
          wc.reload();
        }
      } finally {
        unresponsiveDialog = null;
      }
    });
  });

  win.on("responsive", () => {
    safely("responsive", () => {
      unresponsiveDialog?.abort();
    });
  });

  wc.on("preload-error", (_event, preloadPath, error) => {
    safely("preload-error", () => {
      report(`preload-error:${preloadPath}`, error);
    });
  });

  wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    safely("did-fail-load", () => {
      if (!isMainFrame) return;
      report("did-fail-load", new Error(`Load failed (${errorCode} ${errorDescription}) for ${validatedURL}`));
    });
  });
}
