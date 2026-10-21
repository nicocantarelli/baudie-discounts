// Upsell deals: load and save, for the app's Upsell deals page (./UpsellPage.jsx).
//
// An "upsell product" is any product with a `custom.upsell_price` metafield
// (number_decimal), and the value is its deal price. The discount function
// charges it, and the cart drawer and the checkout upsell show it, all from
// that same metafield, so this page only reads and writes it per product.

const NAMESPACE = 'custom';
const KEY = 'upsell_price';

/** @returns {Promise<any>} */
async function adminGraphql(query, variables = {}) {
  const result = await shopify.query(query, { variables });
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join(' '));
  }
  return result.data;
}

const money = (value) => (value === null || value === undefined || value === '' ? '' : String(parseFloat(value)));

function rowFromProduct(product) {
  return {
    productId: product.id,
    title: product.title,
    status: product.status,
    image: product.featuredMedia?.preview?.image?.url ?? null,
    price: product.variants?.nodes?.[0]?.price ?? null,
    dealPrice: money(product.upsellPrice?.value),
  };
}

/**
 * The upsell products (every product carrying the metafield; the catalog is
 * small, so all products are read and filtered here) and the discount that
 * runs the deal.
 */
export async function loadUpsellDeals() {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const data = await adminGraphql(
      `#graphql
      query UpsellProducts($cursor: String) {
        products(first: 100, after: $cursor, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            status
            featuredMedia { preview { image { url } } }
            variants(first: 1) { nodes { price } }
            upsellPrice: metafield(namespace: "${NAMESPACE}", key: "${KEY}") { value }
          }
        }
      }`,
      { cursor },
    );
    for (const product of data.products.nodes) {
      if (product.upsellPrice?.value) rows.push(rowFromProduct(product));
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

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

  return { rows, discount };
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
      title: product.title,
      status: product.status,
      image: product.images?.[0]?.originalSrc ?? null,
      price: product.variants?.[0]?.price ?? null,
      dealPrice: '',
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
 * Saves the deal prices that changed or were added, and removes the deal from
 * products taken off the list.
 */
export async function saveUpsellDeals(rows, savedRows) {
  const savedById = new Map(savedRows.map((row) => [row.productId, row]));
  const changed = rows.filter((row) => {
    const before = savedById.get(row.productId);
    return !before || parseFloat(before.dealPrice) !== parseFloat(row.dealPrice);
  });
  const removed = savedRows.filter((row) => !rows.some((r) => r.productId === row.productId));

  if (changed.length) {
    const data = await adminGraphql(
      `#graphql
      mutation SetUpsellPrices($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { message } }
      }`,
      {
        metafields: changed.map((row) => ({
          ownerId: row.productId,
          namespace: NAMESPACE,
          key: KEY,
          type: 'number_decimal',
          value: parseFloat(row.dealPrice).toFixed(2),
        })),
      },
    );
    const errors = data.metafieldsSet.userErrors;
    if (errors.length) throw new Error(errors.map((error) => error.message).join(' '));
  }

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
