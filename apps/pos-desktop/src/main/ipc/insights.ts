import {
  buildMarginRows,
  buildStockAlerts,
  canViewReports,
  EXPIRY_ALERT_DAYS,
  localDateIso,
} from "@pos/business-logic";
import { insightsRepo, inventoryRepo, stockBatchesRepo, type Db } from "@pos/database";
import { deadStockOptionsSchema, reportRequestSchema, slowMovingOptionsSchema } from "@pos/validation";
import { ipcMain } from "electron";
import { z } from "zod";

import { IPC_CHANNELS } from "../../shared/ipc.js";

import { getStoreActor, safeHandle, type HandlerContext } from "./common.js";

const actorRequestSchema = z.object({ storeId: z.string().uuid(), actingUserId: z.string().uuid() });

/** Local midnight today, as an ISO instant — "today" means the shop's day, not UTC's. */
function startOfTodayIso(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

export function registerInsightsHandlers(ctx: HandlerContext): void {
  /**
   * Reports carry cost prices and margins, so the acting user's role is re-read from the
   * database on every call — the same rule as the existing reports.
   */
  async function assertReportAccess(db: Db, storeId: string, actingUserId: string): Promise<string | null> {
    if (storeId !== ctx.deviceConfig.storeId) return "You are not signed in to this store.";
    const actor = await getStoreActor(db, ctx, actingUserId);
    if ("error" in actor) return actor.error;
    if (!canViewReports(actor.role)) return "Reports are available to owners and managers.";
    return null;
  }

  ipcMain.handle(
    IPC_CHANNELS.dashboardGetSummary,
    safeHandle(ctx, IPC_CHANNELS.dashboardGetSummary, async (db, storeId: unknown, actingUserId: unknown) => {
      const parsed = actorRequestSchema.parse({ storeId, actingUserId });
      if (parsed.storeId !== ctx.deviceConfig.storeId) {
        return { ok: false as const, error: "You are not signed in to this store." };
      }
      const actor = await getStoreActor(db, ctx, parsed.actingUserId);
      if ("error" in actor) return { ok: false as const, error: actor.error };

      // Everyone sees the day's takings and stock counts; profit only reaches report viewers,
      // and is left out of the response entirely for everyone else.
      return insightsRepo.getDashboardSummary(db, parsed.storeId, {
        startIso: startOfTodayIso(),
        today: localDateIso(),
        alertDays: EXPIRY_ALERT_DAYS,
        includeProfit: canViewReports(actor.role),
      });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsProfit,
    safeHandle(ctx, IPC_CHANNELS.reportsProfit, async (db, req: unknown) => {
      const parsed = reportRequestSchema.parse(req);
      const denied = await assertReportAccess(db, parsed.storeId, parsed.actingUserId);
      if (denied) return { ok: false as const, error: denied };
      return insightsRepo.getProfitReport(db, parsed.storeId, parsed);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsSlowMoving,
    safeHandle(ctx, IPC_CHANNELS.reportsSlowMoving, async (db, req: unknown, opts: unknown) => {
      const parsed = actorRequestSchema.parse(req);
      const options = slowMovingOptionsSchema.parse(opts ?? {});
      const denied = await assertReportAccess(db, parsed.storeId, parsed.actingUserId);
      if (denied) return { ok: false as const, error: denied };
      return insightsRepo.getSlowMovingStock(db, parsed.storeId, {
        asOfIso: new Date().toISOString(),
        lookbackDays: options.lookbackDays,
        minCoverDays: options.minCoverDays,
      });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsDeadStock,
    safeHandle(ctx, IPC_CHANNELS.reportsDeadStock, async (db, req: unknown, opts: unknown) => {
      const parsed = actorRequestSchema.parse(req);
      const options = deadStockOptionsSchema.parse(opts ?? {});
      const denied = await assertReportAccess(db, parsed.storeId, parsed.actingUserId);
      if (denied) return { ok: false as const, error: denied };
      return insightsRepo.getDeadStock(db, parsed.storeId, { asOfIso: new Date().toISOString(), days: options.days });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsMargins,
    safeHandle(ctx, IPC_CHANNELS.reportsMargins, async (db, storeId: unknown, actingUserId: unknown) => {
      const parsed = actorRequestSchema.parse({ storeId, actingUserId });
      const denied = await assertReportAccess(db, parsed.storeId, parsed.actingUserId);
      if (denied) return { ok: false as const, error: denied };
      return buildMarginRows(await insightsRepo.listCurrentPrices(db, parsed.storeId));
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.reportsExpiry,
    safeHandle(
      ctx,
      IPC_CHANNELS.reportsExpiry,
      async (db, storeId: unknown, actingUserId: unknown, withinDays: unknown) => {
        const parsed = actorRequestSchema.parse({ storeId, actingUserId });
        const days = z.number().int().min(0).max(365).parse(withinDays);
        const denied = await assertReportAccess(db, parsed.storeId, parsed.actingUserId);
        if (denied) return { ok: false as const, error: denied };
        return insightsRepo.getExpiryReport(db, parsed.storeId, localDateIso(), days);
      },
    ),
  );

  // Low-stock and expiry alerts aren't sensitive; every signed-in screen can show them.
  ipcMain.handle(
    IPC_CHANNELS.alertsList,
    safeHandle(ctx, IPC_CHANNELS.alertsList, async (db, storeId: unknown) => {
      const store = z.string().uuid().parse(storeId);
      if (store !== ctx.deviceConfig.storeId) return [];
      const today = localDateIso();
      return buildStockAlerts({
        lowStock: await inventoryRepo.getLowStock(db, store),
        batches: await stockBatchesRepo.listExpiring(db, store, today, EXPIRY_ALERT_DAYS),
        today,
        alertDays: EXPIRY_ALERT_DAYS,
      });
    }),
  );
}
