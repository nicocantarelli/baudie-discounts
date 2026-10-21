import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { ErrorBoundary, LocationProvider, Route, Router } from "preact-iso";

import GiftPage from "./GiftPage.jsx";
import UpsellPage from "./UpsellPage.jsx";

export default async () => {
  render(<App />, document.body);
};

// The app's own pages in the admin (Apps → Baudie Gifts & Deals), hosted by
// Shopify: Gift with purchase (the home page) and Upsell deals, both listed
// under the app in the admin sidebar.
function App() {
  const { i18n } = shopify;
  return (
    <LocationProvider>
      <s-app-nav>
        <s-link href="/gifts">{i18n.translate("nav.gifts")}</s-link>
        <s-link href="/upsell-deals">{i18n.translate("nav.upsell")}</s-link>
      </s-app-nav>
      <ErrorBoundary>
        <Router>
          <Route path="/" component={GiftPage} />
          <Route path="/gifts" component={GiftPage} />
          <Route path="/upsell-deals" component={UpsellPage} />
          <Route default component={GiftPage} />
        </Router>
      </ErrorBoundary>
    </LocationProvider>
  );
}
