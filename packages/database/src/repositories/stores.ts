import type { Store } from "@pos/types";

import type { Db } from "../connection.js";

export async function getStore(db: Db, storeId: string): Promise<Store | undefined> {
  return db.selectFrom("stores").selectAll().where("id", "=", storeId).executeTakeFirst();
}
