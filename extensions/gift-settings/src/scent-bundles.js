// Pick-your-scent bundles (the Essentials Duo, the Bundle of 3) can't be a
// gift or an upsell deal. Simple Bundles only expands one into the products the
// 3PL ships when its cart line carries the customer's picked scents, and the
// cart drawer and the checkout upsell add a gift or a deal by variant alone.
// The scent bundle check (extensions/bundle-checkout-rule) would then stop that
// order at payment, so both pickers refuse these products up front.
//
// A product is one when any of its variants has the
// `simple_bundles.variant_options` metafield, the same test the checkout rule
// uses, so a new pick bundle is refused without a code change.

/**
 * The ids of the products, among `productIds`, that are pick-your-scent
 * bundles.
 *
 * @param {string[]} productIds
 * @returns {Promise<Set<string>>}
 */
export async function scentBundleIds(productIds) {
  if (!productIds.length) return new Set();
  const result = await shopify.query(
    `#graphql
    query ScentBundles($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          variants(first: 100) {
            nodes {
              bundleOptions: metafield(namespace: "simple_bundles", key: "variant_options") { id }
            }
          }
        }
      }
    }`,
    { variables: { ids: productIds } },
  );
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join(' '));
  }
  return new Set(
    result.data.nodes
      .filter((product) => product?.variants?.nodes.some((variant) => variant.bundleOptions))
      .map((product) => product.id),
  );
}
