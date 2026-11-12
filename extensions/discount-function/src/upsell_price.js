/**
 * The upsell deal price in the customer's currency.
 *
 * `custom.upsell_price` is in the shop's currency (USD). Shopify only
 * localizes real variant prices (market price lists, rounding), never a number
 * metafield, so in any other currency the deal takes the same share off the
 * price Shopify charges for the variant in that market:
 *
 *   deal = market price × upsell_price ÷ the variant's shop-currency price
 *
 * The shop-currency prices come from the `baudie.upsell_offers` shop metafield
 * (`shopCurrency` and `basePrices`, saved by the Upsell deals page), so this
 * never does exchange-rate math.
 *
 * The checkout upsell (baudie-checkout-upsell, src/lib/upsell.js) and the
 * theme's cart drawer (snippets/sidecart-upsell-item.liquid) compute the same
 * cents from the same numbers. They MUST stay in sync: that's what makes the
 * price they show exactly what this discount charges.
 */

/**
 * The deal pricing saved with the offers.
 *
 * `shopCurrency` is null until the Upsell deals page saves the prices: until
 * then, every currency keeps the deal price as saved, in all three places
 * alike, so they never disagree while the change rolls out.
 *
 * @param {unknown} value The `baudie.upsell_offers` metafield's jsonValue.
 * @returns {{shopCurrency: string | null, basePrices: Record<string, string>}}
 */
export function upsellPricing(value) {
  const offers = /** @type {any} */ (value);
  const shopCurrency = offers && typeof offers.shopCurrency === 'string' ? offers.shopCurrency : null;
  const basePrices =
    offers && offers.basePrices && typeof offers.basePrices === 'object' ? offers.basePrices : {};
  return { shopCurrency, basePrices };
}

/**
 * Whether the deal price applies as saved: in the shop's currency, or before
 * the Upsell deals page has saved the prices.
 *
 * @param {{shopCurrency: string | null}} pricing
 * @param {string} currencyCode The cart's currency.
 */
export function dealIsInShopCurrency(pricing, currencyCode) {
  return pricing.shopCurrency === null || currencyCode === pricing.shopCurrency;
}

/** @param {string | number} amount */
export function toCents(amount) {
  return Math.round(parseFloat(String(amount)) * 100);
}

/**
 * The deal price in another currency, in cents of that currency, or null when
 * the deal doesn't apply: no saved shop-currency price for the variant, or a
 * deal price that isn't below it (the same rule as in the shop's currency).
 *
 * @param {number} unitCents The variant's price in the cart's currency, in cents.
 * @param {number} dealPrice The `custom.upsell_price` value (shop currency).
 * @param {string | undefined} basePrice The variant's shop-currency price.
 * @returns {number | null}
 */
export function localDealCents(unitCents, dealPrice, basePrice) {
  if (basePrice == null) return null;
  const dealCents = toCents(dealPrice);
  const baseCents = toCents(basePrice);
  if (!(baseCents > 0) || !(dealCents > 0) || !(dealCents < baseCents)) return null;
  return Math.round((unitCents * dealCents) / baseCents);
}
