// Gift with purchase settings: load, validate and save.
//
// The settings live in ONE shop metafield, `baudie.gift_promo` (JSON). Both
// sides read it: the discount function (to make gifts free and block codes at
// checkout) and the theme's cart drawer (to add the gifts and show progress).
// It's a shop metafield rather than one on the discount because the theme can
// read shop metafields in Liquid, and a discount's can't be read there.

export const MAX_TIERS = 3;
export const MAX_VIP_GIFTS = 3;

const NAMESPACE = 'baudie';
const KEY = 'gift_promo';

/** @returns {Promise<any>} */
async function adminGraphql(query, variables = {}) {
  const response = await fetch('shopify:admin/api/graphql.json', {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join(' '));
  }
  return json.data;
}

export const EMPTY_PROMO = {
  status: 'off',
  startDate: '',
  endDate: '',
  tiers: [],
  vip: [],
  codesBlockedMessage: '',
};

/** A gift as the panel shows it, refreshed from the product each load. */
function giftFromVariant(variant) {
  if (!variant?.product) return null;
  const variantTitle =
    variant.title && variant.title !== 'Default Title' ? ` – ${variant.title}` : '';
  return {
    variantId: variant.id,
    productId: variant.product.id,
    productHandle: variant.product.handle,
    title: `${variant.product.title}${variantTitle}`,
    image:
      variant.image?.url ??
      variant.product.featuredMedia?.preview?.image?.url ??
      null,
  };
}

/**
 * Loads the saved settings plus the shop details the panel needs. Each gift's
 * title, image and handle are re-read from its product, so renaming a product
 * (or changing its handle) is picked up the next time the settings are saved.
 */
export async function loadGiftPromo() {
  const data = await adminGraphql(`#graphql
    query GiftPromoSettings {
      shop {
        id
        ianaTimezone
        currencyCode
        primaryDomain { url }
        giftPromo: metafield(namespace: "${NAMESPACE}", key: "${KEY}") { jsonValue }
      }
    }`);

  const shop = data.shop;
  const saved = shop.giftPromo?.jsonValue ?? {};

  const rows = (list) =>
    (Array.isArray(list) ? list : []).filter((row) => row?.variantId);
  const savedTiers = rows(saved.tiers);
  const savedVip = rows(saved.vip);

  const ids = [...savedTiers, ...savedVip].map((row) => row.variantId);
  const variants = new Map();
  if (ids.length) {
    const lookup = await adminGraphql(
      `#graphql
      query GiftVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            image { url }
            product {
              id
              title
              handle
              featuredMedia { preview { image { url } } }
            }
          }
        }
      }`,
      { ids },
    );
    for (const node of lookup.nodes) {
      if (node?.id) variants.set(node.id, node);
    }
  }

  // A gift whose product was deleted comes back as null, so the row shows
  // "Choose a gift" again instead of pointing at nothing.
  const withGift = (row) => ({
    ...row,
    gift: giftFromVariant(variants.get(row.variantId)),
  });

  return {
    shop: {
      id: shop.id,
      timezone: shop.ianaTimezone,
      currencyCode: shop.currencyCode,
      url: shop.primaryDomain?.url ?? '',
    },
    promo: {
      status: ['off', 'preview', 'on'].includes(saved.status) ? saved.status : 'off',
      startDate: saved.startDate ?? '',
      endDate: saved.endDate ?? '',
      tiers: savedTiers.map((tier) =>
        withGift({
          minimum: String(tier.minimum ?? ''),
          quantity: String(tier.quantity ?? 1),
          variantId: tier.variantId,
        }),
      ),
      vip: savedVip.map((row) =>
        withGift({
          prefix: row.prefix ?? '',
          quantity: String(row.quantity ?? 1),
          variantId: row.variantId,
        }),
      ),
      codesBlockedMessage: saved.codesBlockedMessage ?? '',
    },
  };
}

/** Opens the product picker and returns the chosen gift, or null if cancelled. */
export async function pickGift(current) {
  const selection = await shopify.resourcePicker({
    type: 'product',
    multiple: false,
    filter: { variants: true, draft: false, archived: false },
    selectionIds: current
      ? [{ id: current.productId, variants: [{ id: current.variantId }] }]
      : [],
  });
  const product = selection?.[0];
  if (!product) return null;

  const variant = product.variants?.[0];
  if (!variant?.id) return null;

  const variantTitle =
    variant.title && variant.title !== 'Default Title' ? ` – ${variant.title}` : '';
  return {
    variantId: variant.id,
    productId: product.id,
    productHandle: product.handle,
    title: `${product.title}${variantTitle}`,
    image: variant.image?.originalSrc ?? product.images?.[0]?.originalSrc ?? null,
  };
}

/**
 * Checks the settings before saving. Returns a translation key for the first
 * problem found, or null when everything is fine.
 */
export function validateGiftPromo(promo) {
  for (const tier of promo.tiers) {
    if (!(parseFloat(tier.minimum) > 0)) return 'errors.tierAmount';
    if (!tier.gift) return 'errors.tierGift';
    if (!(parseInt(tier.quantity, 10) >= 1)) return 'errors.quantity';
  }
  for (const row of promo.vip) {
    if (!row.prefix.trim()) return 'errors.vipPrefix';
    if (!row.gift) return 'errors.vipGift';
    if (!(parseInt(row.quantity, 10) >= 1)) return 'errors.quantity';
  }
  const prefixes = promo.vip.map((row) => row.prefix.trim().toUpperCase());
  if (new Set(prefixes).size !== prefixes.length) return 'errors.vipDuplicate';

  if (promo.status !== 'off' && !promo.tiers.length) return 'errors.noTiers';
  if (promo.startDate && promo.endDate && promo.endDate < promo.startDate) {
    return 'errors.dates';
  }
  return null;
}

/** The JSON both the function and the theme read. */
export function serializeGiftPromo(promo, shop) {
  const giftFields = (row) => ({
    quantity: parseInt(row.quantity, 10),
    variantId: row.gift.variantId,
    productId: row.gift.productId,
    productHandle: row.gift.productHandle,
    title: row.gift.title,
  });

  return {
    version: 1,
    status: promo.status,
    startDate: promo.startDate || null,
    endDate: promo.endDate || null,
    // The theme compares dates in the store's time zone, like the function.
    timezone: shop.timezone,
    currencyCode: shop.currencyCode,
    tiers: promo.tiers.map((tier) => ({
      minimum: parseFloat(tier.minimum).toFixed(2),
      ...giftFields(tier),
    })),
    vip: promo.vip.map((row) => ({
      prefix: row.prefix.trim().toUpperCase(),
      ...giftFields(row),
    })),
    codesBlockedMessage: promo.codesBlockedMessage.trim(),
    updatedAt: new Date().toISOString(),
  };
}

export async function saveGiftPromo(promo, shop) {
  const data = await adminGraphql(
    `#graphql
    mutation SaveGiftPromo($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { message }
      }
    }`,
    {
      metafields: [
        {
          ownerId: shop.id,
          namespace: NAMESPACE,
          key: KEY,
          type: 'json',
          value: JSON.stringify(serializeGiftPromo(promo, shop)),
        },
      ],
    },
  );
  const errors = data.metafieldsSet.userErrors;
  if (errors.length) throw new Error(errors.map((error) => error.message).join(' '));
}
