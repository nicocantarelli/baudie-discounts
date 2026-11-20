// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

/**
 * The option groups this rule reads, by name, and the alias each one has in
 * the input query (src/cart_validations_generate_run.graphql). They're the
 * names the theme sends: "Wipes" and "Scents" for the Essentials Duo
 * (sections/product-bundle-duo.liquid), "First Scent" to "Third Scent" for the
 * Bundle of 3 (sections/product-bundle.liquid). The two lists must match.
 */
export const OPTION_ATTRIBUTES = {
  Wipes: 'wipes',
  Scents: 'scents',
  'First Scent': 'firstScent',
  'Second Scent': 'secondScent',
  'Third Scent': 'thirdScent',
};

/**
 * The option group names of a pick-your-scent bundle, from its
 * `simple_bundles.variant_options` metafield, or null for any other variant.
 *
 * @param {unknown} value The metafield's jsonValue.
 * @returns {string[] | null}
 */
export function bundleOptionNames(value) {
  let groups = value;
  if (typeof groups === 'string') {
    try {
      groups = JSON.parse(groups);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(groups)) return null;
  const names = groups
    .map((group) => (group && typeof group.optionName === 'string' ? group.optionName.trim() : ''))
    .filter(Boolean);
  return names.length ? names : null;
}

/** @param {{ value?: string | null } | null | undefined} attribute */
function filled(attribute) {
  return typeof attribute?.value === 'string' && attribute.value.trim() !== '';
}

/**
 * Whether a bundle line is missing one of its picks. An option group this rule
 * has no alias for can't be read, so it counts as picked when the line carries
 * the "_bundle_selection" summary, which every add from the theme or the app's
 * own widget does. A bare line (Buy again, a cart link) has neither.
 *
 * @param {Record<string, any>} line
 * @param {string[]} names
 */
export function missingPicks(line, names) {
  return names.some((name) => {
    const alias = OPTION_ATTRIBUTES[/** @type {keyof typeof OPTION_ATTRIBUTES} */ (name)];
    return alias ? !filled(line[alias]) : !filled(line.bundleSelection);
  });
}

/**
 * "Your Essentials Duo is missing its scent. ..." Built from the product
 * title (without a leading "The"), and "scents" when the bundle has more than
 * one scent to pick.
 *
 * @param {string} title
 * @param {string[]} names
 */
export function missingPicksMessage(title, names) {
  const bundle = title.replace(/^the\s+/i, '').trim() || 'bundle';
  const scentGroups = names.filter((name) => /scent/i.test(name)).length;
  const picks = scentGroups > 1 ? 'scents' : scentGroups === 1 ? 'scent' : 'options';
  return `Your ${bundle} is missing its ${picks}. Please remove it and add it again from its product page.`;
}

/**
 * Pick-your-scent bundle check: a Simple Bundles "Infinite options" bundle
 * (the Essentials Duo, the Bundle of 3) only expands into the products the
 * 3PL ships when its line carries one property per option group, the picks.
 * Shopify's Buy again, cart links and any bare add rebuild the line from the
 * variant and quantity alone, so the order comes in as one parent line with
 * no SKU. This blocks payment for such a line, asking the customer to add the
 * bundle again from its product page.
 *
 * A line is a bundle when its variant has the `simple_bundles.variant_options`
 * metafield; every option group named there needs a non-empty property. So a
 * new pick bundle is covered without a code change, and a bundle that moves to
 * one variant per pick (a fixed bundle, which has no such metafield) drops out
 * on its own.
 *
 * Validation runs after Simple Bundles' Cart Transform. A bundle the transform
 * expanded is never a problem either way: its parent line carries the picks,
 * and its component lines are plain products without the metafield. One it
 * couldn't expand is still the bare parent, with no properties, and is caught.
 *
 * Like the gift check, only checkout steps are checked, never cart changes, so
 * the theme's cart updates always go through.
 *
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const step = input.buyerJourney?.step;
  if (step !== 'CHECKOUT_INTERACTION' && step !== 'CHECKOUT_COMPLETION') {
    return { operations: [] };
  }

  /** @type {Set<string>} */
  const messages = new Set();
  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    if (merchandise.__typename !== 'ProductVariant') continue;
    const names = bundleOptionNames(merchandise.bundleOptions?.jsonValue);
    if (!names || !missingPicks(line, names)) continue;
    messages.add(missingPicksMessage(merchandise.product.title, names));
  }
  if (messages.size === 0) return { operations: [] };

  return {
    operations: [
      {
        validationAdd: {
          errors: [...messages].map((message) => ({ message, target: '$.cart' }))
        }
      }
    ]
  };
}
