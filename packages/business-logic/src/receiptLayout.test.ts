import type { ExchangeReturnSummary, Sale, SaleItem } from "@pos/types";
import { describe, expect, it } from "vitest";

import {
  buildReceiptHtml,
  buildReceiptLines,
  DEFAULT_RECEIPT_LANGUAGE,
  escapeHtml,
  parseReceiptLanguage,
  receiptNameLines,
  RECEIPT_FONT_STACK,
  type ReceiptData,
} from "./receiptLayout.js";

const sale: Sale = {
  id: "s1",
  storeId: "st1",
  counterId: "c1",
  billNo: "A-0001",
  clientTxnId: "t1",
  userId: "u1",
  customerId: null,
  status: "completed" as Sale["status"],
  grossPaise: 15000,
  discountPaise: 0,
  taxablePaise: 14286,
  cgstPaise: 357,
  sgstPaise: 357,
  roundOffPaise: 0,
  netPaise: 15000,
  createdAt: "2026-09-14T10:00:00.000Z",
};

function item(overrides: Partial<SaleItem> = {}): SaleItem {
  return {
    id: "i1",
    saleId: "s1",
    lineNo: 1,
    productId: "p1",
    qty: 2,
    unitPricePaise: 4500,
    discountPaise: 0,
    taxablePaise: 9000,
    taxRatePercent: 5,
    cgstPaise: 0,
    sgstPaise: 0,
    lineTotalPaise: 9000,
    ...overrides,
  };
}

const RICE_TA = "பொன்னி அரிசி";

function data(items: ReceiptData["items"], storeName = "Murugan Stores"): ReceiptData {
  return { storeName, storeAddress: null, storeGstin: null, sale, items };
}

describe("parseReceiptLanguage", () => {
  it("reads each known language", () => {
    expect(parseReceiptLanguage("english")).toBe("english");
    expect(parseReceiptLanguage("bilingual")).toBe("bilingual");
    expect(parseReceiptLanguage("tamil_first")).toBe("tamil_first");
  });

  it("falls back to bilingual for missing or unknown values", () => {
    expect(DEFAULT_RECEIPT_LANGUAGE).toBe("bilingual");
    expect(parseReceiptLanguage(undefined)).toBe("bilingual");
    expect(parseReceiptLanguage(null)).toBe("bilingual");
    expect(parseReceiptLanguage("Tamil")).toBe("bilingual");
  });
});

describe("receiptNameLines", () => {
  it("puts Tamil beneath English when bilingual", () => {
    expect(receiptNameLines("Ponni Rice", RICE_TA, "bilingual")).toEqual([
      { text: "Ponni Rice", lang: "en" },
      { text: RICE_TA, lang: "ta" },
    ]);
  });

  it("puts Tamil first when tamil_first", () => {
    expect(receiptNameLines("Ponni Rice", RICE_TA, "tamil_first")).toEqual([
      { text: RICE_TA, lang: "ta" },
      { text: "Ponni Rice", lang: "en" },
    ]);
  });

  it("drops Tamil when english only", () => {
    expect(receiptNameLines("Ponni Rice", RICE_TA, "english")).toEqual([{ text: "Ponni Rice", lang: "en" }]);
  });

  it("prints English only when the Tamil name is missing or blank, in every mode", () => {
    for (const lang of ["english", "bilingual", "tamil_first"] as const) {
      for (const missing of [null, undefined, "", "   "]) {
        expect(receiptNameLines("Soap", missing, lang)).toEqual([{ text: "Soap", lang: "en" }]);
      }
    }
  });

  it("trims stray whitespace around a Tamil name", () => {
    expect(receiptNameLines("Rice", `  ${RICE_TA} `, "bilingual")[1]?.text).toBe(RICE_TA);
  });
});

describe("buildReceiptLines", () => {
  it("formats money and trims float drift in weighed quantities", () => {
    const [line] = buildReceiptLines(
      [{ item: item({ qty: 0.1 + 0.2, unitPricePaise: 6000, lineTotalPaise: 1800 }), productName: "Onion", productNameTamil: null }],
      "bilingual",
    );
    expect(line).toEqual({ names: [{ text: "Onion", lang: "en" }], qty: "0.3", rate: "₹60.00", amount: "₹18.00" });
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`Tom & Jerry <b>"x"</b> 'y'`)).toBe("Tom &amp; Jerry &lt;b&gt;&quot;x&quot;&lt;/b&gt; &#39;y&#39;");
  });

  it("leaves Tamil untouched", () => {
    expect(escapeHtml(RICE_TA)).toBe(RICE_TA);
  });
});

describe("buildReceiptHtml", () => {
  it("includes the Tamil name, tagged lang=ta, beneath the English name", () => {
    const html = buildReceiptHtml(data([{ item: item(), productName: "Ponni Rice", productNameTamil: RICE_TA }]), "bilingual");
    const en = html.indexOf(">Ponni Rice<");
    const ta = html.indexOf(`lang="ta">${RICE_TA}<`);
    expect(en).toBeGreaterThan(-1);
    expect(ta).toBeGreaterThan(en);
  });

  it("never prints null or an empty name line for items without a Tamil name", () => {
    const html = buildReceiptHtml(data([{ item: item(), productName: "Soap", productNameTamil: null }]), "tamil_first");
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
    expect(html).not.toMatch(/<div class="name[^"]*"[^>]*><\/div>/);
    expect(html).not.toContain('lang="ta"');
  });

  it("omits Tamil entirely in english mode", () => {
    const html = buildReceiptHtml(data([{ item: item(), productName: "Ponni Rice", productNameTamil: RICE_TA }]), "english");
    expect(html).not.toContain(RICE_TA);
  });

  it("escapes product and store strings", () => {
    const html = buildReceiptHtml(
      data([{ item: item(), productName: "Salt & <Pepper>", productNameTamil: "உப்பு & <மிளகு>" }], "A&B <Stores>"),
      "bilingual",
    );
    expect(html).toContain("Salt &amp; &lt;Pepper&gt;");
    expect(html).toContain("உப்பு &amp; &lt;மிளகு&gt;");
    expect(html).toContain("A&amp;B &lt;Stores&gt;");
    expect(html).not.toContain("<Pepper>");
    expect(html).not.toContain("<Stores>");
  });

  it("uses a Tamil-capable font stack and a fluid width that wraps long names", () => {
    const html = buildReceiptHtml(data([]), "bilingual");
    expect(RECEIPT_FONT_STACK.startsWith('"Nirmala UI", "Latha"')).toBe(true);
    expect(html).toContain(`font-family: ${RECEIPT_FONT_STACK}`);
    expect(html).toContain("max-width: 72mm");
    expect(html).toMatch(/\.name \{[^}]*overflow-wrap: anywhere/);
    // The old fixed 280px body was wider than a 58mm roll's printable area.
    expect(html).not.toContain("width: 280px");
  });

  it("prints the totals", () => {
    const html = buildReceiptHtml(data([]), "bilingual");
    expect(html).toContain("A-0001");
    expect(html).toContain("₹150.00");
  });

  it("stamps DUPLICATE COPY only when asked", () => {
    expect(buildReceiptHtml(data([]), "bilingual")).not.toContain("DUPLICATE COPY");
    expect(buildReceiptHtml(data([]), "bilingual", { duplicate: false })).not.toContain("DUPLICATE COPY");
    const html = buildReceiptHtml(data([]), "bilingual", { duplicate: true });
    expect(html).toContain("DUPLICATE COPY");
    // Under the header, above the bill number.
    expect(html.indexOf("DUPLICATE COPY")).toBeLessThan(html.indexOf("Bill No:"));
  });

  describe("RETURNED ITEMS (exchange)", () => {
    const baseExchangeReturn: ExchangeReturnSummary = {
      returnNo: "POS-RET-000001",
      originalBillNo: "A-0000",
      originalBillDate: "2026-09-10T10:00:00.000Z",
      refundPaise: 5000,
      roundOffPaise: 0,
      exchangePaise: 5000,
      payoutPaise: 0,
      payoutMode: null,
      lines: [{ name: "Old Soap", nameTamil: null, qty: 1, uom: "pcs", amountPaise: 5000 }],
    };

    it("is absent entirely when there is no linked return", () => {
      const html = buildReceiptHtml(data([]), "bilingual");
      expect(html).not.toContain("RETURNED ITEMS");
    });

    it("renders the Amount payable variant when the whole refund is absorbed", () => {
      const html = buildReceiptHtml({ ...data([]), exchangeReturn: baseExchangeReturn }, "bilingual");
      expect(html).toContain("RETURNED ITEMS");
      expect(html).toContain("A-0000");
      expect(html).toContain("POS-RET-000001");
      expect(html).toContain("Old Soap");
      expect(html).toContain("-₹50.00");
      expect(html).toContain("Amount payable");
      // Net Total (₹150.00) minus the refund (₹50.00).
      expect(html).toContain("₹100.00");
      expect(html).not.toContain("Refunded to customer");
    });

    it("renders the Refunded to customer variant when there is a leftover payout", () => {
      const partial: ExchangeReturnSummary = {
        ...baseExchangeReturn,
        exchangePaise: 3000,
        payoutPaise: 2000,
        payoutMode: "cash",
      };
      const html = buildReceiptHtml({ ...data([]), exchangeReturn: partial }, "bilingual");
      expect(html).toContain("Refunded to customer (Cash)");
      expect(html).toContain("₹20.00");
      expect(html).not.toContain("Amount payable");
    });

    it("shows the round-off row only when it is non-zero", () => {
      const noRoundOff = buildReceiptHtml({ ...data([]), exchangeReturn: baseExchangeReturn }, "bilingual");
      expect(noRoundOff).not.toContain("Return round off");

      const withRoundOff = buildReceiptHtml(
        { ...data([]), exchangeReturn: { ...baseExchangeReturn, roundOffPaise: 1 } },
        "bilingual",
      );
      expect(withRoundOff).toContain("Return round off");
    });
  });

  describe("cash tendered / change", () => {
    it("is absent entirely when cashTender is not set", () => {
      const html = buildReceiptHtml(data([]), "bilingual");
      expect(html).not.toContain("Cash tendered");
      expect(html).not.toContain("Change returned");
      expect(html).not.toContain("Change kept on khata");
    });

    it("prints the handback wording and figures", () => {
      const html = buildReceiptHtml(
        { ...data([]), cashTender: { tenderedPaise: 18000, changePaise: 3000, changeAction: "handback" } },
        "bilingual",
      );
      expect(html).toContain("Cash tendered");
      expect(html).toContain("₹180.00");
      expect(html).toContain("Change returned");
      expect(html).toContain("₹30.00");
      expect(html).not.toContain("Change kept on khata");
    });

    it("prints the khata wording when change was kept on khata", () => {
      const html = buildReceiptHtml(
        { ...data([]), cashTender: { tenderedPaise: 18000, changePaise: 3000, changeAction: "khata" } },
        "bilingual",
      );
      expect(html).toContain("Change kept on khata");
      expect(html).not.toContain("Change returned");
    });
  });
});
