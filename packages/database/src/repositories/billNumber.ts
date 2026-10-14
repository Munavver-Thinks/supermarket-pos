import type { Db } from "../connection.js";

/**
 * Local calendar day, only for a caller that didn't pass one (this package can't load
 * business-logic — see inventory.ts's localToday for the same constraint).
 */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Atomic, gap-free, never-reused counter for one (counterId, periodKey) pair. `billSequence`
 * is keyed by period — a financial year for nextBillNumber, a calendar day for
 * nextDailyBillNumber — so either scheme can share the table without colliding: the two
 * never write the same counterId (a real counter id for sale bills, "return:<counter>" for
 * returns, "po:<store>" for purchase orders).
 */
async function incrementSequence(db: Db, counterId: string, periodKey: string, prefix: string): Promise<number> {
  const result = await db
    .insertInto("billSequence")
    .values({ counterId, financialYear: periodKey, prefix, lastNumber: 1 })
    .onConflict((oc) =>
      oc.columns(["counterId", "financialYear"]).doUpdateSet((eb) => ({
        lastNumber: eb("billSequence.lastNumber", "+", 1),
      })),
    )
    .returning(["lastNumber"])
    .executeTakeFirstOrThrow();
  return result.lastNumber;
}

/**
 * Gap-free per counter + financial year — used for returns and purchase orders, which keep
 * this scheme. See nextDailyBillNumber for sale bills, which reset every day instead.
 */
export async function nextBillNumber(db: Db, counterId: string, prefix: string): Promise<string> {
  const financialYear = getIndianFinancialYear(new Date());
  const lastNumber = await incrementSequence(db, counterId, financialYear, prefix);
  const padded = String(lastNumber).padStart(6, "0");
  return `${prefix}/${financialYear}/${padded}`;
}

/**
 * A sale bill's number: prefix, today's date, and a count that starts at 1 and resets the
 * moment the calendar day changes — "POS-20261005-1", then "POS-20261005-2", and back to
 * "POS-20261006-1" the next day. The date is still part of the number, so two bills never
 * collide across days even though the trailing count repeats — this stays a valid, unique
 * GST invoice number for the financial year, just not a running total since 1 April.
 *
 * `dateIso` should be the same local YYYY-MM-DD the caller already computes for expiry
 * checks (CreateSaleInput.expiryToday) — falls back to the server's own local day if the
 * caller didn't pass one, so this is never left without a date to key on.
 */
export async function nextDailyBillNumber(db: Db, counterId: string, prefix: string, dateIso?: string): Promise<string> {
  const day = dateIso ?? localToday();
  const lastNumber = await incrementSequence(db, counterId, day, prefix);
  return `${prefix}-${day.replaceAll("-", "")}-${lastNumber}`;
}

export function getIndianFinancialYear(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  const end = (start + 1) % 100;
  return `${start}-${String(end).padStart(2, "0")}`;
}
