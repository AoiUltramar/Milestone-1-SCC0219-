/* ==========================================================================
   shared/config.js — constants used by BOTH the browser and the server
   --------------------------------------------------------------------------
   One file, two readers: the server loads it with require(), the browser
   loads it with a <script> tag and finds it in window.CCConfig. Keeping the
   product options and subscription terms in a single place means the
   <select> boxes, the WebMCP schemas and the server validation can never
   disagree.
   ========================================================================== */

(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();   // Node.js
    else root.CCConfig = factory();                                                  // browser
})(typeof self !== "undefined" ? self : this, function () {
    return {
        // Purchase choices each category carries in the cart (requirement 18).
        // The first value of every list is the default.
        CATEGORIES: {
            vms:    { name: "Virtual machines", meta: "Virtual machine",
                      options: { "Data center": ["São Paulo", "Rio de Janeiro", "Fortaleza"],
                                 "OS": ["Ubuntu 24.04 LTS", "Debian 12", "Fedora 40", "Rocky Linux 9"] } },
            vpn:    { name: "VPN",              meta: "VPN",
                      options: { "Exit country": ["Brazil", "United States", "Portugal", "Germany", "Japan"] } },
            addons: { name: "Add-ons",          meta: "Add-on", options: {} },
        },
        // Prepaid subscription terms, in months.
        DURATIONS: [1, 3, 12],
        // The free trial (our own feature): which plan and for how long.
        TRIAL_DAYS: 14,
        TRIAL_PRODUCT_ID: "standard-vm",
    };
});
