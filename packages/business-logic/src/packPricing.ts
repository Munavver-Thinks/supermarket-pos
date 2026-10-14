/**
 * A pack child's price is always derived the same way: the parent's rate per base unit,
 * times how much of that unit the pack holds. "Sugar 50kg Bag" at ₹60/kg → a "1kg" child
 * (packQty 1) is ₹60.00, a "500g" child (packQty 0.5) is ₹30.00. Rounds to the nearest paisa,
 * same as every other price in the app — a packQty like 1/3 will not divide evenly, and the
 * child's price and the parent's price must round the same way or the numbers drift apart
 * the next time either one is touched.
 */

export interface PackPrices {
  mrpPaise: number;
  salePricePaise: number;
  costPricePaise: number;
  /** Null means no wholesale rate — a parent with none gives its children none either, never
   * a derived 0 (which would mean "free"). */
  wholesalePricePaise?: number | null;
  isTaxInclusive: boolean;
}

export function derivePackPrices(parent: PackPrices, packQty: number): PackPrices {
  return {
    mrpPaise: Math.round(parent.mrpPaise * packQty),
    salePricePaise: Math.round(parent.salePricePaise * packQty),
    costPricePaise: Math.round(parent.costPricePaise * packQty),
    wholesalePricePaise:
      parent.wholesalePricePaise == null ? null : Math.round(parent.wholesalePricePaise * packQty),
    isTaxInclusive: parent.isTaxInclusive,
  };
}
