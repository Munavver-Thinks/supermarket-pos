import { customersRepo } from "@pos/database";
import { ipcMain } from "electron";
import { z } from "zod";

import { IPC_CHANNELS } from "../../shared/ipc.js";

import { safeHandle, type HandlerContext } from "./common.js";

/** Billing-screen reads that aren't part of ringing up a sale. */
export function registerBillingHandlers(ctx: HandlerContext): void {
  // A restored or waiting bill carries only its customer's id; the bar needs the name.
  ipcMain.handle(
    IPC_CHANNELS.billingGetCustomer,
    safeHandle(ctx, IPC_CHANNELS.billingGetCustomer, async (db, rawCustomerId: unknown) => {
      const customerId = z.string().uuid().parse(rawCustomerId);
      const customer = await customersRepo.getById(db, customerId);
      return customer && customer.storeId === ctx.deviceConfig.storeId ? customer : undefined;
    }),
  );
}
