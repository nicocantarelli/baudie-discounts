import { useEffect, useState } from "preact/hooks";

import {
  loadUpsellDeals,
  pickUpsellProducts,
  saveUpsellDeals,
  validateUpsellDeals,
} from "./upsell-deals";

// Upsell deals page (Apps → Baudie Gifts & Deals → Upsell deals): the
// products on the deal and their deal prices (the `custom.upsell_price`
// metafield on each product), plus the discount that runs the deal.
export default function UpsellPage() {
  const { i18n } = shopify;
  const t = (key, replacements) => i18n.translate(`upsell.${key}`, replacements);

  const [loaded, setLoaded] = useState(false);
  const [discount, setDiscount] = useState(null);
  const [saved, setSaved] = useState([]);
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadUpsellDeals()
      .then(({ rows, discount }) => {
        setSaved(rows);
        setRows(rows);
        setDiscount(discount);
        setLoaded(true);
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  const save = async () => {
    if (!dirty || saving) return;
    const problem = validateUpsellDeals(rows);
    if (problem) {
      setNotice({ tone: "critical", text: t(problem) });
      return;
    }
    setSaving(true);
    try {
      await saveUpsellDeals(rows, saved);
      setSaved(rows);
      setNotice({ tone: "success", text: t("saved") });
      shopify.toast?.show(t("savedToast"));
    } catch (error) {
      setNotice({ tone: "critical", text: t("saveError", { error: error.message }) });
    } finally {
      setSaving(false);
    }
  };

  const updateRow = (index, changes) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...changes } : row)));
    setNotice(null);
  };
  const removeRow = (index) => {
    setRows((current) => current.filter((_, i) => i !== index));
    setNotice(null);
  };
  const addProducts = async () => {
    const added = await pickUpsellProducts(rows.map((row) => row.productId));
    if (added.length) {
      setRows((current) => [...current, ...added]);
      setNotice(null);
    }
  };

  if (loadError) {
    return (
      <s-page heading={t("heading")}>
        <s-section>
          <s-banner tone="critical">{t("loadError", { error: loadError })}</s-banner>
        </s-section>
      </s-page>
    );
  }
  if (!loaded) {
    return (
      <s-page heading={t("heading")}>
        <s-section>
          <s-spinner accessibilityLabel={t("loading")} />
        </s-section>
      </s-page>
    );
  }

  const dollars = (value) => `$${parseFloat(value).toFixed(2)}`;
  const saveButton = (props) => (
    <s-button {...props} variant="primary" disabled={!dirty || saving} loading={saving} onClick={save}>
      {t("save")}
    </s-button>
  );

  return (
    <s-page heading={t("heading")}>
      {saveButton({ slot: "primary-action" })}

      {/* How the deal works, beside the settings */}
      <s-section slot="aside" heading={t("howHeading")}>
        <s-stack gap="base">
          <s-paragraph>{t("howDeal")}</s-paragraph>
          <s-paragraph>{t("howQualifier")}</s-paragraph>
          <s-paragraph>{t("howExceptions")}</s-paragraph>
          <s-paragraph>{t("howWhere")}</s-paragraph>
        </s-stack>
      </s-section>

      {notice ? (
        <s-banner tone={notice.tone} dismissible onDismiss={() => setNotice(null)}>
          {notice.text}
        </s-banner>
      ) : null}

      {/* The discount that runs the deal */}
      <s-section heading={t("discountHeading")}>
        {discount ? (
          <s-stack gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text type="strong">{discount.title}</s-text>
              <s-badge tone={discount.status === "ACTIVE" ? "success" : "warning"}>
                {t(`status.${discount.status}`) || discount.status}
              </s-badge>
              <s-button variant="tertiary" href={discount.adminUrl}>
                {t("openDiscount")}
              </s-button>
            </s-stack>
            <s-text color="subdued">{t("discountHelp")}</s-text>
          </s-stack>
        ) : (
          <s-banner tone="warning">{t("noDiscount")}</s-banner>
        )}
      </s-section>

      {/* The products on the deal */}
      <s-section heading={t("productsHeading")}>
        <s-stack gap="base">
          <s-text color="subdued">{t("productsHelp")}</s-text>
          {rows.length === 0 ? <s-paragraph>{t("empty")}</s-paragraph> : null}
          {rows.map((row, index) => {
            const deal = parseFloat(row.dealPrice);
            const price = row.price !== null ? parseFloat(row.price) : null;
            const saving = price !== null && deal > 0 && deal < price ? price - deal : null;
            return (
              <s-box key={row.productId} padding="base" border="base" borderRadius="base">
                <s-stack gap="base">
                  <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                    <s-stack direction="inline" gap="base" alignItems="center">
                      {row.image ? <s-thumbnail src={row.image} alt={row.title} size="small" /> : null}
                      <s-stack gap="small-200">
                        <s-text type="strong">{row.title}</s-text>
                        {price !== null ? (
                          <s-text color="subdued">{t("regularPrice", { price: dollars(price) })}</s-text>
                        ) : null}
                      </s-stack>
                      {row.status && row.status !== "ACTIVE" ? (
                        <s-badge tone="warning">{t("notActive")}</s-badge>
                      ) : null}
                    </s-stack>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      icon="delete"
                      accessibilityLabel={t("remove", { title: row.title })}
                      onClick={() => removeRow(index)}
                    />
                  </s-stack>
                  <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="end">
                    <s-number-field
                      label={t("dealPrice")}
                      prefix="$"
                      min={0}
                      step={0.01}
                      value={row.dealPrice}
                      onChange={(event) => updateRow(index, { dealPrice: event.currentTarget.value })}
                    />
                    <s-text color="subdued">
                      {saving !== null
                        ? t("saves", { amount: dollars(saving), percent: Math.round((saving / price) * 100) })
                        : ""}
                    </s-text>
                  </s-grid>
                </s-stack>
              </s-box>
            );
          })}
          <s-button icon="plus" onClick={addProducts}>
            {t("addProducts")}
          </s-button>
        </s-stack>
      </s-section>

      {/* Save again at the bottom */}
      <s-stack direction="inline" gap="base" alignItems="center" justifyContent="end">
        {dirty ? <s-text color="subdued">{t("unsaved")}</s-text> : null}
        {saveButton({})}
      </s-stack>
    </s-page>
  );
}
