import { randomUUID } from "node:crypto";

import type { CashSession } from "@pos/types";

import type { Db } from "../connection.js";

export async function openCashSession(
  db: Db,
  input: { storeId: string; counterId: string; userId: string; openingCashPaise: number },
): Promise<CashSession> {
  const id = randomUUID();
  await db
    .insertInto("cashSessions")
    .values({
      id,
      storeId: input.storeId,
      counterId: input.counterId,
      userId: input.userId,
      openingCashPaise: input.openingCashPaise,
    })
    .execute();
  const row = await db.selectFrom("cashSessions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  return row;
}

export async function getOpenCashSession(db: Db, counterId: string): Promise<CashSession | undefined> {
  return db
    .selectFrom("cashSessions")
    .selectAll()
    .where("counterId", "=", counterId)
    .where("closedAt", "is", null)
    .executeTakeFirst();
}

/**
 * Cash actually taken at this counter since the session opened — the figure the drawer is
 * counted against at close. Only the cash portion of each bill counts: a split payment
 * settled half by UPI puts only its cash half in the drawer.
 *
 * Change that was kept on khata rather than handed back stays physically in the drawer in
 * full — the cash leg's amountPaise is only the APPLIED figure (see PaymentInput's doc
 * comments), so the drawer actually holds tenderedPaise, not amountPaise, for those rows. This
 * adds the difference back in. Change that was handed back needs no adjustment: tendered in,
 * change handed out, net is already the applied amount recorded on the leg.
 */
export async function getCashTakenSince(
  db: Db,
  counterId: string,
  sinceIso: string,
): Promise<number> {
  const row = await db
    .selectFrom("payments as p")
    .innerJoin("sales as s", "s.id", "p.saleId")
    .where("s.counterId", "=", counterId)
    .where("s.status", "=", "completed")
    .where("s.createdAt", ">=", sinceIso)
    .where("p.mode", "=", "cash")
    .select((eb) => eb.fn.sum<number>("p.amountPaise").as("total"))
    .executeTakeFirst();

  const khataChangeRows = await db
    .selectFrom("payments as p")
    .innerJoin("sales as s", "s.id", "p.saleId")
    .where("s.counterId", "=", counterId)
    .where("s.status", "=", "completed")
    .where("s.createdAt", ">=", sinceIso)
    .where("p.mode", "=", "cash")
    .where("p.changeAction", "=", "khata")
    .select(["p.tenderedPaise as tenderedPaise", "p.amountPaise as amountPaise"])
    .execute();
  const khataChangeHeldPaise = khataChangeRows.reduce(
    (sum, r) => sum + ((r.tenderedPaise ?? r.amountPaise) - r.amountPaise),
    0,
  );

  return Number(row?.total ?? 0) + khataChangeHeldPaise;
}

export async function closeCashSession(
  db: Db,
  input: { id: string; countedCashPaise: number; closingCashPaise: number },
): Promise<CashSession> {
  await db
    .updateTable("cashSessions")
    .set({
      countedCashPaise: input.countedCashPaise,
      closingCashPaise: input.closingCashPaise,
      variancePaise: input.countedCashPaise - input.closingCashPaise,
      closedAt: new Date().toISOString(),
    })
    .where("id", "=", input.id)
    .execute();
  return db.selectFrom("cashSessions").selectAll().where("id", "=", input.id).executeTakeFirstOrThrow();
}
