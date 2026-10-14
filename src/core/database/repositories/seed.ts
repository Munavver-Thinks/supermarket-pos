import { randomUUID } from "node:crypto";

import type { Db } from "../connection.js";

export interface FirstRunSeedInput {
  organizationName: string;
  storeName: string;
  deviceName: string;
  ownerUsername: string;
  ownerPasswordHash: string;
  ownerDisplayName: string;
}

export interface FirstRunSeedResult {
  organizationId: string;
  storeId: string;
  deviceId: string;
  ownerUserId: string;
}

/** Runs once, when the local database has no organization yet (fresh install). */
export async function seedFirstRun(db: Db, input: FirstRunSeedInput): Promise<FirstRunSeedResult> {
  const existing = await db.selectFrom("organizations").select("id").executeTakeFirst();
  if (existing) {
    throw new Error("Database is already initialized — seedFirstRun must only run once.");
  }

  return db.transaction().execute(async (trx) => {
    const organizationId = randomUUID();
    const storeId = randomUUID();
    const deviceId = randomUUID();
    const ownerUserId = randomUUID();

    await trx.insertInto("organizations").values({ id: organizationId, name: input.organizationName }).execute();
    await trx
      .insertInto("stores")
      .values({ id: storeId, organizationId, name: input.storeName, address: null, gstin: null, stateCode: null })
      .execute();
    await trx
      .insertInto("devices")
      .values({
        id: deviceId,
        storeId,
        name: input.deviceName,
        // A placeholder: the column is NOT NULL UNIQUE. A real key replaces it on activation,
        // which is also when activatedAt is set.
        activationKey: randomUUID(),
        activatedAt: null,
      })
      .execute();
    await trx
      .insertInto("users")
      .values({
        id: ownerUserId,
        storeId,
        username: input.ownerUsername,
        passwordHash: input.ownerPasswordHash,
        displayName: input.ownerDisplayName,
        role: "owner",
      })
      .execute();

    return { organizationId, storeId, deviceId, ownerUserId };
  });
}

export async function isFirstRun(db: Db): Promise<boolean> {
  const existing = await db.selectFrom("organizations").select("id").executeTakeFirst();
  return !existing;
}
