# Baudie Discounts — Shopify Discount Function

Automatic discount for the **Baudie** storefront ([baudie.com](https://baudie.com)), implemented as a Shopify Function (JavaScript compiled to WASM, executed by Shopify at cart evaluation time). Extension-only app — no server.

One discount runs two deals:

- **Upsell deal** — one half of a two-app system with [baudie-checkout-upsell](https://github.com/nicocantarelli/baudie-checkout-upsell): the checkout extension *shows* the deal, this function *enforces* it.
- **Gift with purchase** — the [Baudie theme](https://github.com/nicocantarelli/baudie-shopify-theme)'s cart drawer adds the free gifts, this function makes them free and blocks discount codes while a promo runs.

Pricing never depends on client-side code.

Designed and built by Nicolas Cantarelli.

## How it works

### Upsell deal

The cart-lines run discounts **every upsell product down to its per-product deal price, at any quantity — but only while the cart also contains at least one non-upsell product**. A cart of only upsell products gets no discount, so upsell items keep full price on their own product pages and standalone purchases.

- **`custom.upsell_price` metafield contract** — any product carrying the metafield is an upsell product and the value *is* its deal price. New upsell products need zero code: set the metafield and they're covered, each at its own price
- **Qualifier rule** — a product *without* the metafield is a qualifier; at least one must be in the cart for the deal to fire (same rule the checkout extension and theme side-cart use for display). Subscription lines of regular products count as qualifiers too
- **No stacking with subscriptions** — a *subscribed* upsell line (one with an Appstle selling plan, e.g. wipes on Subscribe & save) is never discounted: it gets only the subscription price. Upsells added from the cart or checkout are always one-time, so they still get the deal
- **Free gifts are left to the gift deal** — a gift line is never upsell-discounted, even when the gift is an upsell product (e.g. free wipes)

### Gift with purchase

Settings live in the **`baudie.gift_promo` shop metafield** (JSON), saved by the settings panel and read by both this function and the theme, so the drawer and checkout always agree.

- **When a promo runs** — status *On* (between the optional start and end dates, whole days compared with `shop.localTime.date`), or *Preview* on a cart carrying the `_gift_preview` attribute (the theme sets it from `?gift_preview=1`). A promo with no tiers never runs
- **Gift lines** — the theme adds each gift with a `_gift` line property: `tier:1`..`tier:3` for spend tiers, `vip:<prefix>` for VIP code gifts. A tier gift goes 100% off only when the cart's non-gift lines reach that tier's spend (pre-discount, × the presentment currency rate), only for the tier's own variant, only up to the tier's quantity, and each tier once, whatever the cart contains
- **No codes during a promo** — every entered code is rejected (`enteredDiscountCodesReject`, Discount Function API 2026-01+) with the panel's message, VIP codes included. Gift cards aren't affected
- **VIP gifts** are priced by the VIP code itself (a regular Shopify discount code, e.g. from Klaviyo); this function only blocks those codes while a promo runs
- **Single-function design** — the upsell deal and the gifts share one automatic discount, so they always apply together: there's no "only one automatic discount applies" conflict and no combination settings to keep in sync. Turning the discount off stops both
- **Checkout rule (`gift-checkout-rule`)** — a backstop for the theme: a gift line must be free at checkout. One that isn't (its promo ended, the spend dropped, the discount is off, its VIP code is gone) blocks payment with a message sending the customer back to their cart, where the theme removes it. That's what catches a checkout reopened later, like an abandoned-checkout email opened after the promo ended. It only checks checkout steps (`buyerJourney.step` = `CHECKOUT_INTERACTION` / `CHECKOUT_COMPLETION`), never cart changes, so the theme's own cart updates always go through, and it covers express payments at checkout too. Validation runs after discounts, so it simply checks each gift line's `totalAmount`. **It has to be turned on once in the admin:** Settings → Checkout → Checkout rules → Add rule → *Gift with purchase check* → turn it on

### Shared

- **Delivery target is an intentional no-op** — the function can never emit a shipping discount regardless of which discount classes get enabled on the discount node
- **`gift-settings`** — the app's own page (Apps → **Baudie Gifts & Deals** in the admin sidebar), an App Home UI extension (`admin.app.home.render`) that Shopify hosts, so there's still no server. It holds the gift with purchase settings (status, dates, up to 3 spend tiers, up to 3 VIP code gifts, blocked-code message) and writes the shop metafield through `shopify.query` with the app's existing scopes. App Home UI extensions are for custom-distribution apps only, which this is.
- **`discount-ui`** — the admin UI extension on the Upsell deal discount's page: explains the upsell deal, keeps the Product class on, and links to the gift settings page.

## Structure

```
baudie-discounts/
├── shopify.app.toml                       # App config (extension-only)
└── extensions/
    ├── discount-function/
    │   ├── src/
    │   │   ├── cart_lines_discounts_generate_run.js      # Runs both deals; upsell deal-price logic
    │   │   ├── gift_with_purchase.js      # Gift tiers, promo status, code rejection
    │   │   ├── cart_delivery_options_discounts_generate_run.js  # No-op
    │   │   └── *.graphql                  # Function input queries
    │   ├── tests/fixtures/                # One input/output pair per rule
    │   └── shopify.extension.toml
    ├── discount-ui/
    │   └── src/
    │       └── DiscountFunctionSettings.jsx   # Upsell deal panel on the discount's page
    ├── gift-settings/
    │   └── src/
    │       ├── AppHome.jsx                # The app's page: gift with purchase settings
    │       └── gift-promo.js              # Load / validate / save the gift settings
    └── gift-checkout-rule/
        ├── src/
        │   └── cart_validations_generate_run.js   # Blocks payment for a gift that isn't free
        └── tests/fixtures/                # One input/output pair per rule
```

## Development

```bash
npm install
shopify app dev        # Run against a dev store (functions from a custom app need a Plus store)
shopify app deploy     # Release a new function version
cd extensions/discount-function && npx vitest run   # Fixture tests (needs `shopify` on PATH)
cd extensions/gift-checkout-rule && npx vitest run  # Same for the checkout rule
```

## License

All rights reserved. Published as a working reference — Baudie branding and store data belong to Baudie.
