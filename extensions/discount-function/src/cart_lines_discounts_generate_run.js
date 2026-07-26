import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from '../generated/api';

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

const NO_DISCOUNT = { operations: [] };

/**
 * Discounts every "upsell" product down to its deal price, for ANY quantity,
 * WHENEVER the cart also contains at least one non-upsell product. A cart of
 * only upsell products gets no discount (so the wipes keep full price on their
 * own / on the product page).
 *
 * "Upsell product" = any product carrying a `custom.upsell_price` metafield
 * (the same value the cart drawer shows on the upsell cards). The deal price is
 * read per product from that metafield, so the 1-pack ($8) and the 3-pack ($19)
 * each land at their own price, and any future upsell product is covered just
 * by setting its metafield.
 *
 * One Shopify Function = one automatic discount, so there's no "only one
 * automatic discount applies" conflict: this single discount handles every
 * upsell product and every quantity at once.
 *
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const lines = input.cart.lines;
  if (!lines.length) return NO_DISCOUNT;

  // We only emit product discounts, so do nothing unless the discount node has
  // the Product class enabled.
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) {
    return NO_DISCOUNT;
  }

  // The deal (target) price for a line, or null if it isn't an upsell product.
  const dealPriceOf = (line) => {
    const m = line.merchandise;
    if (!m || m.__typename !== 'ProductVariant' || !m.product) return null;
    const mf = m.product.upsellPrice;
    if (!mf || mf.value == null || mf.value === '') return null;
    const v = parseFloat(mf.value);
    return v > 0 ? v : null;
  };

  // The deal only applies when at least one NON-upsell product is in the cart.
  const hasQualifier = lines.some(
    (line) =>
      line.merchandise &&
      line.merchandise.__typename === 'ProductVariant' &&
      dealPriceOf(line) === null,
  );
  if (!hasQualifier) return NO_DISCOUNT;

  const candidates = [];
  for (const line of lines) {
    const deal = dealPriceOf(line);
    if (deal === null) continue;

    const unit = parseFloat(line.cost.amountPerQuantity.amount);
    if (!(unit > deal)) continue; // already at or below the deal price

    candidates.push({
      message: 'Upsell deal',
      targets: [{ cartLine: { id: line.id } }],
      value: {
        fixedAmount: {
          // Per-item amount off, so every unit lands exactly at the deal price
          // regardless of quantity.
          amount: (unit - deal).toFixed(2),
          appliesToEachItem: true,
        },
      },
    });
  }
  if (!candidates.length) return NO_DISCOUNT;

  return {
    operations: [
      {
        productDiscountsAdd: {
          // ALL => every candidate applies (each targets a different line), so
          // all upsell products in the cart are discounted at once.
          selectionStrategy: ProductDiscountSelectionStrategy.All,
          candidates,
        },
      },
    ],
  };
}
