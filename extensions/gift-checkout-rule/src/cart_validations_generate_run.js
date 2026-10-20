// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

// Shown at the top of checkout.
export const GIFT_NOT_FREE_MESSAGE =
  'Your order includes a free gift that no longer applies. Please go back to your cart to update your order.';

/**
 * Gift with purchase backstop: a gift line (the `_gift` line property the
 * theme adds) must be free at checkout. One that isn't is no longer earned:
 * the promo ended, the spend dropped, the discount is off, or its VIP code is
 * gone. The theme takes those out of the cart, but a checkout reopened later
 * (an abandoned-checkout email after the promo ended, say) still has them, at
 * full price. This blocks payment with a message that sends the customer back
 * to their cart, where the theme removes the gift.
 *
 * Only checkout steps are checked, never cart changes, so the theme's own cart
 * updates (removing the item that earned a gift, then the gift) always go
 * through. Validation runs after discounts, so `totalAmount` is the price
 * after the gift discount.
 *
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const step = input.buyerJourney?.step;
  if (step !== 'CHECKOUT_INTERACTION' && step !== 'CHECKOUT_COMPLETION') {
    return { operations: [] };
  }

  const chargedGift = input.cart.lines.some(
    (line) => !!line.gift?.value && parseFloat(line.cost.totalAmount.amount) > 0
  );
  if (!chargedGift) return { operations: [] };

  return {
    operations: [
      {
        validationAdd: {
          errors: [{ message: GIFT_NOT_FREE_MESSAGE, target: '$.cart' }]
        }
      }
    ]
  };
}
