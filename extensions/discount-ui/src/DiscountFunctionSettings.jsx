import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<App />, document.body);
};

// Settings panel shown on the discount's page in the Shopify admin.
//
// This discount needs NO configuration: the deal price for each upsell product
// is read by the function from that product's `custom.upsell_price` metafield.
// So this panel's only job is to (a) explain to the merchant exactly what the
// discount does, and (b) make sure the Product discount class is enabled, which
// is what lets the function's product discounts actually apply.
function App() {
  const { i18n, discounts } = shopify;
  const [error, setError] = useState();

  const discountClasses = discounts?.discountClasses?.value ?? [];
  const productEnabled = discountClasses.includes("product");

  // Foolproof: turn the Product class on by default if it isn't already, so the
  // merchant can't accidentally save a discount that does nothing.
  useEffect(() => {
    if (!productEnabled) {
      Promise.resolve(discounts?.updateDiscountClasses?.(["product"])).catch(
        () => {},
      );
    }
    // run once on mount
  }, []);

  const toggleProduct = async () => {
    const next = productEnabled ? [] : ["product"];
    const result = await discounts?.updateDiscountClasses?.(next);
    if (result && result.success === false) {
      setError(i18n.translate("error"));
    } else {
      setError(undefined);
    }
  };

  // No onSubmit work needed: this discount has no config to persist. The
  // Product class is set live via updateDiscountClasses, and the deal prices
  // come from each product's custom.upsell_price metafield.
  return (
    <s-function-settings>
      <s-heading>{i18n.translate("title")}</s-heading>
      <s-section>
        <s-stack gap="base">
          {error ? <s-banner tone="critical">{error}</s-banner> : null}

          {/* What the discount does */}
          <s-banner tone="info">{i18n.translate("intro")}</s-banner>

          {/* Where the prices come from + how to change them */}
          <s-text>{i18n.translate("pricesNote")}</s-text>

          {/* When it applies */}
          <s-text>{i18n.translate("qualifierNote")}</s-text>

          <s-divider />

          {/* The one (auto-enabled) setting, with a plain explanation below */}
          <s-checkbox
            checked={productEnabled}
            onChange={toggleProduct}
            label={i18n.translate("productLabel")}
          />
          <s-text>{i18n.translate("productHelp")}</s-text>
        </s-stack>
      </s-section>
    </s-function-settings>
  );
}
