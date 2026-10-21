// Upsell deals: load and save, for the app's Upsell deals page (./UpsellPage.jsx).
//
// An "upsell product" is any product with a `custom.upsell_price` metafield
// (number_decimal), and the value is its deal price. The discount function
// charges it, and the cart drawer and the checkout upsell show it, all from
// that same metafield, so this page only reads and writes it per product.
//
// Which deal products the cart drawer and the checkout suggest is the
// `baudie.upsell_offers` shop metafield (JSON), also saved here:
//   { offers: [{ productId, productHandle, variantId, containedIn: [productId] }],
//     dealProductIds: [productId] }
// `containedIn` lists the bundles that already include the product (their
// `custom.bundle_companion`), so the drawer doesn't offer it again;
// `dealProductIds` lets the drawer hide its offers when the cart holds only
// deal products, which the deal wouldn't apply to.

const NAMESPACE = 'custom';
const KEY = 'upsell_price';
const OFFERS_NAMESPACE = 'baudie';
const OFFERS_KEY = 'upsell_offers';

/** @returns {Promise<any>} */
async function adminGraphql(query, variables = {}) {
  const result = await shopify.query(query, { variables });
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join(' '));
  }
  return result.data;
}

const money = (value) => (value === null || value === undefined || value === '' ? '' : String(parseFloat(value)));

function rowFromProduct(product, offered) {
  return {
    productId: product.id,
    handle: product.handle,
    variantId: product.variants?.nodes?.[0]?.id ?? null,
    title: product.title,
    status: product.status,
    image: product.featuredMedia?.preview?.image?.url ?? null,
    price: product.variants?.nodes?.[0]?.price ?? null,
    dealPrice: money(product.upsellPrice?.value),
    offered,
  };
}

// A bundle's `custom.bundle_companion`: one product reference, or a list.
function companionIds(value) {
  if (!value) return [];
  if (value.startsWith('[')) {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return [value];
}

// JSON with sorted keys, so two values compare equal whatever their key order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The shop metafield value for these rows: what the drawer and checkout offer. */
export function buildUpsellOffers(rows, bundles) {
  return {
    offers: rows
      .filter((row) => row.offered)
      .map((row) => ({
        productId: row.productId,
        productHandle: row.handle,
        variantId: row.variantId,
        containedIn: (bundles[row.productId] ?? []).map((bundle) => bundle.id),
      })),
    dealProductIds: rows.map((row) => row.productId),
  };
}

/**
 * The upsell products (every product carrying the metafield; the catalog is
 * small, so all products are read and filtered here), the bundles that
 * include each one, the saved offers and the discount that runs the deal.
 */
export async function loadUpsellDeals() {
  const shopData = await adminGraphql(`#graphql
    query UpsellOffers {
      shop {
        id
        offers: metafield(namespace: "${OFFERS_NAMESPACE}", key: "${OFFERS_KEY}") { jsonValue }
      }
    }`);
  const savedOffers = shopData.shop.offers?.jsonValue ?? null;
  // Before offers are first saved, every deal product is offered.
  const offeredIds = savedOffers ? (savedOffers.offers ?? []).map((offer) => offer.productId) : null;

  const products = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const data = await adminGraphql(
      `#graphql
      query UpsellProducts($cursor: String) {
        products(first: 100, after: $cursor, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            handle
            title
            status
            featuredMedia { preview { image { url } } }
            variants(first: 1) { nodes { id price } }
            upsellPrice: metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value }
            companion: metafield(namespace: "custom", key: "bundle_companion") { value }
          }
        }
      }`,
      { cursor },
    );
    products.push(...data.products.nodes);
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  const rows = products
    .filter((product) => product.upsellPrice?.value)
    .map((product) => rowFromProduct(product, offeredIds ? offeredIds.includes(product.id) : true));

  /** @type {Record<string, {id: string, title: string}[]>} */
  const bundles = {};
  for (const product of products) {
    for (const id of companionIds(product.companion?.value)) {
      (bundles[id] ??= []).push({ id: product.id, title: product.title });
    }
  }

  // The offers need saving when none are saved yet, or when the saved ones no
  // longer match the products (a bundle or a handle changed since).
  const offersStale = !savedOffers || canonical(savedOffers) !== canonical(buildUpsellOffers(rows, bundles));

  // The automatic discount that runs this app's function (the Upsell deal).
  const discounts = await adminGraphql(`#graphql
    query UpsellDiscount {
      currentAppInstallation { app { id } }
      discountNodes(first: 100) {
        nodes {
          id
          discount {
            __typename
            ... on DiscountAutomaticApp {
              title
              status
              appDiscountType { app { id } }
            }
          }
        }
      }
    }`);
  const appId = discounts.currentAppInstallation?.app?.id;
  const node = discounts.discountNodes.nodes.find(
    (n) =>
      n.discount?.__typename === 'DiscountAutomaticApp' &&
      n.discount.appDiscountType?.app?.id === appId,
  );
  const discount = node
    ? {
        title: node.discount.title,
        status: node.discount.status,
        adminUrl: `shopify:admin/discounts/${node.id.split('/').pop()}`,
      }
    : null;

  return { rows, discount, bundles, shopId: shopData.shop.id, offersStale };
}

/** Opens the product picker for products to add, returns rows (no deal price yet). */
export async function pickUpsellProducts(existingIds) {
  const selection = await shopify.resourcePicker({
    type: 'product',
    multiple: true,
    filter: { variants: false, draft: false, archived: false },
  });
  return (selection ?? [])
    .filter((product) => !existingIds.includes(product.id))
    .map((product) => ({
      productId: product.id,
      handle: product.handle,
      variantId: product.variants?.[0]?.id ?? null,
      title: product.title,
      status: product.status,
      image: product.images?.[0]?.originalSrc ?? null,
      price: product.variants?.[0]?.price ?? null,
      dealPrice: '',
      offered: true,
    }));
}

/** A translation key for the first problem, or null when everything is fine. */
export function validateUpsellDeals(rows) {
  for (const row of rows) {
    const deal = parseFloat(row.dealPrice);
    if (!(deal > 0)) return 'errors.dealPrice';
    if (row.price !== null && deal >= parseFloat(row.price)) return 'errors.dealNotLower';
  }
  return null;
}

/**
 * Saves the deal prices that changed or were added and the offers for the
 * drawer and checkout, and removes the deal from products taken off the list.
 */
export async function saveUpsellDeals(rows, savedRows, bundles, shopId) {
  const savedById = new Map(savedRows.map((row) => [row.productId, row]));
  const changed = rows.filter((row) => {
    const before = savedById.get(row.productId);
    return !before || parseFloat(before.dealPrice) !== parseFloat(row.dealPrice);
  });
  const removed = savedRows.filter((row) => !rows.some((r) => r.productId === row.productId));

  // Prices go first, so an offer never points at a product without its deal price.
  if (changed.length) {
    await setMetafields(
      changed.map((row) => ({
        ownerId: row.productId,
        namespace: NAMESPACE,
        key: KEY,
        type: 'number_decimal',
        value: parseFloat(row.dealPrice).toFixed(2),
      })),
    );
  }

  await setMetafields([
    {
      ownerId: shopId,
      namespace: OFFERS_NAMESPACE,
      key: OFFERS_KEY,
      type: 'json',
      value: JSON.stringify(buildUpsellOffers(rows, bundles)),
    },
  ]);

  if (removed.length) {
    const data = await adminGraphql(
      `#graphql
      mutation RemoveUpsellPrices($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { userErrors { message } }
      }`,
      {
        metafields: removed.map((row) => ({ ownerId: row.productId, namespace: NAMESPACE, key: KEY })),
      },
    );
    const errors = data.metafieldsDelete.userErrors;
    if (errors.length) throw new Error(errors.map((error) => error.message).join(' '));
  }
}

async function setMetafields(metafields) {
  const data = await adminGraphql(
    `#graphql
    mutation SetUpsellMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { message } }
    }`,
    { metafields },
  );
  const errors = data.metafieldsSet.userErrors;
  if (errors.length) throw new Error(errors.map((error) => error.message).join(' '));
}
