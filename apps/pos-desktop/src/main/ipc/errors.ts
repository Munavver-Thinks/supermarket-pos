import { app, ipcMain } from "electron";
import { z } from "zod";

import { IPC_CHANNELS } from "../../shared/ipc.js";
import { takeLastCrash } from "../crashRecovery.js";
import { createRendererErrorLimiter, reportError } from "../errorReporting.js";

import { safeHandle, type HandlerContext } from "./common.js";

const rendererErrorSchema = z.object({
  message: z.string().max(2000),
  stack: z.string().max(20_000).nullable().optional(),
  componentStack: z.string().max(20_000).nullable().optional(),
  context: z.string().max(200).nullable().optional(),
});

/**
 * Errors the screen catches (a component that threw, an unhandled promise) are logged here
 * so the cashier gets a reference id that exists in error_logs. Not gated by activation or
 * sign-in: a failing screen must always be able to say so.
 */
export function registerErrorHandlers(ctx: HandlerContext): void {
  const limit = createRendererErrorLimiter();

  ipcMain.handle(
    IPC_CHANNELS.errorsReportRenderer,
    safeHandle(ctx, IPC_CHANNELS.errorsReportRenderer, async (db, input: unknown) => {
      const parsed = rendererErrorSchema.parse(input);
      const { errorId } = limit(() => {
        const error = new Error(parsed.message);
        error.stack = [parsed.stack, parsed.componentStack && `Component stack:${parsed.componentStack}`]
          .filter(Boolean)
          .join("\n");
        return reportError(
          db,
          { storeId: ctx.deviceConfig.storeId, userId: null, context: `renderer:${parsed.context ?? "unknown"}` },
          error,
        );
      });
      return { errorId };
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.errorsTakeLastCrash,
    safeHandle(ctx, IPC_CHANNELS.errorsTakeLastCrash, async () => takeLastCrash()),
  );

  // Development only: lets a tester crash the screen from devtools to check recovery.
  if (!app.isPackaged) {
    ipcMain.handle(IPC_CHANNELS.debugCrashRenderer, (event) => {
      event.sender.forcefullyCrashRenderer();
    });
  }
}
