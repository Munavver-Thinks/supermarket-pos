import {
  changeOwnPasswordRequestSchema,
  resetPasswordRequestSchema,
  setEmployeeActiveRequestSchema,
  updateEmployeeRequestSchema,
} from "@pos/validation";
import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../../shared/ipc.js";
import { changeOwnPassword, resetEmployeePassword, setEmployeeActive, updateEmployee } from "../auth.js";

import { safeHandle, type HandlerContext } from "./common.js";

/**
 * Employee edits and passwords. Every rule (who may change whom, the last owner, the
 * password rule) lives in auth.ts, which re-reads the acting user from the database; these
 * handlers only validate the shape and fill in the store and device.
 */
export function registerStaffHandlers(ctx: HandlerContext): void {
  const { storeId, deviceId } = ctx.deviceConfig;

  ipcMain.handle(
    IPC_CHANNELS.usersUpdate,
    safeHandle(ctx, IPC_CHANNELS.usersUpdate, async (db, input: unknown) => {
      const parsed = updateEmployeeRequestSchema.parse(input);
      return updateEmployee(db, { ...parsed, storeId, deviceId });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.usersSetActive,
    safeHandle(ctx, IPC_CHANNELS.usersSetActive, async (db, input: unknown) => {
      const parsed = setEmployeeActiveRequestSchema.parse(input);
      return setEmployeeActive(db, { ...parsed, storeId, deviceId });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.usersResetPassword,
    safeHandle(ctx, IPC_CHANNELS.usersResetPassword, async (db, input: unknown) => {
      const parsed = resetPasswordRequestSchema.parse(input);
      return resetEmployeePassword(db, { ...parsed, storeId, deviceId });
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.usersChangeOwnPassword,
    safeHandle(ctx, IPC_CHANNELS.usersChangeOwnPassword, async (db, input: unknown) => {
      const parsed = changeOwnPasswordRequestSchema.parse(input);
      return changeOwnPassword(db, { ...parsed, storeId, deviceId });
    }),
  );
}
