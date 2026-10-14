/** The little a stock form needs to know about the product it is changing. */
export interface PickedProduct {
  productId: string;
  name: string;
  uom: string;
  stockOnHand: number;
}
