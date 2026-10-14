import { randomUUID } from "node:crypto";

import type { CustomerBalance, CustomerLedgerEntry, LedgerEntryType, PaymentMode } from "@pos/types";

import type { Db } from "../connection.js";

import { appendAuditLog } from "./auditLog.js";

export class CreditWithoutCustomerError extends Error {
  constructor() {
    super("A credit sale needs a customer on the bill.");
    this.name = "CreditWithoutCustomerError";
  }
}

export class ChangeToKhataWithoutCustomerError extends Error {
  constructor() {
    super("Keeping change on khata needs a customer on the bill.");
    this.name = "ChangeToKhataWithoutCustomerError";
  }
}

export interface RecordCreditSaleInput {
  storeId: string;
  customerId: string | null;
  saleId: string;
  amountPaise: number;
  userId: string;
}

/**
 * Writes the khata entry for the credit portion of a bill. Called inside createSale's
 * transaction: if this throws, the sale rolls back with it, which is the point — a bill
 * that put goods on credit must never exist without the matching debt.
 */
export async function recordCreditSale(db: Db, input: RecordCreditSaleInput): Promise<void> {
  if (input.amountPaise <= 0) return;
  if (!input.customerId) throw new CreditWithoutCustomerError();

  await db
    .insertInto("customerLedgerEntries")
    .values({
      id: randomUUID(),
      storeId: input.storeId,
      customerId: input.customerId,
      entryType: "credit_sale",
      amountPaise: input.amountPaise,
      saleId: input.saleId,
      paymentMode: null,
      note: null,
      userId: input.userId,
    })
    .execute();
}

export interface RecordChangeToKhataInput {
  storeId: string;
  customerId: string | null;
  saleId: string;
  billNo: string;
  amountPaise: number;
  userId: string;
}

/**
 * Writes the khata entry for change the cashier kept rather than handed back. Called inside
 * createSale's own transaction, same rationale as recordCreditSale above: a sale that kept
 * change on khata must never exist without the matching ledger entry.
 */
export async function recordChangeToKhata(db: Db, input: RecordChangeToKhataInput): Promise<void> {
  if (input.amountPaise <= 0) return;
  if (!input.customerId) throw new ChangeToKhataWithoutCustomerError();

  await db
    .insertInto("customerLedgerEntries")
    .values({
      id: randomUUID(),
      storeId: input.storeId,
      customerId: input.customerId,
      entryType: "change_to_khata",
      amountPaise: -Math.abs(input.amountPaise),
      saleId: input.saleId,
      paymentMode: "cash",
      note: `Change from bill ${input.billNo}`,
      userId: input.userId,
    })
    .execute();
}

export interface RecordRepaymentInput {
  storeId: string;
  customerId: string;
  amountPaise: number;
  paymentMode: PaymentMode;
  note: string | null;
  userId: string;
  /** Recorded on the audit entry. */
  deviceId?: string | null | undefined;
}

/** Records money the customer has paid against their khata. Stored negative — see migration 0004. */
export async function recordRepayment(db: Db, input: RecordRepaymentInput): Promise<CustomerLedgerEntry> {
  const id = randomUUID();
  const amountPaise = Math.abs(input.amountPaise);

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("customerLedgerEntries")
      .values({
        id,
        storeId: input.storeId,
        customerId: input.customerId,
        entryType: "repayment",
        amountPaise: -amountPaise,
        saleId: null,
        paymentMode: input.paymentMode,
        note: input.note,
        userId: input.userId,
      })
      .execute();

    await appendAuditLog(trx, {
      storeId: input.storeId,
      userId: input.userId,
      deviceId: input.deviceId ?? null,
      action: "credit_repayment",
      tableName: "customer_ledger_entries",
      recordId: id,
      oldValue: null,
      newValue: { customerId: input.customerId, amountPaise, paymentMode: input.paymentMode },
      reason: input.note,
    });
  });

  return getEntry(db, id);
}

/** What one customer owes right now: the sum of their ledger, never a stored number. */
export async function getBalance(db: Db, customerId: string): Promise<number> {
  const row = await db
    .selectFrom("customerLedgerEntries")
    .select((eb) => eb.fn.sum<number | null>("amountPaise").as("balance"))
    .where("customerId", "=", customerId)
    .executeTakeFirst();

  // SUM over no rows is NULL, and Number(null) is 0 — but Number(undefined) is NaN, so the
  // row itself has to be guarded too.
  return Number(row?.balance ?? 0);
}

/** Balances for many customers at once, so a list doesn't fire one query per row. */
export async function getBalances(db: Db, customerIds: string[]): Promise<Map<string, number>> {
  if (customerIds.length === 0) return new Map();

  const rows = await db
    .selectFrom("customerLedgerEntries")
    .select(["customerId"])
    .select((eb) => eb.fn.sum<number | null>("amountPaise").as("balance"))
    .where("customerId", "in", customerIds)
    .groupBy("customerId")
    .execute();

  return new Map(rows.map((r) => [r.customerId, Number(r.balance ?? 0)]));
}

/**
 * Every customer carrying a balance, largest debt first — the list a shopkeeper works down
 * when chasing payment. Customers who have settled up drop off rather than sitting at zero.
 */
export async function listOutstanding(db: Db, storeId: string): Promise<CustomerBalance[]> {
  const rows = await db
    .selectFrom("customerLedgerEntries as cle")
    .innerJoin("customers as c", "c.id", "cle.customerId")
    .where("cle.storeId", "=", storeId)
    .groupBy(["cle.customerId", "c.name", "c.phone", "c.creditLimitPaise"])
    .having((eb) => eb(eb.fn.sum("cle.amountPaise"), "<>", 0))
    .select([
      "cle.customerId as customerId",
      "c.name as name",
      "c.phone as phone",
      "c.creditLimitPaise as creditLimitPaise",
    ])
    .select((eb) => eb.fn.sum<number | null>("cle.amountPaise").as("balancePaise"))
    .select((eb) => eb.fn.max<string | null>("cle.createdAt").as("lastActivityAt"))
    .execute();

  return rows
    .map((r) => ({
      customerId: r.customerId,
      name: r.name,
      phone: r.phone,
      balancePaise: Number(r.balancePaise ?? 0),
      creditLimitPaise: r.creditLimitPaise,
      lastActivityAt: r.lastActivityAt,
    }))
    .sort((a, b) => b.balancePaise - a.balancePaise);
}

interface EntryRow {
  id: string;
  storeId: string;
  customerId: string;
  entryType: string;
  amountPaise: number;
  saleId: string | null;
  paymentMode: string | null;
  note: string | null;
  userId: string;
  createdAt: string;
  billNo: string | null;
}

function entriesQuery(db: Db) {
  return db
    .selectFrom("customerLedgerEntries as cle")
    .leftJoin("sales as s", "s.id", "cle.saleId")
    .select([
      "cle.id as id",
      "cle.storeId as storeId",
      "cle.customerId as customerId",
      "cle.entryType as entryType",
      "cle.amountPaise as amountPaise",
      "cle.saleId as saleId",
      "cle.paymentMode as paymentMode",
      "cle.note as note",
      "cle.userId as userId",
      "cle.createdAt as createdAt",
      "s.billNo as billNo",
    ]);
}

function rowToEntry(r: EntryRow): CustomerLedgerEntry {
  return {
    id: r.id,
    storeId: r.storeId,
    customerId: r.customerId,
    entryType: r.entryType as LedgerEntryType,
    amountPaise: r.amountPaise,
    saleId: r.saleId,
    billNo: r.billNo,
    paymentMode: r.paymentMode as PaymentMode | null,
    note: r.note,
    userId: r.userId,
    createdAt: r.createdAt,
  };
}

export async function getEntry(db: Db, id: string): Promise<CustomerLedgerEntry> {
  const row = await entriesQuery(db).where("cle.id", "=", id).executeTakeFirstOrThrow();
  return rowToEntry(row);
}

/** One customer's khata, newest first, with the bill number for entries that came from a sale. */
export async function listEntries(db: Db, customerId: string, limit: number): Promise<CustomerLedgerEntry[]> {
  const rows = await entriesQuery(db)
    .where("cle.customerId", "=", customerId)
    .orderBy("cle.createdAt", "desc")
    .limit(limit)
    .execute();

  return rows.map(rowToEntry);
}

export async function setCreditLimit(db: Db, customerId: string, creditLimitPaise: number): Promise<void> {
  await db
    .updateTable("customers")
    .set({ creditLimitPaise: Math.max(0, creditLimitPaise) })
    .where("id", "=", customerId)
    .execute();
}
