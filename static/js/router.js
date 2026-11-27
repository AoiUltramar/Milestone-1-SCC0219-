/* ==========================================================================
   router.js — the single-page application's router
   --------------------------------------------------------------------------
   index.html is the only page. When the address changes (a click on a link,
   the Back button, Router.go()), the router:
     1. stops the previous screen (removes its event listeners);
     2. checks the route's access rule (role) and redirects to sign-in if needed;
     3. loads the screen's HTML from /static/views/<name>.html and puts it
        inside <main id="app">;
     4. runs the screen's script, registered as  Views.<name> = async ctx => {...}.
   The address bar changes with the History API (no page reload, no #). The
   server answers index.html for every route, so reloading or sharing a link
   such as /admin/products works.
   ========================================================================== */

// Each screen script registers itself here: Views.cart = async ({ signal }) => { ... }
const Views = {};

const Router = (() => {
    // path        the address
    // fragment    HTML file in /static/views/ (without .html)
    // view        script in Views to run after the HTML is in place (optional)
    // role        "admin" or "customer" when the screen is restricted
    const ROUTES = [
        { path: "/",                 fragment: "index",           view: "catalog",        title: "Cache & Carry · Cloud servers & VPN" },
        { path: "/vms",              fragment: "vms",             view: "catalog",        title: "Virtual machines · Cache & Carry" },
        { path: "/vpn",              fragment: "vpn",             view: "catalog",        title: "VPN · Cache & Carry" },
        { path: "/addons",           fragment: "addons",          view: "catalog",        title: "Add-ons · Cache & Carry" },
        { path: "/cart",             fragment: "cart",            view: "cart",           title: "Cart · Cache & Carry" },
        { path: "/login",            fragment: "login",           view: "login",          title: "Sign in · Cache & Carry" },
        { path: "/about",            fragment: "about",                                    title: "About us · Cache & Carry" },
        { path: "/trial",            fragment: "trial",           view: "trial",          title: "Free VM trial · Cache & Carry" },
        { path: "/account",          fragment: "account",         view: "account",        title: "My account · Cache & Carry", role: "customer" },
        { path: "/admin/products",   fragment: "admin-products",  view: "adminProducts",  title: "Admin · Products · Cache & Carry", role: "admin" },
        { path: "/admin/users",      fragment: "admin-users",     view: "adminUsers",     title: "Admin · Users · Cache & Carry", role: "admin" },
        { path: "/admin/dashboard",  fragment: "admin-dashboard", view: "adminDashboard", title: "Admin · Dashboard · Cache & Carry", role: "admin" },
    ];
    const NOT_FOUND = { fragment: null, title: "Page not found · Cache & Carry" };

    const fragments = new Map();          // path -> HTML text (each file is fetched once)
    let current = null;                   // { controller, cleanup } of the screen on display
    let token = 0;                        // lets a newer navigation cancel an older one still loading

    const normalize = path => (path.length > 1 ? path.replace(/\/+$/, "") : path);
    const find = path => ROUTES.find(r => r.path === normalize(path));

    /* ---------- Access rules (used by Auth and by the login screen) ---------- */
    const roleFor = path => find(String(path).split(/[?#]/)[0])?.role ?? null;
    const canOpen = (user, path) => !roleFor(path) || user?.role === roleFor(path);
    const homeFor = user => (user.role === "admin" ? "/admin/products" : "/account");
    // Only addresses that belong to this application, never another site.
    const isInternal = target => typeof target === "string" && /^\/(?!\/)[\w/-]*(\?[\w=&%.-]*)?$/.test(target);

    /* ---------- Showing a screen ---------- */
    async function loadFragment(name) {
        if (!fragments.has(name)) {
            const response = await fetch(`/static/views/${name}.html`);
            if (!response.ok) throw new Error("Could not load the page.");
            fragments.set(name, await response.text());
        }
        return fragments.get(name);
    }

    // Marks the link of the current screen with aria-current="page" (screen
    // readers announce it; the CSS highlights it).
    function markCurrentLinks() {
        const here = normalize(location.pathname);
        document.querySelectorAll(".site-header a[href], .aisles a[href], .site-footer a[href]").forEach(a => {
            const target = normalize(new URL(a.href, location.origin).pathname);
            const isAdminHome = a.dataset.auth === "home" && here.startsWith("/admin/");
            if (target === here || isAdminHome) a.setAttribute("aria-current", "page");
            else a.removeAttribute("aria-current");
        });
    }

    async function render() {
        const mine = ++token;
        const app = document.getElementById("app");

        // 1) Stop the previous screen.
        if (current) {
            current.controller.abort();                // removes every listener added with { signal }
            try { current.cleanup?.(); } catch (err) { console.error(err); }
            current = null;
        }

        const route = find(location.pathname) ?? NOT_FOUND;

        // 2) Access rule.
        if (route.role) {
            const user = await Auth.currentUser();
            if (mine !== token) return;
            if (user?.role !== route.role) {
                // To the sign-in screen, and back here afterwards. `replace` keeps the
                // forbidden address out of the history, so Back doesn't bounce.
                history.replaceState({}, "", "/login?next=" + encodeURIComponent(location.pathname + location.search));
                return render();
            }
        }

        // 3) The screen's HTML.
        let html;
        try {
            html = route.fragment ? await loadFragment(route.fragment)
                                  : `<div class="wrap"><div class="page-head"><h1>Page not found</h1><p>There is nothing at this address. <a href="/">Go to the home page</a>.</p></div></div>`;
        } catch (err) {
            html = `<div class="wrap"><div class="notice warn" role="alert">${err.message}</div></div>`;
        }
        if (mine !== token) return;
        app.innerHTML = html;
        document.title = route.title;
        markCurrentLinks();

        // 4) Move the reader to the new screen: top of the page (or the #anchor),
        //    and keyboard/screen-reader focus on its heading.
        window.scrollTo(0, 0);
        const heading = app.querySelector("h1");
        if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }

        // 5) The screen's script.
        const controller = new AbortController();
        current = { controller, cleanup: null };
        if (route.view && Views[route.view]) {
            try {
                const cleanup = await Views[route.view]({ signal: controller.signal, query: new URLSearchParams(location.search) });
                if (mine === token && current) current.cleanup = cleanup;
            } catch (err) {
                console.error(err);
            }
        }
        if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
        document.dispatchEvent(new CustomEvent("route:change", { detail: { path: location.pathname } }));
    }

    /* ---------- Going somewhere ---------- */
    // Router.go("/cart")  or  Router.go("/login?next=/cart", { replace: true })
    function go(target, { replace = false } = {}) {
        const url = new URL(target, location.origin);
        const same = url.pathname + url.search === location.pathname + location.search;
        history[replace ? "replaceState" : "pushState"]({}, "", url.pathname + url.search + url.hash);
        // Same address, only the #anchor changed: let the page scroll to it.
        if (same && url.hash) { document.getElementById(url.hash.slice(1))?.scrollIntoView(); return Promise.resolve(); }
        return render();
    }

    // Links inside the app are handled here instead of reloading the page.
    document.addEventListener("click", event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest?.("a[href]");
        if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || !find(url.pathname)) return;     // another site, or a file: browser default
        if (url.pathname === location.pathname && url.search === location.search && url.hash) return;   // #anchor on this page
        event.preventDefault();
        go(url.pathname + url.search + url.hash);
    });
    window.addEventListener("popstate", render);            // Back / Forward buttons

    return { ROUTES, go, render, refresh: render, roleFor, canOpen, homeFor, isInternal };
})();
