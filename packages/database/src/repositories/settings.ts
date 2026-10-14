import type { Db } from "../connection.js";

export async function getSetting(db: Db, key: string): Promise<string | undefined> {
  const row = await db.selectFrom("appSettings").select("value").where("key", "=", key).executeTakeFirst();
  return row?.value;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insertInto("appSettings")
    .values({ key, value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
}
