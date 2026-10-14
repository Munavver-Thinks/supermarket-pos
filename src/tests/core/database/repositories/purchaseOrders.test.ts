import { randomUUID } from "node:crypto";

import { computePurchaseTotals } from "@pos/business-logic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/core/database/connection.js";
import { runMigrations } from "@/core/database/migrator.js";
import { listAuditLog } from "@/core/database/repositories/auditLog.js";
import { getStock } from "@/core/database/repositories/inventory.js";
import { createProduct } from "@/core/database/repositories/productsAdmin.js";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  placePurchaseOrder,
  PurchaseOrderError,
  receivePurchaseOrder,
  updatePurchaseOrder,
  type PurchaseOrderActor,
} from "@/core/database/repositories/purchaseOrders.js";
import { createPurchase, DuplicatePurchaseInvoiceError } from "@/core/database/repositories/purchases.js";
import { seedFirstRun } from "@/core/database/repositories/seed.js";
import { listForProduct } from "@/core/database/repositories/stockBatches.js";
import { createSupplier } from "@/core/database/repositories/suppliers.js";

describe("purchase orders", () => {
  let db: Db;
  let actor: PurchaseOrderActor;
  let supplierId: string;
  let dal: string;
  let oil: string;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedFirstRun(db, {
      organizationName: "Test Org",
      storeName: "Test Store",
      deviceName: "Register 1",
      ownerUsername: "owner",
      ownerPasswordHash: "hash",
      ownerDisplayName: "Owner",
    });
    actor = { storeId: seed.storeId, userId: seed.ownerUserId, deviceId: "device-1" };
    supplierId = (
      await createSupplier(db, seed.storeId, {
        name: "Balaji",
        phone: null,
        email: null,
        address: null,
        gstin: null,
        notes: null,
      })
    ).id;
    dal = await product("Toor Dal");
    oil = await product("Groundnut Oil");
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function product(name: string): Promise<string> {
    return createProduct(db, {
      storeId: actor.storeId,
      name,
      nameTamil: null,
      shortCode: null,
      uom: "pcs",
      isWeighted: false,
      hsnCode: null,
      taxRatePercent: 0,
      barcodes: [],
      aliases: [],
      mrpPaise: 20000,
      salePricePaise: 18000,
      costPricePaise: 14000,
      isTaxInclusive: true,
    });
  }

  async function newOrder() {
    return createPurchaseOrder(
      db,
      {
        supplierId,
        expectedDate: "2026-09-20",
        notes: null,
        totalPaise: 10 * 14000 + 4 * 20000,
        lines: [
          { productId: dal, qtyOrdered: 10, costPricePaise: 14000, taxRatePercent: 0, isTaxInclusive: false },
          { productId: oil, qtyOrdered: 4, costPricePaise: 20000, taxRatePercent: 0, isTaxInclusive: false },
        ],
      },
      actor,
    );
  }

  async function itemIds(poId: string): Promise<Record<string, string>> {
    const detail = await getPurchaseOrder(db, poId);
    return Object.fromEntries((detail?.items ?? []).map((i) => [i.productId, i.id]));
  }

  function receipt(
    poId: string,
    lines: Array<{ poItemId: string; productId: string; qty: number; expiryDate?: string }>,
    invoiceNo: string,
    clientTxnId = randomUUID(),
  ) {
    const computed = computePurchaseTotals(
      lines.map((l) => ({
        productId: l.productId,
        qty: l.qty,
        costPricePaise: 14000,
        taxRatePercent: 0,
        isTaxInclusive: false,
        expiryDate: l.expiryDate,
      })),
    );
    return {
      poId,
      clientTxnId,
      invoiceNo,
      invoiceDate: "2026-09-16",
      notes: null,
      updateCostPrice: false,
      lines: lines.map((l, i) => ({ poItemId: l.poItemId, line: computed.lines[i]! })),
      totals: computed.totals,
    };
  }

  it("runs the full cycle: draft, placed, part received, received", async () => {
    const order = await newOrder();
    expect(order.status).toBe("draft");
    expect(order.poNo).toMatch(/^PO\/\d{4}-\d{2}\/000001$/);
    // Ordering moves no stock.
    expect(await getStock(db, actor.storeId, dal)).toBe(0);

    const placed = await placePurchaseOrder(db, order.id, actor);
    expect(placed.status).toBe("ordered");
    expect(placed.orderedAt).not.toBeNull();

    const ids = await itemIds(order.id);
    const first = await receivePurchaseOrder(
      db,
      receipt(order.id, [{ poItemId: ids[dal]!, productId: dal, qty: 6, expiryDate: "2026-12-01" }], "INV-1"),
      actor,
    );
    expect(first.alreadyExisted).toBe(false);
    expect(first.order.status).toBe("partially_received");
    expect(first.purchase.purchaseOrderId).toBe(order.id);
    expect(await getStock(db, actor.storeId, dal)).toBe(6);
    expect((await listForProduct(db, actor.storeId, dal))[0]?.qtyRemaining).toBe(6);

    const second = await receivePurchaseOrder(
      db,
      receipt(
        order.id,
        [
          { poItemId: ids[dal]!, productId: dal, qty: 4 },
          { poItemId: ids[oil]!, productId: oil, qty: 4 },
        ],
        "INV-2",
      ),
      actor,
    );
    expect(second.order.status).toBe("received");
    expect(second.order.closedAt).not.toBeNull();
    expect(await getStock(db, actor.storeId, dal)).toBe(10);
    expect(await getStock(db, actor.storeId, oil)).toBe(4);

    const detail = await getPurchaseOrder(db, order.id);
    expect(detail?.receipts.map((r) => r.invoiceNo)).toEqual(["INV-1", "INV-2"]);
    expect(detail?.items.every((i) => i.qtyRemaining === 0)).toBe(true);

    const listed = await listPurchaseOrders(db, actor.storeId, { limit: 10 });
    expect(listed[0]).toMatchObject({ supplierName: "Balaji", itemCount: 2, status: "received" });
    expect(listed[0]?.receivedPaise).toBe(first.purchase.totalPaise + second.purchase.totalPaise);

    // Both kinds of audit entry, plus the ordinary goods-in entry per receipt.
    expect(await listAuditLog(db, actor.storeId, { limit: 10, action: "goods_received" })).toHaveLength(2);
    expect(await listAuditLog(db, actor.storeId, { limit: 10, action: "purchase_received" })).toHaveLength(2);
    expect(await listAuditLog(db, actor.storeId, { limit: 10, action: "purchase_order_created" })).toHaveLength(1);
    expect(await listAuditLog(db, actor.storeId, { limit: 10, action: "purchase_order_placed" })).toHaveLength(1);
    const [goods] = await listAuditLog(db, actor.storeId, { limit: 1, action: "goods_received" });
    expect(goods?.newValue).toMatchObject({ poNo: order.poNo, invoiceNo: "INV-2", lineCount: 2, status: "received" });
  });

  it("refuses to receive more than remains", async () => {
    const order = await newOrder();
    await placePurchaseOrder(db, order.id, actor);
    const ids = await itemIds(order.id);

    await expect(
      receivePurchaseOrder(db, receipt(order.id, [{ poItemId: ids[dal]!, productId: dal, qty: 11 }], "INV-1"), actor),
    ).rejects.toThrow(PurchaseOrderError);
    // Two lines for the same item count together.
    await expect(
      receivePurchaseOrder(
        db,
        receipt(
          order.id,
          [
            { poItemId: ids[dal]!, productId: dal, qty: 6 },
            { poItemId: ids[dal]!, productId: dal, qty: 6 },
          ],
          "INV-1",
        ),
        actor,
      ),
    ).rejects.toThrow(PurchaseOrderError);
    expect(await getStock(db, actor.storeId, dal)).toBe(0);
  });

  it("refuses to receive against a draft, or without an invoice number", async () => {
    const order = await newOrder();
    const ids = await itemIds(order.id);
    await expect(
      receivePurchaseOrder(db, receipt(order.id, [{ poItemId: ids[dal]!, productId: dal, qty: 1 }], "INV-1"), actor),
    ).rejects.toThrow("Place this purchase order before receiving goods against it.");

    await placePurchaseOrder(db, order.id, actor);
    await expect(
      receivePurchaseOrder(db, receipt(order.id, [{ poItemId: ids[dal]!, productId: dal, qty: 1 }], "  "), actor),
    ).rejects.toThrow("Enter the supplier's invoice number.");
    expect(await getStock(db, actor.storeId, dal)).toBe(0);
  });

  it("refuses an item from another order, or a product that doesn't match", async () => {
    const order = await newOrder();
    const other = await newOrder();
    await placePurchaseOrder(db, order.id, actor);
    const otherIds = await itemIds(other.id);
    const ids = await itemIds(order.id);

    await expect(
      receivePurchaseOrder(db, receipt(order.id, [{ poItemId: otherIds[dal]!, productId: dal, qty: 1 }], "INV-1"), actor),
    ).rejects.toThrow("An item received is not on this purchase order.");
    await expect(
      receivePurchaseOrder(db, receipt(order.id, [{ poItemId: ids[dal]!, productId: oil, qty: 1 }], "INV-1"), actor),
    ).rejects.toThrow("An item received does not match the product ordered.");
  });

  it("rolls everything back when the invoice number is already on file", async () => {
    const { lines, totals } = computePurchaseTotals([
      { productId: dal, qty: 1, costPricePaise: 14000, taxRatePercent: 0, isTaxInclusive: false },
    ]);
    await createPurchase(db, {
      storeId: actor.storeId,
      supplierId,
      invoiceNo: "INV-DUP",
      invoiceDate: "2026-09-16",
      notes: null,
      userId: actor.userId,
      lines,
      totals,
      updateCostPrice: false,
    });

    const order = await newOrder();
    await placePurchaseOrder(db, order.id, actor);
    const ids = await itemIds(order.id);
    await expect(
      receivePurchaseOrder(db, receipt(order.id, [{ poItemId: ids[dal]!, productId: dal, qty: 5 }], "INV-DUP"), actor),
    ).rejects.toThrow(DuplicatePurchaseInvoiceError);

    const detail = await getPurchaseOrder(db, order.id);
    expect(detail?.order.status).toBe("ordered");
    expect(detail?.items.find((i) => i.productId === dal)?.qtyReceived).toBe(0);
    expect(await getStock(db, actor.storeId, dal)).toBe(1);
    expect(await listAuditLog(db, actor.storeId, { limit: 10, action: "goods_received" })).toHaveLength(0);
  });

  it("raises stock once when the same receipt is sent twice", async () => {
    const order = await newOrder();
    await placePurchaseOrder(db, order.id, actor);
    const ids = await itemIds(order.id);
    const request = receipt(order.id, [{ poItemId: ids[dal]!, productId: dal, qty: 3 }], "INV-1");

    const first = await receivePurchaseOrder(db, request, actor);
    const again = await receivePurchaseOrder(db, request, actor);

    expect(again.alreadyExisted).toBe(true);
    expect(again.purchase.id).toBe(first.purchase.id);
    expect(await getStock(db, actor.storeId, dal)).toBe(3);
    expect((await getPurchaseOrder(db, order.id))?.items.find((i) => i.productId === dal)?.qtyReceived).toBe(3);
  });

  it("cancels an unreceived order and closes a part-received one", async () => {
    const draft = await newOrder();
    expect((await cancelPurchaseOrder(db, draft.id, "Not needed", actor)).status).toBe("cancelled");
    await expect(cancelPurchaseOrder(db, draft.id, null, actor)).rejects.toThrow(PurchaseOrderError);
    await expect(placePurchaseOrder(db, draft.id, actor)).rejects.toThrow(PurchaseOrderError);

    const ordered = await newOrder();
    await placePurchaseOrder(db, ordered.id, actor);
    expect((await cancelPurchaseOrder(db, ordered.id, null, actor)).status).toBe("cancelled");

    const partial = await newOrder();
    await placePurchaseOrder(db, partial.id, actor);
    const ids = await itemIds(partial.id);
    await receivePurchaseOrder(db, receipt(partial.id, [{ poItemId: ids[dal]!, productId: dal, qty: 2 }], "INV-9"), actor);
    const closed = await cancelPurchaseOrder(db, partial.id, "Supplier out of oil", actor);
    expect(closed.status).toBe("closed");
    await expect(
      receivePurchaseOrder(db, receipt(partial.id, [{ poItemId: ids[dal]!, productId: dal, qty: 1 }], "INV-10"), actor),
    ).rejects.toThrow("This purchase order is already finished.");

    const entries = await listAuditLog(db, actor.storeId, { limit: 10, action: "purchase_order_cancelled" });
    expect(entries.map((e) => (e.newValue as { status: string }).status).sort()).toEqual([
      "cancelled",
      "cancelled",
      "closed",
    ]);
  });

  it("edits only a draft, replacing its lines", async () => {
    const order = await newOrder();
    const updated = await updatePurchaseOrder(
      db,
      order.id,
      {
        expectedDate: null,
        notes: "Call before delivery",
        totalPaise: 14000,
        lines: [{ productId: dal, qtyOrdered: 1, costPricePaise: 14000, taxRatePercent: 0, isTaxInclusive: false }],
      },
      actor,
    );
    expect(updated.notes).toBe("Call before delivery");
    expect((await getPurchaseOrder(db, order.id))?.items).toHaveLength(1);
    const [entry] = await listAuditLog(db, actor.storeId, { limit: 1, action: "purchase_order_updated" });
    expect(entry?.oldValue).toMatchObject({ lineCount: 2 });
    expect(entry?.newValue).toMatchObject({ lineCount: 1, totalPaise: 14000 });

    await placePurchaseOrder(db, order.id, actor);
    await expect(
      updatePurchaseOrder(db, order.id, { expectedDate: null, notes: null, totalPaise: 0, lines: [] }, actor),
    ).rejects.toThrow("Only a draft purchase order can be edited.");
  });

  it("refuses another store's order and a product from another store", async () => {
    const order = await newOrder();
    const stranger = { ...actor, storeId: randomUUID() };
    await expect(placePurchaseOrder(db, order.id, stranger)).rejects.toThrow("That purchase order could not be found.");
    await expect(
      createPurchaseOrder(
        db,
        {
          supplierId,
          expectedDate: null,
          notes: null,
          totalPaise: 0,
          lines: [{ productId: randomUUID(), qtyOrdered: 1, costPricePaise: 0, taxRatePercent: 0, isTaxInclusive: false }],
        },
        actor,
      ),
    ).rejects.toThrow("A product on this order could not be found.");
  });

  it("filters the list by status", async () => {
    const a = await newOrder();
    await newOrder();
    await placePurchaseOrder(db, a.id, actor);
    expect(await listPurchaseOrders(db, actor.storeId, { status: "ordered", limit: 10 })).toHaveLength(1);
    expect(await listPurchaseOrders(db, actor.storeId, { status: "draft", limit: 10 })).toHaveLength(1);
    expect(await listPurchaseOrders(db, actor.storeId, { limit: 10 })).toHaveLength(2);
  });
});
