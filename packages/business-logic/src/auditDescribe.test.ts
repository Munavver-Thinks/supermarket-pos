import { describe, expect, it } from "vitest";

import { auditActionLabel, describeAuditEntry } from "./auditDescribe.js";

describe("auditActionLabel", () => {
  it("names known actions in shop language", () => {
    expect(auditActionLabel("cash_session_closed")).toBe("Register closed");
  });

  it("falls back to a readable form for actions it doesn't know", () => {
    expect(auditActionLabel("supplier_merged")).toBe("supplier merged");
  });
});

describe("describeAuditEntry", () => {
  it("summarises a bill with its discount and how it was paid", () => {
    expect(
      describeAuditEntry({
        action: "sale_created",
        oldValue: null,
        newValue: {
          billNo: "POS/2026-27/000012",
          netPaise: 45000,
          discountPaise: 2500,
          payments: [
            { mode: "cash", amountPaise: 20000 },
            { mode: "upi", amountPaise: 25000 },
          ],
        },
      }),
    ).toBe("POS/2026-27/000012 · ₹450.00 · ₹25.00 discount · cash + upi");
  });

  it("leaves out a zero discount", () => {
    expect(
      describeAuditEntry({ action: "sale_created", oldValue: null, newValue: { billNo: "B1", netPaise: 100 } }),
    ).toBe("B1 · ₹1.00");
  });

  it("shows a stock correction as before and after", () => {
    expect(
      describeAuditEntry({ action: "stock_adjustment", oldValue: { qtyOnHand: 10 }, newValue: { qtyOnHand: 7 } }),
    ).toBe("10 → 7");
  });

  it("shows a cost change in rupees, degrading gracefully for an old audit row without the averaging fields", () => {
    expect(
      describeAuditEntry({
        action: "cost_price_changed",
        oldValue: { costPricePaise: 7000 },
        newValue: { costPricePaise: 8000 },
      }),
    ).toBe("₹70.00 → ₹80.00");
  });

  it("shows a cost change from a receipt with the received cost and stock it was averaged against", () => {
    expect(
      describeAuditEntry({
        action: "cost_price_changed",
        oldValue: { costPricePaise: 4000 },
        newValue: { costPricePaise: 4500, receivedCostPaise: 5000, qtyOnHandBefore: 10, qtyReceived: 10 },
      }),
    ).toBe("₹40.00 → ₹45.00 · new stock at ₹50.00 averaged with 10 on hand");
  });

  it("shows an MRP change from a receipt, with the selling price lowered along with it", () => {
    expect(
      describeAuditEntry({
        action: "mrp_changed",
        oldValue: { mrpPaise: 3500, salePricePaise: 3200, wholesalePricePaise: 3000 },
        newValue: { mrpPaise: 4000, salePricePaise: 3200, wholesalePricePaise: 3000, qtyReceived: 10 },
      }),
    ).toBe("₹35.00 → ₹40.00 · from new stock");
  });

  it("notes the selling and wholesale price being lowered when the new MRP undercuts them", () => {
    expect(
      describeAuditEntry({
        action: "mrp_changed",
        oldValue: { mrpPaise: 4000, salePricePaise: 3800, wholesalePricePaise: 3600 },
        newValue: { mrpPaise: 3500, salePricePaise: 3500, wholesalePricePaise: 3500, qtyReceived: 5 },
      }),
    ).toBe("₹40.00 → ₹35.00 · from new stock · selling price lowered to ₹35.00 · wholesale price lowered to ₹35.00");
  });

  it("degrades gracefully for an MRP-changed row missing the newer fields", () => {
    expect(
      describeAuditEntry({ action: "mrp_changed", oldValue: { mrpPaise: 3500 }, newValue: { mrpPaise: 4000 } }),
    ).toBe("₹35.00 → ₹40.00 · from new stock");
  });

  it("says whether a drawer was short or over", () => {
    expect(
      describeAuditEntry({
        action: "cash_session_closed",
        oldValue: null,
        newValue: { countedCashPaise: 95000, variancePaise: -5000 },
      }),
    ).toBe("Counted ₹950.00 · short by ₹50.00");
    expect(
      describeAuditEntry({
        action: "cash_session_closed",
        oldValue: null,
        newValue: { countedCashPaise: 100000, variancePaise: 0 },
      }),
    ).toBe("Counted ₹1,000.00 · matched");
  });

  it("describes a khata refund on a return", () => {
    expect(
      describeAuditEntry({
        action: "sale_return",
        oldValue: null,
        newValue: { returnNo: "R1", billNo: "B9", refundPaise: 5000, refundMode: "credit" },
      }),
    ).toBe("R1 · against B9 · refunded ₹50.00 · to khata");
  });

  it("describes an exchange return whose whole refund was set against the new bill", () => {
    expect(
      describeAuditEntry({
        action: "sale_return",
        oldValue: null,
        newValue: {
          returnNo: "R2",
          billNo: "B9",
          refundPaise: 5000,
          refundMode: "exchange",
          exchangeBillNo: "B10",
          exchangePaise: 5000,
        },
      }),
    ).toBe("R2 · against B9 · refunded ₹50.00 · set against bill B10");
  });

  it("describes a partial exchange: some paid out, the rest set against the new bill", () => {
    expect(
      describeAuditEntry({
        action: "sale_return",
        oldValue: null,
        newValue: {
          returnNo: "R3",
          billNo: "B9",
          refundPaise: 8000,
          refundMode: "cash",
          exchangeBillNo: "B11",
          exchangePaise: 3000,
        },
      }),
    ).toBe("R3 · against B9 · refunded ₹80.00 · in cash · ₹30.00 on bill B11");
  });

  it("notes a bill that set off a linked return", () => {
    expect(
      describeAuditEntry({
        action: "sale_created",
        oldValue: null,
        newValue: { billNo: "B10", netPaise: 45000, exchangeReturnNo: "R2", exchangeRefundPaise: 5000, exchangePaise: 5000 },
      }),
    ).toBe("B10 · ₹450.00 · return ₹50.00 set off");
  });

  it("names suppliers actions in shop language", () => {
    expect(auditActionLabel("supplier_created")).toBe("Supplier added");
    expect(auditActionLabel("supplier_updated")).toBe("Supplier edited");
    expect(auditActionLabel("supplier_deactivated")).toBe("Supplier deactivated");
    expect(auditActionLabel("supplier_reactivated")).toBe("Supplier reactivated");
    expect(auditActionLabel("backup_restored")).toBe("Backup restored");
  });

  it("names customer actions in shop language", () => {
    expect(auditActionLabel("customer_created")).toBe("Customer added");
    expect(auditActionLabel("customer_updated")).toBe("Customer edited");
  });

  it("describes a new customer by name and phone", () => {
    expect(
      describeAuditEntry({
        action: "customer_created",
        oldValue: null,
        newValue: { name: "Lakshmi", phone: "9840012345", address: null },
      }),
    ).toBe("Lakshmi · 9840012345");
  });

  it("describes a customer edit by the fields that changed", () => {
    expect(
      describeAuditEntry({
        action: "customer_updated",
        oldValue: { name: "Lakshmi", phone: null, address: "12 Car St" },
        newValue: { name: "Lakshmi R", phone: "9840012345", address: "4 Temple St" },
      }),
    ).toBe("Lakshmi R · name Lakshmi → Lakshmi R · phone added · address 12 Car St → 4 Temple St");
  });

  it("does not repeat a customer name that was only kept for context", () => {
    expect(
      describeAuditEntry({
        action: "customer_updated",
        oldValue: { name: "Lakshmi", phone: null },
        newValue: { name: "Lakshmi", phone: "9840012345" },
      }),
    ).toBe("Lakshmi · phone added");
  });

  it("describes a new supplier by name, phone and GSTIN", () => {
    expect(
      describeAuditEntry({
        action: "supplier_created",
        oldValue: null,
        newValue: { name: "Madurai Traders", phone: "9840012345", gstin: "33AAAAA0000A1Z5", email: null },
      }),
    ).toBe("Madurai Traders · 9840012345 · GSTIN 33AAAAA0000A1Z5");
  });

  it("describes a supplier edit by the fields that changed", () => {
    expect(
      describeAuditEntry({
        action: "supplier_updated",
        oldValue: { name: "Madurai Traders", phone: "9840012345", gstin: null, notes: "Tuesdays" },
        newValue: { name: "Madurai Traders & Co", phone: "9940012345", gstin: "33AAAAA0000A1Z5", notes: null },
      }),
    ).toBe(
      "Madurai Traders & Co · name Madurai Traders → Madurai Traders & Co · phone 9840012345 → 9940012345 · GSTIN added · notes removed",
    );
  });

  it("does not repeat a supplier name that was only kept for context", () => {
    expect(
      describeAuditEntry({
        action: "supplier_updated",
        oldValue: { name: "Madurai Traders", email: null },
        newValue: { name: "Madurai Traders", email: "mt@example.com" },
      }),
    ).toBe("Madurai Traders · email added");
  });

  it("names the supplier that was deactivated or reactivated", () => {
    expect(
      describeAuditEntry({
        action: "supplier_deactivated",
        oldValue: { name: "Madurai Traders", isActive: true },
        newValue: { name: "Madurai Traders", isActive: false },
      }),
    ).toBe("Madurai Traders");
    expect(describeAuditEntry({ action: "supplier_reactivated", oldValue: null, newValue: null })).toBe("");
  });

  it("describes a restore with the backup used and where the replaced data went", () => {
    const newValue = {
      backupName: "pos-2026-09-01T09-00-00Z.db",
      safetyCopyName: "pos-replaced-1789000000000.db",
      actorName: "Owner",
      actorInRestoredDb: true,
    };
    expect(describeAuditEntry({ action: "backup_restored", oldValue: null, newValue })).toBe(
      "From pos-2026-09-01T09-00-00Z.db · previous data kept as pos-replaced-1789000000000.db",
    );
  });

  it("names who restored when their account is not in the restored data", () => {
    expect(
      describeAuditEntry({
        action: "backup_restored",
        oldValue: null,
        newValue: { backupName: "pos-a.db", safetyCopyName: null, actorName: "Priya", actorInRestoredDb: false },
      }),
    ).toBe("From pos-a.db · by Priya");
  });

  it("degrades to a shorter line for missing or malformed values instead of printing undefined", () => {
    expect(describeAuditEntry({ action: "supplier_updated", oldValue: "junk", newValue: 42 })).toBe("");
    expect(describeAuditEntry({ action: "backup_restored", oldValue: null, newValue: null })).toBe("");
    expect(describeAuditEntry({ action: "sale_created", oldValue: null, newValue: null })).toBe("");
    expect(describeAuditEntry({ action: "stock_adjustment", oldValue: "garbage", newValue: { qtyOnHand: "7" } })).toBe(
      "",
    );
    expect(describeAuditEntry({ action: "unknown_thing", oldValue: null, newValue: { a: 1 } })).toBe("");
  });

  // ---- DEV1: approvals, reprints, staff ----

  it("describes a refused approval without any password", () => {
    expect(auditActionLabel("approval_refused")).toBe("Approval refused");
    expect(
      describeAuditEntry({
        action: "approval_refused",
        oldValue: null,
        newValue: { action: "sale_return", approverUsername: "ravi", lockedOut: false },
      }),
    ).toBe('For a return · approver "ravi" · details not accepted');
    expect(
      describeAuditEntry({
        action: "approval_refused",
        oldValue: null,
        newValue: { action: "stock_adjustment", approverUsername: "ravi", lockedOut: true },
      }),
    ).toBe('For a stock correction · approver "ravi" · too many attempts');
  });

  it("describes a below-cost discount approval with the bill number", () => {
    expect(auditActionLabel("below_cost_discount_approved")).toBe("Below-cost discount approved");
    expect(
      describeAuditEntry({
        action: "below_cost_discount_approved",
        oldValue: null,
        newValue: { billNo: "POS/2026-27/000003", discountPaise: 5000, approvedByUserId: "m" },
      }),
    ).toBe("POS/2026-27/000003 · ₹50.00 discount");
  });

  it("describes a reprint with its format", () => {
    expect(auditActionLabel("receipt_reprinted")).toBe("Bill reprinted");
    expect(
      describeAuditEntry({
        action: "receipt_reprinted",
        oldValue: null,
        newValue: { billNo: "POS/2026-27/000003", format: "a4" },
      }),
    ).toBe("POS/2026-27/000003 · as A4 invoice");
    expect(
      describeAuditEntry({ action: "receipt_reprinted", oldValue: null, newValue: { billNo: "B1", format: "receipt" } }),
    ).toBe("B1 · as receipt");
  });

  it("describes employee edits, status changes and password events", () => {
    expect(
      describeAuditEntry({
        action: "employee_updated",
        oldValue: { displayName: "Priya S", role: "cashier" },
        newValue: { displayName: "Priya", role: "inventory_staff" },
      }),
    ).toBe("Priya · name Priya S → Priya · role cashier → inventory staff");
    expect(
      describeAuditEntry({
        action: "employee_updated",
        oldValue: { displayName: "Priya", role: "cashier" },
        newValue: { displayName: "Priya", role: "manager" },
      }),
    ).toBe("Priya · role cashier → manager");
    expect(
      describeAuditEntry({ action: "employee_deactivated", oldValue: null, newValue: { displayName: "Ravi" } }),
    ).toBe("Ravi");
    expect(describeAuditEntry({ action: "password_reset", oldValue: null, newValue: { displayName: "Ravi" } })).toBe(
      "for Ravi",
    );
    expect(describeAuditEntry({ action: "password_changed", oldValue: null, newValue: null })).toBe("");
    for (const action of ["employee_updated", "employee_deactivated", "employee_reactivated", "password_reset"]) {
      expect(auditActionLabel(action)).not.toBe(action.replace(/_/g, " "));
    }
  });

  // ---- DEV2: batches, purchase orders, products ----

  it("labels every batch, purchase-order and product action", () => {
    expect(auditActionLabel("batch_written_off")).toBe("Expired stock written off");
    expect(auditActionLabel("goods_received")).toBe("Goods received");
    expect(auditActionLabel("product_price_changed")).toBe("Price changed");
    for (const action of [
      "purchase_order_created",
      "purchase_order_updated",
      "purchase_order_placed",
      "purchase_order_cancelled",
      "product_updated",
      "product_deactivated",
      "product_reactivated",
    ]) {
      expect(auditActionLabel(action)).not.toBe(action.replace(/_/g, " "));
    }
  });

  it("describes a batch write-off with the stock before and after", () => {
    expect(
      describeAuditEntry({
        action: "batch_written_off",
        oldValue: { qtyRemaining: 4 },
        newValue: { batchNo: "B12", expiryDate: "2026-09-10", qty: 4, qtyOnHandBefore: 10, qtyOnHandAfter: 6 },
      }),
    ).toBe("Batch B12 · expired 2026-09-10 · 4 taken off · 10 → 6");
  });

  it("describes purchase-order steps", () => {
    expect(
      describeAuditEntry({
        action: "purchase_order_created",
        oldValue: null,
        newValue: { poNo: "PO/2026-27/000001", lineCount: 2, totalPaise: 220000 },
      }),
    ).toBe("PO/2026-27/000001 · 2 items · ₹2,200.00");
    expect(
      describeAuditEntry({
        action: "purchase_order_cancelled",
        oldValue: { status: "partially_received" },
        newValue: { poNo: "PO/1", status: "closed" },
      }),
    ).toBe("PO/1 · closed after part delivery");
    expect(
      describeAuditEntry({
        action: "goods_received",
        oldValue: null,
        newValue: { poNo: "PO/1", invoiceNo: "INV-7", totalPaise: 84000, status: "partially_received" },
      }),
    ).toBe("PO/1 · Invoice INV-7 · ₹840.00 · part received");
    expect(
      describeAuditEntry({ action: "goods_received", oldValue: null, newValue: { poNo: "PO/1", status: "received" } }),
    ).toBe("PO/1 · fully received");
  });

  it("describes a product edit by the fields that changed", () => {
    expect(
      describeAuditEntry({
        action: "product_updated",
        oldValue: { name: "Toor Dal 1kg", nameTamil: null, taxRatePercent: 0, barcodes: ["1"] },
        newValue: { name: "Toor Dal", nameTamil: "துவரம் பருப்பு", taxRatePercent: 5, barcodes: ["1", "2"] },
      }),
    ).toBe("Toor Dal · name Toor Dal 1kg → Toor Dal · Tamil name added · GST % 0 → 5 · barcodes changed");
  });

  it("describes a price change with only the prices that moved", () => {
    expect(
      describeAuditEntry({
        action: "product_price_changed",
        oldValue: { mrpPaise: 5000, salePricePaise: 4800, costPricePaise: 4000, isTaxInclusive: true },
        newValue: { name: "Sugar", mrpPaise: 5000, salePricePaise: 5000, costPricePaise: 4000, isTaxInclusive: true },
      }),
    ).toBe("Sugar · Sale ₹48.00 → ₹50.00");
    expect(
      describeAuditEntry({ action: "product_deactivated", oldValue: { name: "Sugar" }, newValue: null }),
    ).toBe("Sugar");
    expect(describeAuditEntry({ action: "product_price_changed", oldValue: "junk", newValue: 3 })).toBe("");
  });

  it("describes label prints and assigned barcodes", () => {
    expect(auditActionLabel("labels_printed")).toBe("Labels printed");
    expect(auditActionLabel("barcode_assigned")).toBe("Barcode assigned");
    expect(
      describeAuditEntry({
        action: "labels_printed",
        oldValue: null,
        newValue: { productName: "Sugar 1kg", count: 10, barcode: "20000001", packedOn: "2026-10-07", expiryDate: null },
      }),
    ).toBe("10 labels · Sugar 1kg · PKD 10-26");
    expect(
      describeAuditEntry({
        action: "labels_printed",
        oldValue: null,
        newValue: { productName: "Sugar 1kg", count: 1, batchNo: "RP-20261007-1" },
      }),
    ).toBe("1 label · Sugar 1kg · batch RP-20261007-1");
    expect(
      describeAuditEntry({
        action: "barcode_assigned",
        oldValue: null,
        newValue: { barcode: "20000001", productName: "Sugar 1kg" },
      }),
    ).toBe("Barcode 20000001 assigned to Sugar 1kg");
    expect(describeAuditEntry({ action: "barcode_assigned", oldValue: null, newValue: null })).toBe("");
  });

  it("adds batch, packed and best-before dates to a repack when present", () => {
    expect(
      describeAuditEntry({
        action: "stock_repacked",
        oldValue: null,
        newValue: {
          parentName: "Sugar 50kg",
          childName: "Sugar 1kg",
          childQtyMade: 10,
          batchNo: "RP-20261007-1",
          packedOn: "2026-10-07",
          expiryDate: "2027-01-07",
        },
      }),
    ).toBe("from Sugar 50kg · made 10 Sugar 1kg · batch RP-20261007-1 · packed 2026-10-07 · best before 2027-01-07");
    expect(
      describeAuditEntry({
        action: "stock_repacked",
        oldValue: null,
        newValue: { parentName: "Sugar 50kg", childName: "Sugar 1kg", childQtyMade: 10 },
      }),
    ).toBe("from Sugar 50kg · made 10 Sugar 1kg");
  });
});
