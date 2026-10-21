import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from '../generated/api';
import {
  codeRejection,
  giftCandidates,
  giftPromoIsRunning,
  giftPromoSettings,
  isGiftLine,
} from './gift_with_purchase';

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 * @typedef {import("../generated/api").ProductDiscountCandidate} ProductDiscountCandidate
 */

/**
 * One Shopify Function = one automatic discount, running both deals:
 *
 * - the upsell deal (upsellCandidates below), and
 * - gift with purchase (./gift_with_purchase.js): while a promo runs, the
 *   theme's gift lines are free once their spend tier is reached, and every
 *   discount code is rejected.
 *
 * A single discount means there's no "only one automatic discount applies"
 * conflict: both deals always apply together, with no combination settings to
 * keep in sync.
 *
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const promo = giftPromoSettings(input);
  const promoRunning = giftPromoIsRunning(input, promo);

  const operations = [];

  // Discounts are only emitted when the discount node has the Product class
  // enabled. Rejecting codes doesn't depend on it.
  if (input.discount.discountClasses.includes(DiscountClass.Product)) {
    const candidates = [
      ...upsellCandidates(input),
      ...(promoRunning ? giftCandidates(input, promo) : []),
    ];
    if (candidates.length) {
      operations.push({
        productDiscountsAdd: {
          // ALL => every candidate applies (each targets a different line), so
          // all upsell products and gifts in the cart are discounted at once.
          selectionStrategy: ProductDiscountSelectionStrategy.All,
          candidates,
        },
      });
    }
  }

  if (promoRunning) {
    const rejection = codeRejection(input, promo);
    if (rejection) operations.push(rejection);
  }

  return { operations };
}

/**
 * Discounts every "upsell" product down to its deal price, for ANY quantity,
 * WHENEVER the cart also contains at least one non-upsell product. A cart of
 * only upsell products gets no discount (so the wipes keep full price on their
 * own / on the product page). Subscribed (selling plan) upsell lines are never
 * discounted — they get only the subscription price.
 *
 * "Upsell product" = any product carrying a `custom.upsell_price` metafield
 * (the same value the cart drawer shows on the upsell cards). The deal price is
 * read per product from that metafield, so the 1-pack ($8) and the 3-pack ($19)
 * each land at their own price, and any future upsell product is covered just
 * by setting its metafield.
 *
 * Free gift lines are never upsell-discounted (the gift deal makes them free)
 * and never count as the regular product the deal needs.
 *
 * @param {RunInput} input
 * @returns {ProductDiscountCandidate[]}
 */
function upsellCandidates(input) {
  const lines = input.cart.lines;
  if (!lines.length) return [];

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
  // A free gift doesn't count: the customer didn't buy it, so wipes plus a
  // gift is still a cart of only deal products.
  const hasQualifier = lines.some(
    (line) =>
      line.merchandise &&
      line.merchandise.__typename === 'ProductVariant' &&
      dealPriceOf(line) === null &&
      !isGiftLine(line),
  );
  if (!hasQualifier) return [];

  const candidates = [];
  for (const line of lines) {
    const deal = dealPriceOf(line);
    if (deal === null) continue;

    // A free gift that happens to be an upsell product (e.g. the wipes) is
    // discounted by the gift deal instead.
    if (isGiftLine(line)) continue;

    // Subscriptions already carry their own discount (Appstle's selling plan
    // price) and must not stack with the deal, so subscribed lines are skipped.
    // A subscription line of a regular product still counts as a qualifier.
    if (line.sellingPlanAllocation) continue;

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
  return candidates;
}
