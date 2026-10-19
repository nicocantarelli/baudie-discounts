import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import {
  EMPTY_PROMO,
  MAX_TIERS,
  MAX_VIP_GIFTS,
  loadGiftPromo,
  pickGift,
  saveGiftPromo,
  validateGiftPromo,
} from "./gift-promo";

export default async () => {
  render(<App />, document.body);
};

// Settings panel shown on the discount's page in the Shopify admin. The one
// discount runs both deals, so the panel has a section for each:
//
// - Upsell deal: needs NO configuration. The deal price for each upsell product
//   is read by the function from that product's `custom.upsell_price`
//   metafield, so this section only explains the deal and keeps the Product
//   discount class enabled (which lets the function's discounts apply).
// - Gift with purchase: the promo's status, dates, gift tiers, VIP code gifts
//   and blocked-code message, saved to the `baudie.gift_promo` shop metafield
//   that both the function and the theme read (see ./gift-promo.js).
function App() {
  const { i18n, discounts } = shopify;
  const [error, setError] = useState();
  const giftSave = useRef(null);
  const giftReset = useRef(null);

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

  // The upsell has no config to persist (the Product class is set live via
  // updateDiscountClasses). Saving the discount also saves any unsaved gift
  // settings; if they're invalid, the admin shows the error and doesn't save.
  return (
    <s-function-settings
      onSubmit={(event) => {
        if (giftSave.current) event.waitUntil?.(giftSave.current());
      }}
      onReset={() => giftReset.current?.()}
    >
      <s-heading>{i18n.translate("title")}</s-heading>
      <s-section heading={i18n.translate("upsellHeading")}>
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

      <GiftPromoSection saveRef={giftSave} resetRef={giftReset} />
    </s-function-settings>
  );
}

function GiftPromoSection({ saveRef, resetRef }) {
  const { i18n } = shopify;
  const t = (key, replacements) => i18n.translate(`gift.${key}`, replacements);

  const [shop, setShop] = useState(null);
  const [saved, setSaved] = useState(EMPTY_PROMO);
  const [promo, setPromo] = useState(EMPTY_PROMO);
  // Bumped after each save so the fields remount with the saved values as
  // their defaults, which clears the admin's unsaved-changes bar.
  const [savedVersion, setSavedVersion] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadGiftPromo()
      .then(({ shop, promo }) => {
        setShop(shop);
        setSaved(promo);
        setPromo(promo);
        setSavedVersion((version) => version + 1);
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  const dirty = JSON.stringify(promo) !== JSON.stringify(saved);

  // Shared by the "Save gift settings" button and the discount's own Save.
  const save = async () => {
    if (!shop || !dirty) return;
    const problem = validateGiftPromo(promo);
    if (problem) {
      const message = t(problem);
      setNotice({ tone: "critical", text: message });
      throw new Error(message);
    }
    // Tiers are kept lowest spend first, so "tier 1" always means the first
    // gift a customer reaches (the theme and the function count them that way).
    const sorted = {
      ...promo,
      tiers: [...promo.tiers].sort(
        (a, b) => parseFloat(a.minimum) - parseFloat(b.minimum),
      ),
    };
    setSaving(true);
    try {
      await saveGiftPromo(sorted, shop);
      setPromo(sorted);
      setSaved(sorted);
      setSavedVersion((version) => version + 1);
      setNotice({ tone: "success", text: t("saved") });
    } catch (error) {
      const message = t("saveError", { error: error.message });
      setNotice({ tone: "critical", text: message });
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;
  resetRef.current = () => {
    setPromo(saved);
    setNotice(null);
    setSavedVersion((version) => version + 1);
  };

  const update = (changes) => {
    setPromo((current) => ({ ...current, ...changes }));
    setNotice(null);
  };
  const updateRow = (listKey, index, changes) =>
    update({
      [listKey]: promo[listKey].map((row, i) =>
        i === index ? { ...row, ...changes } : row,
      ),
    });
  const removeRow = (listKey, index) =>
    update({ [listKey]: promo[listKey].filter((_, i) => i !== index) });

  if (loadError) {
    return (
      <s-section heading={t("heading")}>
        <s-banner tone="critical">{t("loadError", { error: loadError })}</s-banner>
      </s-section>
    );
  }
  if (!shop) {
    return (
      <s-section heading={t("heading")}>
        <s-spinner accessibilityLabel={t("loading")} />
      </s-section>
    );
  }

  const previewUrl = `${shop.url}/?gift_preview=1`;

  return (
    <s-section heading={t("heading")} key={savedVersion}>
      <s-stack gap="base">
        <s-paragraph>{t("intro")}</s-paragraph>

        {notice ? <s-banner tone={notice.tone}>{notice.text}</s-banner> : null}

        {/* Status + dates */}
        <s-select
          label={t("status")}
          value={promo.status}
          defaultValue={saved.status}
          onChange={(event) => update({ status: event.currentTarget.value })}
        >
          <s-option value="off">{t("statusOff")}</s-option>
          <s-option value="preview">{t("statusPreview")}</s-option>
          <s-option value="on">{t("statusOn")}</s-option>
        </s-select>
        {promo.status === "preview" ? (
          <s-banner tone="info">
            <s-paragraph>{t("previewHelp")}</s-paragraph>
            <s-link href={previewUrl} target="_blank">
              {previewUrl}
            </s-link>
          </s-banner>
        ) : null}

        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-date-field
            label={t("startDate")}
            value={promo.startDate}
            defaultValue={saved.startDate}
            onChange={(event) => update({ startDate: event.currentTarget.value })}
          />
          <s-date-field
            label={t("endDate")}
            value={promo.endDate}
            defaultValue={saved.endDate}
            onChange={(event) => update({ endDate: event.currentTarget.value })}
          />
        </s-grid>
        <s-text color="subdued">{t("datesHelp", { timezone: shop.timezone })}</s-text>

        <s-divider />

        {/* Spend tiers */}
        <s-heading>{t("tiersHeading")}</s-heading>
        <s-text color="subdued">{t("tiersHelp")}</s-text>
        {promo.tiers.map((tier, index) => (
          <s-box key={index} padding="base" border="base" borderRadius="base">
            <s-stack gap="base">
              <RowHeader
                title={t("tierTitle", { number: index + 1 })}
                removeLabel={t("removeTier", { number: index + 1 })}
                onRemove={() => removeRow("tiers", index)}
              />
              <s-grid gridTemplateColumns="2fr 1fr" gap="base">
                <s-number-field
                  label={t("tierAmount")}
                  prefix="$"
                  min={0}
                  step={0.01}
                  value={tier.minimum}
                  onChange={(event) =>
                    updateRow("tiers", index, { minimum: event.currentTarget.value })
                  }
                />
                <s-number-field
                  label={t("quantity")}
                  min={1}
                  step={1}
                  value={tier.quantity}
                  onChange={(event) =>
                    updateRow("tiers", index, { quantity: event.currentTarget.value })
                  }
                />
              </s-grid>
              <GiftPicker
                gift={tier.gift}
                onPick={(gift) => updateRow("tiers", index, { gift })}
              />
            </s-stack>
          </s-box>
        ))}
        {promo.tiers.length < MAX_TIERS ? (
          <s-button
            onClick={() =>
              update({
                tiers: [...promo.tiers, { minimum: "", quantity: "1", gift: null }],
              })
            }
          >
            {promo.tiers.length ? t("addTier") : t("addFirstTier")}
          </s-button>
        ) : null}

        <s-divider />

        {/* VIP code gifts */}
        <s-heading>{t("vipHeading")}</s-heading>
        <s-text color="subdued">{t("vipHelp")}</s-text>
        {promo.vip.map((row, index) => (
          <s-box key={index} padding="base" border="base" borderRadius="base">
            <s-stack gap="base">
              <RowHeader
                title={t("vipTitle", { number: index + 1 })}
                removeLabel={t("removeVip", { number: index + 1 })}
                onRemove={() => removeRow("vip", index)}
              />
              <s-grid gridTemplateColumns="2fr 1fr" gap="base">
                <s-text-field
                  label={t("vipPrefix")}
                  details={t("vipPrefixHelp")}
                  value={row.prefix}
                  onChange={(event) =>
                    updateRow("vip", index, { prefix: event.currentTarget.value })
                  }
                />
                <s-number-field
                  label={t("quantity")}
                  min={1}
                  step={1}
                  value={row.quantity}
                  onChange={(event) =>
                    updateRow("vip", index, { quantity: event.currentTarget.value })
                  }
                />
              </s-grid>
              <GiftPicker
                gift={row.gift}
                onPick={(gift) => updateRow("vip", index, { gift })}
              />
            </s-stack>
          </s-box>
        ))}
        {promo.vip.length < MAX_VIP_GIFTS ? (
          <s-button
            onClick={() =>
              update({
                vip: [...promo.vip, { prefix: "", quantity: "1", gift: null }],
              })
            }
          >
            {t("addVip")}
          </s-button>
        ) : null}

        <s-divider />

        {/* Message for codes entered during a promo */}
        <s-text-area
          label={t("codesMessage")}
          details={t("codesMessageHelp")}
          placeholder={t("codesMessagePlaceholder")}
          rows={2}
          value={promo.codesBlockedMessage}
          defaultValue={saved.codesBlockedMessage}
          onChange={(event) =>
            update({ codesBlockedMessage: event.currentTarget.value })
          }
        />

        {/* Tracks the whole promo (rows and picked gifts included) so the
            admin's unsaved-changes bar appears for any gift change. */}
        <s-box display="none">
          <s-text-field
            label={t("heading")}
            labelAccessibilityVisibility="exclusive"
            value={JSON.stringify(promo)}
            defaultValue={JSON.stringify(saved)}
          />
        </s-box>

        <s-stack direction="inline" gap="base" alignItems="center">
          <s-button
            variant="primary"
            disabled={!dirty || saving}
            loading={saving}
            onClick={() => save().catch(() => {})}
          >
            {t("save")}
          </s-button>
          {dirty ? <s-text color="subdued">{t("unsaved")}</s-text> : null}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function RowHeader({ title, removeLabel, onRemove }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" alignItems="center">
      <s-text type="strong">{title}</s-text>
      <s-button
        variant="tertiary"
        tone="critical"
        icon="delete"
        accessibilityLabel={removeLabel}
        onClick={onRemove}
      />
    </s-stack>
  );
}

function GiftPicker({ gift, onPick }) {
  const { i18n } = shopify;
  const choose = async () => {
    const picked = await pickGift(gift);
    if (picked) onPick(picked);
  };

  if (!gift) {
    return (
      <s-button onClick={choose} icon="product">
        {i18n.translate("gift.chooseGift")}
      </s-button>
    );
  }
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      {gift.image ? <s-thumbnail src={gift.image} alt={gift.title} size="small" /> : null}
      <s-text>{gift.title}</s-text>
      <s-button variant="tertiary" onClick={choose}>
        {i18n.translate("gift.changeGift")}
      </s-button>
    </s-stack>
  );
}
