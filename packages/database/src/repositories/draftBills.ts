import type { Cart, DraftBill } from "@pos/types";

import type { Db } from "../connection.js";

export async function saveDraftBill(
  db: Db,
  input: { storeId: string; counterId: string; userId: string; deviceId: string; cart: Cart; label: string | null },
): Promise<void> {
  const cartJson = JSON.stringify(input.cart);
  await db
    .insertInto("draftBills")
    .values({
      clientTxnId: input.cart.clientTxnId,
      storeId: input.storeId,
      counterId: input.counterId,
      userId: input.userId,
      deviceId: input.deviceId,
      cartJson,
      label: input.label,
    })
    .onConflict((oc) =>
      oc.column("clientTxnId").doUpdateSet({
        cartJson,
        label: input.label,
        updatedAt: new Date().toISOString(),
      }),
    )
    .execute();
}

export async function deleteDraftBill(db: Db, clientTxnId: string): Promise<void> {
  await db.deleteFrom("draftBills").where("clientTxnId", "=", clientTxnId).execute();
}

export async function listDraftBillsForDevice(db: Db, deviceId: string): Promise<DraftBill[]> {
  const rows = await db
    .selectFrom("draftBills")
    .selectAll()
    .where("deviceId", "=", deviceId)
    .execute();

  return rows.map((row) => ({
    clientTxnId: row.clientTxnId,
    storeId: row.storeId,
    counterId: row.counterId,
    userId: row.userId,
    deviceId: row.deviceId,
    cart: JSON.parse(row.cartJson) as Cart,
    label: row.label,
    updatedAt: row.updatedAt,
  }));
}
