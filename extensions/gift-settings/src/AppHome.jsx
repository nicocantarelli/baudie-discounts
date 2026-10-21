import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

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

// The app's own page (Apps → Baudie Gifts & Deals): the gift with purchase
// settings. Status, dates, spend tiers, VIP code gifts and the blocked-code
// message, saved to the `baudie.gift_promo` shop metafield that both the
// discount function and the theme read (see ./gift-promo.js). The Upsell deal
// discount itself only links here.
function App() {
  const { i18n } = shopify;
  const t = (key, replacements) => i18n.translate(`gift.${key}`, replacements);

  const [shop, setShop] = useState(null);
  const [saved, setSaved] = useState(EMPTY_PROMO);
  const [promo, setPromo] = useState(EMPTY_PROMO);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadGiftPromo()
      .then(({ shop, promo }) => {
        setShop(shop);
        setSaved(promo);
        setPromo(promo);
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  const dirty = JSON.stringify(promo) !== JSON.stringify(saved);

  const save = async () => {
    if (!shop || !dirty || saving) return;
    const problem = validateGiftPromo(promo);
    if (problem) {
      setNotice({ tone: "critical", text: t(problem) });
      return;
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
      setNotice({ tone: "success", text: t("saved") });
      shopify.toast?.show(t("savedToast"));
    } catch (error) {
      setNotice({ tone: "critical", text: t("saveError", { error: error.message }) });
    } finally {
      setSaving(false);
    }
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
      <s-page heading={t("heading")}>
        <s-section>
          <s-banner tone="critical">{t("loadError", { error: loadError })}</s-banner>
        </s-section>
      </s-page>
    );
  }
  if (!shop) {
    return (
      <s-page heading={t("heading")}>
        <s-section>
          <s-spinner accessibilityLabel={t("loading")} />
        </s-section>
      </s-page>
    );
  }

  const previewUrl = `${shop.url}/?gift_preview=1`;
  const saveButton = (props) => (
    <s-button
      {...props}
      variant="primary"
      disabled={!dirty || saving}
      loading={saving}
      onClick={save}
    >
      {t("save")}
    </s-button>
  );

  return (
    <s-page heading={t("heading")}>
      {saveButton({ slot: "primary-action" })}

      {/* How it works, beside the settings */}
      <s-section slot="aside" heading={t("howHeading")}>
        <s-stack gap="base">
          <s-paragraph>{t("howCart")}</s-paragraph>
          <s-paragraph>{t("howCheckout")}</s-paragraph>
          <s-paragraph>{t("howCodes")}</s-paragraph>
          <s-paragraph>{t("howLook")}</s-paragraph>
        </s-stack>
      </s-section>

      {notice ? (
        <s-banner tone={notice.tone} dismissible onDismiss={() => setNotice(null)}>
          {notice.text}
        </s-banner>
      ) : null}

      {/* Status + dates */}
      <s-section heading={t("promoHeading")}>
        <s-stack gap="base">
          <s-select
            label={t("status")}
            value={promo.status}
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
              onChange={(event) => update({ startDate: event.currentTarget.value })}
            />
            <s-date-field
              label={t("endDate")}
              value={promo.endDate}
              onChange={(event) => update({ endDate: event.currentTarget.value })}
            />
          </s-grid>
          <s-text color="subdued">{t("datesHelp", { timezone: shop.timezone })}</s-text>
        </s-stack>
      </s-section>

      {/* Spend tiers */}
      <s-section heading={t("tiersHeading")}>
        <s-stack gap="base">
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
        </s-stack>
      </s-section>

      {/* VIP code gifts */}
      <s-section heading={t("vipHeading")}>
        <s-stack gap="base">
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
        </s-stack>
      </s-section>

      {/* Message for codes entered during a promo */}
      <s-section heading={t("codesHeading")}>
        <s-text-area
          label={t("codesMessage")}
          details={t("codesMessageHelp")}
          placeholder={t("codesMessagePlaceholder")}
          rows={2}
          value={promo.codesBlockedMessage}
          onChange={(event) =>
            update({ codesBlockedMessage: event.currentTarget.value })
          }
        />
      </s-section>

      {/* Save again at the bottom: the form is long */}
      <s-stack direction="inline" gap="base" alignItems="center" justifyContent="end">
        {dirty ? <s-text color="subdued">{t("unsaved")}</s-text> : null}
        {saveButton({})}
      </s-stack>
    </s-page>
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
