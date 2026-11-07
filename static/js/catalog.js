/* ==========================================================================
   catalog.js — draws product cards from the database
   --------------------------------------------------------------------------
   Used on index.html and on the category pages (vms, vpn, addons).
   Any <ul data-shelf="vms"> gets the products of that category.
   Optional attributes:
       data-compact      smaller cards (home page)
   Page-level controls it understands:
       #sort             <select> with popular / price-asc / price-desc / name
       ?q=word           search by name (home page shows a results shelf)
       .category-config  selects whose values travel with the cart line
   ========================================================================== */

(async () => {
    const shelves = [...document.querySelectorAll("[data-shelf]")];
    if (!shelves.length) return;

    const sortSelect = document.getElementById("sort");
    const query = (new URLSearchParams(location.search).get("q") || "").trim();
    const resultsSection = document.getElementById("search-results");

    // Keep the search box filled with what was searched.
    const searchBox = document.getElementById("q");
    if (searchBox && query) searchBox.value = query;

    async function render() {
        const products = await DB.list("products");
        const sort = UI.sorters[sortSelect?.value] || UI.sorters.popular;

        // Search results (home page): matches on name or description.
        if (resultsSection) {
            resultsSection.hidden = !query;
            document.querySelectorAll("[data-hide-when-searching]").forEach(el => { el.hidden = !!query; });
            if (query) {
                const words = query.toLowerCase().split(/\s+/);
                const hits = products.filter(p => words.every(w =>
                    (p.name + " " + p.description).toLowerCase().includes(w))).sort(sort);
                resultsSection.querySelector("h2").textContent =
                    hits.length ? `${hits.length} result${hits.length > 1 ? "s" : ""} for “${query}”` : `No results for “${query}”`;
                resultsSection.querySelector("ul").innerHTML = hits.map(p => UI.productCard(p, { compact: true })).join("");
                resultsSection.querySelector(".empty").hidden = hits.length > 0;
            }
        }

        for (const shelf of shelves) {
            const items = products.filter(p => p.category === shelf.dataset.shelf).sort(sort);
            const compact = shelf.hasAttribute("data-compact");
            shelf.innerHTML = items.length
                ? items.map(p => UI.productCard(p, { compact })).join("")
                : `<li class="empty-shelf">Nothing here yet.</li>`;
            shelf.setAttribute("aria-busy", "false");
        }
        const count = document.getElementById("plan-count");
        if (count) {
            const n = shelves.reduce((s, sh) => s + sh.querySelectorAll(".product").length, 0);
            count.textContent = `${n} ${count.dataset.noun || "plans"}`;
        }

        // Re-apply the :target highlight now that the cards exist.
        if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }

    // Choices from the "Applies to every VM you add" panel.
    function chosenOptions() {
        const options = {};
        document.querySelectorAll(".category-config select").forEach(sel => {
            options[sel.dataset.option || sel.name] = sel.value;
        });
        return options;
    }

    // One click listener for every Add button (event delegation), so it
    // keeps working after the cards are re-drawn.
    document.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-add]");
        if (!button) return;
        const card = button.closest(".product");
        const qtyInput = card.querySelector(".qty-input");
        button.disabled = true;
        try {
            const { added, capped, product } = await Cart.add(button.dataset.add, qtyInput?.value || 1, chosenOptions());
            UI.toast(capped
                ? `Added ${added} × ${product.name}. That's all we have in stock.`
                : `Added ${added} × ${product.name} to your cart.`);
            if (qtyInput) qtyInput.value = 1;
        } catch (err) {
            UI.toast(err.message, "error");
        } finally {
            button.disabled = false;
        }
    });

    sortSelect?.addEventListener("change", render);
    await render();
})();
