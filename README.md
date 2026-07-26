# Baudie Discounts — Shopify Discount Function

Automatic discount for the **Baudie** storefront, implemented as a Shopify Function (JavaScript compiled to WASM, executed by Shopify at cart evaluation time). Extension-only app — no server.

Works as one half of a two-app system with [baudie-checkout-upsell](https://github.com/nicocantarelli/baudie-checkout-upsell): the checkout extension *shows* the deal, this function *enforces* it — pricing can never depend on client-side code.

Designed and built by Nicolas Cantarelli for Lumios Digital.

## How it works

The cart-lines run discounts **every upsell product down to its per-product deal price, at any quantity — but only while the cart also contains at least one non-upsell product**. A cart of only upsell products gets no discount, so upsell items keep full price on their own product pages and standalone purchases.

- **`custom.upsell_price` metafield contract** — any product carrying the metafield is an upsell product and the value *is* its deal price. New upsell products need zero code: set the metafield and they're covered, each at its own price
- **Qualifier rule** — a product *without* the metafield is a qualifier; at least one must be in the cart for the deal to fire (same rule the checkout extension and theme side-cart use for display)
- **Single-function design** — one function backs one automatic discount that handles every upsell product and quantity at once, sidestepping Shopify's "only one automatic discount applies" conflicts
- **Delivery target is an intentional no-op** — the function can never emit a shipping discount regardless of which discount classes get enabled on the discount node
- **`discount-ui`** — an admin UI extension providing the discount's configuration screen in the Shopify admin

## Structure

```
baudie-discounts/
├── shopify.app.toml                       # App config (extension-only)
└── extensions/
    ├── discount-function/
    │   ├── src/
    │   │   ├── cart_lines_discounts_generate_run.js      # Deal-price logic
    │   │   ├── cart_delivery_options_discounts_generate_run.js  # No-op
    │   │   └── *.graphql                  # Function input queries
    │   └── shopify.extension.toml
    └── discount-ui/
        └── src/DiscountFunctionSettings.jsx   # Admin config UI
```

## Development

```bash
npm install
shopify app dev        # Run against a dev store
shopify app deploy     # Release a new function version
```

## License

All rights reserved. Published as a working reference — Baudie branding and store data belong to Baudie.
