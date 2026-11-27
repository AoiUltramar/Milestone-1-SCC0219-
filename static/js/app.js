/* ==========================================================================
   app.js — start-up code of the single-page application
   --------------------------------------------------------------------------
   Runs last. It draws the parts of the page that stay put (the header's
   account links and the search box), then asks the router to show the
   screen for the current address.
   ========================================================================== */

(() => {
    const nav = document.querySelector(".header-actions");

    // "Sign in"  <->  "Hi, Ana · Sign out"  (Administrators see "Admin".)
    async function renderHeader() {
        nav.querySelectorAll("[data-auth]").forEach(el => el.remove());
        const user = await Auth.currentUser();
        const links = [];

        if (!user) {
            const signIn = document.createElement("a");
            signIn.href = "/login";
            signIn.textContent = "Sign in";
            signIn.dataset.auth = "sign-in";
            links.push(signIn);
        } else {
            const account = document.createElement("a");
            account.href = Auth.homeFor(user);
            account.textContent = user.role === "admin" ? "Admin" : "Hi, " + user.name.split(" ")[0];
            account.dataset.auth = "home";

            const out = document.createElement("a");
            out.href = "/";
            out.textContent = "Sign out";
            out.dataset.auth = "sign-out";
            out.dataset.testid = "sign-out";
            out.addEventListener("click", async event => {
                event.preventDefault();
                await Auth.logout();
                Router.go("/");
            });
            links.push(account, out);
        }
        nav.prepend(...links);
        // The links were just created: mark which one is the current screen.
        const here = location.pathname.replace(/\/+$/, "") || "/";
        nav.querySelectorAll("a[data-auth]").forEach(a => {
            const target = new URL(a.href, location.origin).pathname;
            if (target === here || (a.dataset.auth === "home" && here.startsWith("/admin/"))) a.setAttribute("aria-current", "page");
        });
    }

    // The search box in the header: /?q=words
    document.getElementById("search-form").addEventListener("submit", event => {
        event.preventDefault();
        const q = event.currentTarget.elements.q.value.trim();
        Router.go(q ? `/?q=${encodeURIComponent(q)}` : "/");
    });

    document.addEventListener("auth:change", renderHeader);
    document.addEventListener("route:change", renderHeader);       // keeps aria-current right
    // If the session ended while on a restricted screen, the router sends the visitor to sign in.
    document.addEventListener("auth:expired", () => { if (Router.roleFor(location.pathname)) Router.refresh(); });

    renderHeader();
    Cart.renderBadge();
    Router.render();
})();
