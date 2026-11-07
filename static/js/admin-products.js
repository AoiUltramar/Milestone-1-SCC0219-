/* ==========================================================================
   admin-products.js — admin-products.html: product CRUD (admins only)
   ========================================================================== */

(async () => {
    const admin = await Auth.requireRole("admin");
    if (!admin) return;

    const $ = id => document.getElementById(id);
    const rows = $("product-rows");
    const dialog = $("product-dialog");
    const form = $("product-form");
    const errorBox = $("product-error");
    let editingId = null;      // null = creating a new product
    let imageData = null;      // data: URL of the photo, or null

    async function render() {
        const text = $("product-filter").value.trim().toLowerCase();
        const category = $("category-filter").value;
        const products = (await DB.list("products"))
            .filter(p => (!category || p.category === category) && p.name.toLowerCase().includes(text))
            .sort((a, b) => a.category.localeCompare(b.category) || a.price - b.price);

        rows.innerHTML = products.map(p => `
            <tr data-id="${UI.esc(p.id)}">
                <td>${p.image ? `<img class="thumb" src="${UI.esc(p.image)}" alt="">` : UI.esc(p.icon)} <strong>${UI.esc(p.name)}</strong><br><span class="hint">${UI.esc(p.id)}</span></td>
                <td>${UI.esc(DB.CATEGORIES[p.category]?.name ?? p.category)}</td>
                <td class="num">${DB.formatPrice(p.price)}<span class="hint">${UI.esc(p.unit)}</span></td>
                <td class="num">
                    <label class="visually-hidden" for="stock-${UI.esc(p.id)}">Stock of ${UI.esc(p.name)}</label>
                    <input class="stock-input" id="stock-${UI.esc(p.id)}" type="number" min="0" step="1" value="${p.stock}">
                </td>
                <td class="num">${p.sold}</td>
                <td><div class="row-actions">
                    <button class="btn small secondary" type="button" data-action="edit" aria-label="Edit ${UI.esc(p.name)}">Edit</button>
                    <button class="btn small secondary" type="button" data-action="delete" aria-label="Delete ${UI.esc(p.name)}">Delete</button>
                </div></td>
            </tr>`).join("") || `<tr><td colspan="6">No products match.</td></tr>`;

        const all = await DB.list("products");
        $("product-summary").textContent =
            `${all.length} products · ${all.filter(p => p.stock === 0).length} sold out · ${all.reduce((s, p) => s + p.sold, 0)} units sold in total.`;
    }

    /* ---------- Quick stock edit straight in the table ---------- */
    rows.addEventListener("change", async (e) => {
        if (!e.target.classList.contains("stock-input")) return;
        const id = e.target.closest("tr").dataset.id;
        const stock = Math.max(0, Math.floor(Number(e.target.value)) || 0);
        try {
            const p = await DB.update("products", id, { stock });
            UI.toast(`${p.name}: stock set to ${stock}.`);
        } catch (err) {
            UI.toast(err.message, "error");
        }
        await render();
    });

    rows.addEventListener("click", async (e) => {
        const button = e.target.closest("[data-action]");
        if (!button) return;
        const id = button.closest("tr").dataset.id;
        const product = await DB.get("products", id);
        if (!product) {                    // deleted in another tab
            UI.toast("That product no longer exists.", "error");
            return render();
        }
        if (button.dataset.action === "edit") openForm(product);
        if (button.dataset.action === "delete") {
            if (!confirm(`Delete “${product.name}”? This can't be undone.`)) return;
            await DB.remove("products", id);
            UI.toast(`${product.name} deleted.`);
            await render();
        }
    });

    /* ---------- Create / edit dialog ---------- */
    function showImage(src) {
        imageData = src || null;
        $("f-image-preview").hidden = !imageData;
        if (imageData) $("f-image-img").src = imageData;
    }

    function openForm(p = null) {
        editingId = p?.id ?? null;
        form.reset();
        errorBox.hidden = true;
        $("product-dialog-title").textContent = p ? `Edit ${p.name}` : "New product";
        const f = form.elements;
        f.id.disabled = !!p;                 // ids don't change once created
        if (p) {
            f.name.value = p.name; f.id.value = p.id; f.category.value = p.category;
            f.unit.value = p.unit || ""; f.price.value = p.price; f.stock.value = p.stock;
            f.sold.value = p.sold; f.icon.value = p.icon || "";
            f.description.value = p.description || "";
            f.specs.value = (p.specs || []).map(([k, v]) => `${k}: ${v}`).join("\n");
            f.trial.checked = !!p.trial;
        }
        showImage(p?.image);
        dialog.showModal();
        f.name.focus();
    }

    // Shrink uploaded photos so localStorage (≈5 MB) doesn't fill up.
    function shrink(file, max = 400) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, max / Math.max(img.width, img.height));
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(img.src);
                resolve(canvas.toDataURL("image/jpeg", 0.8));
            };
            img.onerror = () => reject(new Error("That file isn't an image we can read."));
            img.src = URL.createObjectURL(file);
        });
    }

    form.elements.image.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { showImage(await shrink(file)); } catch (err) { UI.showError(errorBox, err.message); }
    });
    $("f-image-remove").addEventListener("click", () => { showImage(null); form.elements.image.value = ""; });

    const slug = text => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        const f = form.elements;
        try {
            const name = f.name.value.trim();
            const price = Number(f.price.value);
            const stock = Number(f.stock.value);
            const sold = Number(f.sold.value || 0);
            if (!name) throw new Error("Give the product a name.");
            if (!(price >= 0) || f.price.value === "") throw new Error("Enter a price of zero or more.");
            if (!Number.isInteger(stock) || stock < 0 || f.stock.value === "") throw new Error("Stock must be a whole number of zero or more.");
            if (!Number.isInteger(sold) || sold < 0) throw new Error("Quantity sold must be a whole number of zero or more.");
            if (!f.description.value.trim()) throw new Error("Write a short description.");

            const specs = f.specs.value.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
                const i = line.indexOf(":");
                if (i < 1) throw new Error(`Spec “${line}” needs a label, like “CPU: 2 vCPU”.`);
                return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
            });
            const data = {
                name, category: f.category.value, unit: f.unit.value.trim(), price, stock, sold,
                icon: f.icon.value.trim() || "📦", image: imageData,
                description: f.description.value.trim(), specs, trial: f.trial.checked,
            };

            if (editingId) {
                await DB.update("products", editingId, data);
                UI.toast(`${name} saved.`);
            } else {
                const id = slug(f.id.value.trim() || name);
                if (!/^[a-z0-9-]+$/.test(id)) throw new Error("The ID can only use lowercase letters, numbers and dashes.");
                await DB.insert("products", { ...data, id });
                UI.toast(`${name} created.`);
            }
            dialog.close();
            await render();
        } catch (err) {
            UI.showError(errorBox, err.message.includes("quota") ? "The photo is too large to store. Try a smaller image." : err.message);
        }
    });

    $("product-cancel").addEventListener("click", () => dialog.close());
    $("new-product").addEventListener("click", () => openForm());
    $("product-filter").addEventListener("input", render);
    $("category-filter").addEventListener("change", render);
    await render();
})();
