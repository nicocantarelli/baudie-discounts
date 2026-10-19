/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").ProductDiscountCandidate} ProductDiscountCandidate
 * @typedef {import("../generated/api").CartOperation} CartOperation
 */

/**
 * Gift with purchase settings, saved as JSON in the shop metafield
 * `baudie.gift_promo` by the discount's settings panel (extensions/discount-ui).
 * The theme reads the same metafield to add the gifts in the cart drawer.
 *
 * @typedef {object} GiftTier
 * @property {string} minimum    Spend needed for this gift, in the shop's currency ("60.00").
 * @property {string} variantId  The gift's variant GID.
 * @property {number} quantity   How many of the gift are free.
 *
 * @typedef {object} GiftPromo
 * @property {'off' | 'preview' | 'on'} status
 * @property {string | null} [startDate]  First day of the promo (YYYY-MM-DD, store time), inclusive.
 * @property {string | null} [endDate]    Last day of the promo (YYYY-MM-DD, store time), inclusive.
 * @property {GiftTier[]} tiers
 * @property {string} [codesBlockedMessage]  Shown at checkout when a code is rejected during the promo.
 * @property {object[]} [vip]  VIP code gifts. Only the theme uses these: it adds
 *   the gift when a VIP code is in the cart, and the VIP code itself (a regular
 *   Shopify discount code) makes it free. This function only blocks those codes
 *   while a promo runs, like any other code.
 */

export const GIFT_MESSAGE = 'Free gift';
export const DEFAULT_CODES_BLOCKED_MESSAGE =
  "Discount codes can't be used during this promotion. Save yours for your next order!";

/**
 * The value of a line's `_gift` property: "tier:1".."tier:3" for promo gifts,
 * "vip:<prefix>" for VIP code gifts. Null for every other line.
 *
 * @param {RunInput['cart']['lines'][number]} line
 * @returns {string | null}
 */
export function giftValue(line) {
  const value = line.gift?.value;
  return value ? value : null;
}

/** @param {RunInput['cart']['lines'][number]} line */
export function isGiftLine(line) {
  return giftValue(line) !== null;
}

/**
 * Parses the settings metafield, keeping only well-formed tiers.
 *
 * @param {RunInput} input
 * @returns {GiftPromo | null}
 */
export function giftPromoSettings(input) {
  const raw = input.shop.giftPromo?.jsonValue;
  if (!raw || typeof raw !== 'object') return null;

  const tiers = (Array.isArray(raw.tiers) ? raw.tiers : []).filter(
    (tier) =>
      tier &&
      typeof tier.variantId === 'string' &&
      parseFloat(tier.minimum) >= 0 &&
      Number.isInteger(tier.quantity) &&
      tier.quantity > 0,
  );

  return { ...raw, tiers };
}

/**
 * Whether the promo applies to this cart: status "on" within its dates, or
 * "preview" on a cart the theme flagged with `_gift_preview` (the merchant's
 * preview link). A promo with no gifts set up never runs, so it can't block
 * codes on its own.
 *
 * @param {RunInput} input
 * @param {GiftPromo | null} promo
 */
export function giftPromoIsRunning(input, promo) {
  if (!promo || !promo.tiers.length) return false;

  if (promo.status === 'preview') {
    return input.cart.giftPreview?.value === '1';
  }
  if (promo.status !== 'on') return false;

  // ISO dates compare correctly as strings.
  const today = input.shop.localTime.date;
  if (promo.startDate && today < promo.startDate) return false;
  if (promo.endDate && today > promo.endDate) return false;
  return true;
}

/**
 * One 100%-off candidate per promo gift line that has earned its tier.
 *
 * The spend counts every line except gifts, at its price before discounts
 * (subscription lines already carry their plan price). The theme decides when
 * to add a gift from the cart total AFTER discounts (e.g. the wipes deal),
 * which is never higher, so a gift the drawer adds is always free here.
 *
 * Only the tier's own variant qualifies, only up to the tier's quantity, and
 * each tier is honoured once, whatever the cart contains.
 *
 * @param {RunInput} input
 * @param {GiftPromo} promo
 * @returns {ProductDiscountCandidate[]}
 */
export function giftCandidates(input, promo) {
  const lines = input.cart.lines;
  const rate = parseFloat(input.presentmentCurrencyRate) || 1;

  const spend = lines
    .filter((line) => !isGiftLine(line))
    .reduce((sum, line) => sum + parseFloat(line.cost.subtotalAmount.amount), 0);

  const used = new Set();
  const candidates = [];

  for (const line of lines) {
    const match = /^tier:(\d)$/.exec(giftValue(line) ?? '');
    if (!match) continue;

    const index = Number(match[1]) - 1;
    const tier = promo.tiers[index];
    if (!tier || used.has(index)) continue;
    if (line.merchandise.__typename !== 'ProductVariant') continue;
    if (line.merchandise.id !== tier.variantId) continue;

    // Half a cent of slack for floating point.
    if (spend + 0.005 < parseFloat(tier.minimum) * rate) continue;

    used.add(index);
    candidates.push({
      message: GIFT_MESSAGE,
      targets: [
        {
          cartLine: {
            id: line.id,
            quantity: Math.min(line.quantity, tier.quantity),
          },
        },
      ],
      value: { percentage: { value: 100 } },
    });
  }

  return candidates;
}

/**
 * Rejects every code the customer entered, with the promo's message.
 * Returns null when there's nothing to reject.
 *
 * @param {RunInput} input
 * @param {GiftPromo} promo
 * @returns {CartOperation | null}
 */
export function codeRejection(input, promo) {
  const codes = input.enteredDiscountCodes
    .filter((entered) => entered.rejectable)
    .map((entered) => ({ code: entered.code }));
  if (!codes.length) return null;

  return {
    enteredDiscountCodesReject: {
      codes,
      message: promo.codesBlockedMessage?.trim() || DEFAULT_CODES_BLOCKED_MESSAGE,
    },
  };
}
