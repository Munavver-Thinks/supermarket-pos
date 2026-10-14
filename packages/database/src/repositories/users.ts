import type { User, UserRole } from "@pos/types";

import type { Db } from "../connection.js";

export interface UserRow {
  id: string;
  storeId: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  isActive: number;
  createdAt: string;
}

export async function findUserByUsername(
  db: Db,
  storeId: string,
  username: string,
): Promise<UserRow | undefined> {
  const row = await db
    .selectFrom("users")
    .selectAll()
    .where("storeId", "=", storeId)
    .where("username", "=", username)
    .where("isActive", "=", 1)
    .executeTakeFirst();
  return row as UserRow | undefined;
}

/** Looks up a user regardless of active state — used to authorize whoever is acting. */
export async function getById(db: Db, userId: string): Promise<User | undefined> {
  const row = await db
    .selectFrom("users")
    .select(["id", "storeId", "username", "displayName", "role", "isActive", "createdAt"])
    .where("id", "=", userId)
    .executeTakeFirst();
  return row ? { ...row, isActive: row.isActive === 1 } : undefined;
}

/**
 * Deliberately ignores isActive: usernames are unique per store in the schema, so a
 * deactivated account still owns its username and reusing it would hit the constraint.
 */
export async function usernameTaken(db: Db, storeId: string, username: string): Promise<boolean> {
  const row = await db
    .selectFrom("users")
    .select("id")
    .where("storeId", "=", storeId)
    .where("username", "=", username)
    .executeTakeFirst();
  return row !== undefined;
}

export async function createUser(
  db: Db,
  input: {
    id: string;
    storeId: string;
    username: string;
    passwordHash: string;
    displayName: string;
    role: UserRole;
  },
): Promise<void> {
  await db
    .insertInto("users")
    .values({
      id: input.id,
      storeId: input.storeId,
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      role: input.role,
    })
    .execute();
}

/**
 * The full row including the password hash, whatever the active state — for checking a
 * current password. Never send this to the renderer.
 */
export async function getRowById(db: Db, userId: string): Promise<UserRow | undefined> {
  const row = await db.selectFrom("users").selectAll().where("id", "=", userId).executeTakeFirst();
  return row as UserRow | undefined;
}

export async function updateUser(
  db: Db,
  userId: string,
  changes: { displayName: string; role: UserRole },
): Promise<void> {
  await db
    .updateTable("users")
    .set({ displayName: changes.displayName, role: changes.role })
    .where("id", "=", userId)
    .execute();
}

/** Deactivating keeps the row (and its username): bills and audit entries still point at it. */
export async function setUserActive(db: Db, userId: string, isActive: boolean): Promise<void> {
  await db
    .updateTable("users")
    .set({ isActive: isActive ? 1 : 0 })
    .where("id", "=", userId)
    .execute();
}

export async function setPasswordHash(db: Db, userId: string, passwordHash: string): Promise<void> {
  await db.updateTable("users").set({ passwordHash }).where("id", "=", userId).execute();
}

/** Guards the last owner: a shop with no active owner has nobody left who can fix that. */
export async function countActiveOwners(db: Db, storeId: string): Promise<number> {
  const row = await db
    .selectFrom("users")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("storeId", "=", storeId)
    .where("role", "=", "owner")
    .where("isActive", "=", 1)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/** Staff list for the Employees screen. Never selects passwordHash. */
export async function listByStore(db: Db, storeId: string): Promise<User[]> {
  const rows = await db
    .selectFrom("users")
    .select(["id", "storeId", "username", "displayName", "role", "isActive", "createdAt"])
    .where("storeId", "=", storeId)
    .orderBy("displayName")
    .execute();
  return rows.map((row) => ({ ...row, isActive: row.isActive === 1 }));
}
