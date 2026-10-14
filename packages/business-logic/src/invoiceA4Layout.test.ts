import type { InvoiceData, InvoiceItem } from "@pos/types";
import { describe, expect, it } from "vitest";

import { buildA4InvoiceHtml, summariseTaxByRate } from "./invoiceA4Layout.js";

function item(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    lineNo: 1,
    productId: "p1",
    name: "Toor Dal 1kg",
    nameTamil: "துவரம் பருப்பு",
    hsnCode: "0713",
    uom: "pcs",
    qty: 2,
    unitPricePaise: 15000,
    discountPaise: 0,
    taxablePaise: 30000,
    taxRatePercent: 0,
    cgstPaise: 0,
    sgstPaise: 0,
    lineTotalPaise: 30000,
    ...overrides,
  };
}

function invoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  const items = [
    item(),
    item({
      lineNo: 2,
      productId: "p2",
      name: "Sunflower Oil 1L",
      nameTamil: null,
      hsnCode: "1512",
      qty: 1,
      unitPricePaise: 21000,
      taxablePaise: 20000,
      taxRatePercent: 5,
      cgstPaise: 500,
      sgstPaise: 500,
      lineTotalPaise: 21000,
    }),
  ];
  return {
    sale: {
      id: "s1",
      storeId: "st1",
      counterId: "c1",
      billNo: "POS/2026-27/000042",
      clientTxnId: "t1",
      userId: "u1",
      customerId: "cu1",
      status: "completed",
      grossPaise: 51000,
      discountPaise: 0,
      taxablePaise: 50000,
      cgstPaise: 500,
      sgstPaise: 500,
      roundOffPaise: 0,
      netPaise: 51000,
      createdAt: "2026-09-14T10:00:00.000Z",
    },
    items,
    payments: [
      { mode: "cash", amountPaise: 31000, refNo: null },
      { mode: "upi", amountPaise: 20000, refNo: "UPI123" },
    ],
    customer: { name: "Lakshmi Traders", phone: "9840012345", address: "12 Car Street" },
    cashierName: "Ravi",
    store: { name: "Murugan Stores", address: "1 Main Road, Madurai", gstin: "33AAAAA0000A1Z5", stateCode: "33" },
    ...overrides,
  };
}

describe("buildA4InvoiceHtml", () => {
  it("is an A4 GST tax invoice with the store's GSTIN, HSN codes and the CGST/SGST split", () => {
    const html = buildA4InvoiceHtml(invoice(), "english", { duplicate: false });
    expect(html).toContain("size: A4");
    expect(html).toContain("margin: 12mm");
    expect(html).toContain("TAX INVOICE");
    expect(html).toContain("33AAAAA0000A1Z5");
    expect(html).toContain("0713");
    expect(html).toContain("1512");
    expect(html).toContain("POS/2026-27/000042");
    // 5% line: 2.5% + 2.5%, ₹5.00 each.
    expect(html).toContain("2.5% · ₹5.00");
  });

  it("shows the totals stored on the bill, and they add up to the lines", () => {
    const data = invoice();
    const html = buildA4InvoiceHtml(data, "english", { duplicate: false });
    expect(html).toContain("₹510.00");
    expect(data.items.reduce((s, i) => s + i.lineTotalPaise, 0)).toBe(data.sale.netPaise);
    expect(data.items.reduce((s, i) => s + i.taxablePaise, 0)).toBe(data.sale.taxablePaise);
  });

  it("lists every payment with its reference", () => {
    const html = buildA4InvoiceHtml(invoice(), "english", { duplicate: false });
    expect(html).toContain("Cash");
    expect(html).toContain("UPI (UPI123)");
    expect(html).toContain("₹310.00");
    expect(html).toContain("₹200.00");
  });

  it("prints the Tamil name when the receipt language includes Tamil", () => {
    expect(buildA4InvoiceHtml(invoice(), "bilingual", { duplicate: false })).toContain('lang="ta">துவரம் பருப்பு');
    expect(buildA4InvoiceHtml(invoice(), "english", { duplicate: false })).not.toContain("துவரம்");
  });

  it("stamps DUPLICATE COPY only when told to", () => {
    expect(buildA4InvoiceHtml(invoice(), "english", { duplicate: false })).not.toContain("DUPLICATE COPY");
    expect(buildA4InvoiceHtml(invoice(), "english", { duplicate: true })).toContain("DUPLICATE COPY");
  });

  it("escapes every piece of text", () => {
    const html = buildA4InvoiceHtml(
      invoice({
        items: [item({ name: '<img src=x onerror="alert(1)">', hsnCode: "<b>" })],
        customer: { name: "A & B <Co>", phone: null, address: null },
        store: { name: "<script>x</script>", address: null, gstin: null, stateCode: null },
      }),
      "english",
      { duplicate: false },
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("A &amp; B &lt;Co&gt;");
  });

  it("says walk-in when the bill has no customer", () => {
    expect(buildA4InvoiceHtml(invoice({ customer: null }), "english", { duplicate: false })).toContain(
      "Walk-in customer",
    );
  });

  describe("cash tendered / change", () => {
    it("adds no extra rows when the cash leg wasn't overpaid", () => {
      const html = buildA4InvoiceHtml(invoice(), "english", { duplicate: false });
      expect(html).not.toContain("Cash tendered");
      expect(html).not.toContain("Change returned");
      expect(html).not.toContain("Change kept on khata");
    });

    it("adds Cash tendered / Change returned rows after the cash row, for handback", () => {
      const html = buildA4InvoiceHtml(
        invoice({
          payments: [
            { mode: "cash", amountPaise: 31000, refNo: null, tenderedPaise: 35000, changeAction: "handback" },
            { mode: "upi", amountPaise: 20000, refNo: "UPI123" },
          ],
        }),
        "english",
        { duplicate: false },
      );
      expect(html).toContain("Cash tendered");
      expect(html).toContain("₹350.00");
      expect(html).toContain("Change returned");
      expect(html).toContain("₹40.00");
      expect(html).not.toContain("Change kept on khata");
      // The cash row itself still shows the applied amount.
      expect(html).toContain("₹310.00");
    });

    it("says Change kept on khata when changeAction is khata", () => {
      const html = buildA4InvoiceHtml(
        invoice({
          payments: [
            { mode: "cash", amountPaise: 31000, refNo: null, tenderedPaise: 35000, changeAction: "khata" },
            { mode: "upi", amountPaise: 20000, refNo: "UPI123" },
          ],
        }),
        "english",
        { duplicate: false },
      );
      expect(html).toContain("Change kept on khata");
      expect(html).not.toContain("Change returned");
    });
  });
});

describe("summariseTaxByRate", () => {
  it("groups taxable value and tax per rate, lowest rate first", () => {
    const rows = summariseTaxByRate([
      item({ taxRatePercent: 5, taxablePaise: 1000, cgstPaise: 25, sgstPaise: 25 }),
      item({ taxRatePercent: 0, taxablePaise: 500 }),
      item({ taxRatePercent: 5, taxablePaise: 2000, cgstPaise: 50, sgstPaise: 50 }),
    ]);
    expect(rows).toEqual([
      { ratePercent: 0, taxablePaise: 500, cgstPaise: 0, sgstPaise: 0 },
      { ratePercent: 5, taxablePaise: 3000, cgstPaise: 75, sgstPaise: 75 },
    ]);
  });
});
