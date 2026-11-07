/* ==========================================================================
   ui.js — small helpers shared by the page scripts
   ========================================================================== */

const UI = (() => {
    // Escape text before putting it inside HTML. Product names and user
    // details are typed by people, so never insert them raw.
    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, ch =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
    }

    /* ---------- Toast messages ("Added to cart") ---------- */
    let region;
    function toast(message, type = "ok") {
        if (!region) {
            region = document.createElement("div");
            region.className = "toasts";
            region.setAttribute("role", "status");       // screen readers announce it
            region.setAttribute("aria-live", "polite");
            document.body.append(region);
        }
        const item = document.createElement("p");
        item.className = "toast" + (type === "error" ? " error" : "");
        item.textContent = message;
        region.append(item);
        setTimeout(() => item.remove(), 4000);
    }

    /* ---------- Product pieces ---------- */
    function photo(product, tag = "span", attrs = "") {
        const inner = product.image
            ? `<img src="${esc(product.image)}" alt="">`
            : esc(product.icon || "📦");
        return `<${tag} class="photo" aria-hidden="true" ${attrs}>${inner}</${tag}>`;
    }

    function priceTag(product, extra = "") {
        return `<span class="tag ${extra}"><span class="currency">R$</span><span class="amount">${DB.formatAmount(product.price)}</span><span class="unit">${esc(product.unit || "")}</span></span>`;
    }

    function stockText(product) {
        if (product.stock <= 0) return `<span class="stock low">Sold out</span>`;
        if (product.stock <= 10) return `<span class="stock low">Only ${product.stock} left</span>`;
        return `<span class="stock">Available</span>`;
    }

    // A product card. `compact` = home page version (no description/specs/qty).
    function productCard(p, { compact = false } = {}) {
        const meta = DB.CATEGORIES[p.category]?.meta ?? "Product";
        const soldOut = p.stock <= 0;
        const link = `${p.category}.html#${p.id}`;
        const specs = (p.specs || []);
        const body = compact
            ? `<ul class="specs">${specs.slice(0, 3).map(([, v]) => `<li>${esc(v)}</li>`).join("")}</ul>`
            : `<p class="desc">${esc(p.description)}</p>
               <dl class="spec-list">${specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
        const qty = compact ? "" : `
                <label class="visually-hidden" for="${esc(p.id)}-qty">Quantity of ${esc(p.name)}</label>
                <input id="${esc(p.id)}-qty" class="qty-input" type="number" min="1" max="${Math.max(1, p.stock)}" value="1"${soldOut ? " disabled" : ""}>`;
        const trial = !compact && p.trial ? `<a class="btn small secondary" href="trial.html">Try free for 14 days</a>` : "";
        return `
        <li class="product" id="${esc(p.id)}" data-product-id="${esc(p.id)}">
            ${compact ? photo(p, "a", `href="${esc(link)}" tabindex="-1"`) : photo(p)}
            <h3>${compact ? `<a href="${esc(link)}">${esc(p.name)}</a>` : esc(p.name)}</h3>
            <p class="meta">${esc(meta)} · ${stockText(p)}</p>
            ${body}
            <div class="buy">
                ${priceTag(p)}
                <div class="buy-actions">${qty}
                    <button class="btn small add-btn" type="button" data-add="${esc(p.id)}"${soldOut ? " disabled" : ""}
                        aria-label="Add ${esc(p.name)} to cart">${soldOut ? "Sold out" : "Add"}</button>
                    ${trial}
                </div>
            </div>
        </li>`;
    }

    const sorters = {
        popular: (a, b) => b.sold - a.sold,
        "price-asc": (a, b) => a.price - b.price,
        "price-desc": (a, b) => b.price - a.price,
        name: (a, b) => a.name.localeCompare(b.name),
    };

    const formatDate = iso => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

    // Show an error message in a .notice.warn box (and move focus to it).
    function showError(box, message) {
        box.textContent = message;
        box.hidden = false;
        box.focus();
    }

    /* ---------- Opened as a file in a Firefox-based browser ---------- */
    // Firefox, Mullvad Browser and Tor Browser give every file:// page its
    // own separate storage (security.fileuri.strict_origin_policy, on by
    // default), so sign-in and the cart don't carry from page to page. Those
    // browsers report the origin of a file page as "null"; Chrome reports
    // "file://" and shares storage, so it gets no warning.
    const fileMode = location.protocol === "file:";
    const isolatedFiles = fileMode && location.origin === "null";

    function storageHelp() {
        return fileMode
            ? "Your browser keeps separate saved data for each page when the store is opened as a file " +
              "(Firefox, Mullvad and Tor Browser do this), so signing in on one page doesn't reach the others. " +
              "Open the store through a local web server instead: in the project folder run npm start " +
              "(or python3 -m http.server 8080) and go to http://localhost:8080."
            : "Your browser isn't sharing saved data between the pages of this site, so signing in can't " +
              "reach the other pages. Allow site data (cookies and storage) for this site and reload.";
    }

    if (isolatedFiles) {
        const banner = document.createElement("div");
        banner.className = "notice warn file-mode-banner";
        banner.setAttribute("role", "note");
        banner.dataset.testid = "file-mode-banner";
        banner.textContent = storageHelp();
        const place = () => (document.querySelector("main .wrap") ?? document.body).prepend(banner);
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place);
        else place();
    }

    return { esc, toast, photo, priceTag, stockText, productCard, sorters, formatDate, showError, storageHelp };
})();
