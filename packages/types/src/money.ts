/**
 * Money is always represented as an integer number of paise (1 rupee = 100 paise).
 * Never use `number` for money in a way that allows fractional paise or float math
 * to leak in from outside `@pos/business-logic/money`.
 */
export type Paise = number & { readonly __brand: "Paise" };

export function asPaise(value: number): Paise {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Paise value must be an integer, got ${value}`);
  }
  return value as Paise;
}
