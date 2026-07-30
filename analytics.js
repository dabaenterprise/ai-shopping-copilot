/* Measurement for the landing page, the post-install welcome view and the
   Stripe success page.

   Nothing loads and no request is made until the IDs below are filled in, so a
   half-configured deploy stays silent instead of firing junk conversions.

   Three conversions, matching the three things worth knowing:

     store click — clicks through to the Chrome Web Store listing. Needed as the
                   denominator for install rate: the store page belongs to
                   Google, so the visit itself is invisible to us.
     install     — the ?welcome=1 tab the extension opens on first run. This is
                   the only point at which an install is observable at all. It
                   attributes to the ad because that tab opens on this same
                   domain, so the first-party _gcl_aw cookie written during the
                   ad click is still readable. Organic installs land here too,
                   but Ads only counts the ones carrying a click id.
     purchase    — the Stripe success page, carrying the plan's value.

   If you later advertise into the UK or EEA you will need Consent Mode v2 and a
   consent banner before this may run there; it is not implemented here because
   the first campaigns are Australia-only.
*/
(function () {
  "use strict";

  // ── Paste the real IDs here. An empty string leaves that piece switched off. ─
  var CONFIG = {
    ga4Id: "",            // GA4 measurement ID, e.g. "G-ABCD123456"
    adsId: "",            // Google Ads conversion ID, e.g. "AW-1234567890"

    // Conversion labels from Google Ads — the part after the slash in the
    // send_to value Ads shows you, e.g. "AbC-D_efG-h12_34-567".
    installLabel: "",
    purchaseLabel: "",
    storeClickLabel: "",

    currency: "USD",      // must match the currency your Stripe prices are in
    planValues: { monthly: 7, yearly: 49 }
  };

  function isSet(v) { return typeof v === "string" && v.length > 0; }

  function planValue(plan) {
    return CONFIG.planValues[plan] != null
      ? CONFIG.planValues[plan]
      : CONFIG.planValues.monthly;
  }

  // Callers should never have to care whether measurement is configured, so the
  // public API exists either way and simply does nothing until it is.
  window.DABA_TRACK = {
    purchase: function () {},
    beginCheckout: function () {}
  };

  var hasGa4 = isSet(CONFIG.ga4Id);
  var hasAds = isSet(CONFIG.adsId);
  if (!hasGa4 && !hasAds) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("js", new Date());
  if (hasGa4) gtag("config", CONFIG.ga4Id);
  if (hasAds) gtag("config", CONFIG.adsId);

  var tag = document.createElement("script");
  tag.async = true;
  tag.src = "https://www.googletagmanager.com/gtag/js?id=" +
            encodeURIComponent(hasGa4 ? CONFIG.ga4Id : CONFIG.adsId);
  document.head.appendChild(tag);

  function adsConversion(label, extra) {
    if (!hasAds || !isSet(label)) return;
    var payload = { send_to: CONFIG.adsId + "/" + label };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      }
    }
    gtag("event", "conversion", payload);
  }

  function ga4Event(name, params) {
    if (hasGa4) gtag("event", name, params || {});
  }

  // The welcome tab can be reloaded, bookmarked or restored on browser restart,
  // any of which would otherwise count as another install.
  function firstTimeOnly(key) {
    try {
      if (localStorage.getItem(key)) return false;
      localStorage.setItem(key, String(Date.now()));
      return true;
    } catch (e) {
      return true; // private mode has no storage — counting once beats never
    }
  }

  // ── Install ───────────────────────────────────────────────────────────────
  // background.js opens this URL on reason === "install" only; the update path
  // opens extension-privacy-update.html, so upgrades cannot land here.
  var query = new URLSearchParams(location.search);
  if (query.get("welcome") === "1" && firstTimeOnly("daba_conv_install_v1")) {
    adsConversion(CONFIG.installLabel);
    ga4Event("extension_installed");
  }

  // ── Store clicks ──────────────────────────────────────────────────────────
  function bindStoreClicks() {
    var links = document.querySelectorAll(
      'a[href*="chromewebstore.google.com"], a[href*="chrome.google.com/webstore"]'
    );
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("click", function () {
        adsConversion(CONFIG.storeClickLabel);
        ga4Event("store_click");
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindStoreClicks);
  } else {
    bindStoreClicks();
  }

  // ── Purchase and checkout start ───────────────────────────────────────────
  window.DABA_TRACK = {
    // Called only once a licence key actually exists, so a payment that fails
    // to activate is never counted as a sale. Stripe's session id doubles as
    // the dedup key: Ads and GA4 both ignore a repeated transaction_id, so a
    // reload or a shared link cannot inflate revenue.
    purchase: function (plan, sessionId) {
      var value = planValue(plan);
      adsConversion(CONFIG.purchaseLabel, {
        value: value,
        currency: CONFIG.currency,
        transaction_id: sessionId || ""
      });
      ga4Event("purchase", {
        transaction_id: sessionId || "",
        value: value,
        currency: CONFIG.currency,
        items: [{
          item_id: "pro_" + plan,
          item_name: "Pro " + plan,
          price: value,
          quantity: 1
        }]
      });
    },

    // Not a conversion — this is how you tell a dead checkout button apart from
    // people abandoning Stripe.
    beginCheckout: function (plan) {
      ga4Event("begin_checkout", {
        value: planValue(plan),
        currency: CONFIG.currency,
        items: [{ item_id: "pro_" + plan, item_name: "Pro " + plan }]
      });
    }
  };
})();
