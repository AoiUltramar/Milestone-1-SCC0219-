/* ==========================================================================
   auth.js — accounts, sign-in, sign-out and page guards
   --------------------------------------------------------------------------
   Uses the "users" collection from db.js. Passwords are never stored as
   typed: each user gets a random salt and we store SHA-256(salt + password).

   NOT real security: anyone can edit localStorage in DevTools and become
   an admin. That is acceptable for a client-only milestone; the final
   version must check roles on the server.

   Needs db.js loaded first.
   ========================================================================== */

const Auth = (() => {
    const SESSION_KEY = "cc_session";   // id of whoever is signed in

    /* ---------- Session (kept outside the "database") ---------- */
    // Memory copy so signing in still works for this page when storage is blocked.
    let memorySession = null;
    function readSession() {
        try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return memorySession; }
    }
    function writeSession(id) {
        memorySession = id || null;
        try {
            if (id) localStorage.setItem(SESSION_KEY, JSON.stringify(id));
            else localStorage.removeItem(SESSION_KEY);
        } catch { /* storage blocked: memory copy is used */ }
    }

    /* ---------- Passwords ---------- */
    const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    const randomSalt = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

    async function hashPassword(password, salt) {
        // crypto.subtle only exists on https:// or http://localhost pages.
        if (crypto.subtle) {
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + password));
            return toHex(new Uint8Array(digest));
        }
        // Fallback for file:// pages: a simple (weak) string hash.
        let h = 0;
        for (const ch of salt + password) h = (Math.imul(31, h) + ch.codePointAt(0)) | 0;
        return "weak-" + (h >>> 0).toString(16);
    }

    // Strip password fields before handing a user to page code.
    function publicUser(user) {
        if (!user) return null;
        const { salt, passwordHash, ...rest } = user;
        return rest;
    }

    const sameText = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

    /* ---------- Seed the required admin/admin account ---------- */
    let seeding = null;
    function ensureSeeded() {
        seeding ??= (async () => {
            const users = await DB.list("users");
            // Look for the account by id: the admin may have changed its username.
            if (users.some(u => u.id === "u-admin")) return;
            const salt = randomSalt();
            await DB.insert("users", {
                id: "u-admin", role: "admin", username: "admin",
                name: "Administrator", email: "admin@cacheandcarry.example", phone: "(11) 2222-1313",
                salt, passwordHash: await hashPassword("admin", salt),
            });
        })();
        return seeding;
    }

    /* ---------- User management (sign-up and the admin screens) ---------- */

    function validate(data, users, ignoreId) {
        if (!data.name?.trim()) throw new Error("Please enter a name.");
        if (!/^\S+@\S+\.\S+$/.test(data.email || "")) throw new Error("Please enter a valid email address.");
        if (users.some(u => u.id !== ignoreId && sameText(u.email, data.email))) {
            throw new Error("There is already an account with this email.");
        }
        if (data.username && users.some(u => u.id !== ignoreId && sameText(u.username, data.username))) {
            throw new Error("That username is taken.");
        }
    }

    // role: "customer" or "admin". Returns the new user (without password fields).
    async function createUser(data, role = "customer") {
        await ensureSeeded();
        const users = await DB.list("users");
        validate(data, users);
        if (!data.password || data.password.length < 8) throw new Error("The password must have at least 8 characters.");
        const salt = randomSalt();
        const user = {
            role,
            username: data.username?.trim() || null,
            name: data.name.trim(),
            email: data.email.trim(),
            phone: (data.phone || "").trim(),
            salt,
            passwordHash: await hashPassword(data.password, salt),
            createdAt: new Date().toISOString(),
        };
        if (role === "customer") {
            user.address = {
                street: (data.address?.street ?? data.street ?? "").trim(),
                city: (data.address?.city ?? data.city ?? "").trim(),
                cep: (data.address?.cep ?? data.cep ?? "").trim(),
            };
        }
        return publicUser(await DB.insert("users", user));
    }

    // Change profile fields; pass `password` to change it too.
    async function updateUser(id, changes) {
        await ensureSeeded();
        const users = await DB.list("users");
        const current = users.find(u => u.id === id);
        if (!current) throw new Error("User not found.");
        const next = { ...current, ...changes };
        validate(next, users, id);
        const { password, ...fields } = changes;
        if (password) {
            if (password.length < 8) throw new Error("The password must have at least 8 characters.");
            fields.salt = randomSalt();
            fields.passwordHash = await hashPassword(password, fields.salt);
        }
        delete fields.role;     // roles are fixed once created
        return publicUser(await DB.update("users", id, fields));
    }

    async function deleteUser(id) {
        if (id === "u-admin") throw new Error("The default admin account can't be deleted.");
        if (id === readSession()) throw new Error("You can't delete the account you're signed in with.");
        // Remove the user with their cart and trial in one step. A trial still
        // running gives its Standard VM back to stock. Orders stay as sales records.
        await DB.transaction(({ users, carts, trials, products }) => {
            const drop = (list, test) => {
                for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) list.splice(i, 1);
            };
            if (!users.some(u => u.id === id)) throw new Error("User not found.");
            drop(users, u => u.id === id);
            drop(carts, c => c.id === id);
            trials.filter(t => t.userId === id && !t.released).forEach(t => {
                const p = products.find(x => x.id === t.productId);
                if (p) p.stock += 1;
            });
            drop(trials, t => t.userId === id);
        });
    }

    async function listUsers(role) {
        await ensureSeeded();
        const users = (await DB.list("users")).map(publicUser);
        return role ? users.filter(u => u.role === role) : users;
    }

    async function checkPassword(id, password) {
        const user = await DB.get("users", id);
        return !!user && await hashPassword(password, user.salt) === user.passwordHash;
    }

    /* ---------- Sign-in / sign-out ---------- */

    async function register(data) {
        const user = await createUser(data, "customer");
        writeSession(user.id);
        return user;
    }

    async function login(loginName, password) {
        await ensureSeeded();
        const users = await DB.list("users");
        const user = users.find(u => sameText(u.email, loginName) || (u.username && sameText(u.username, loginName)));
        // Same message for unknown account and wrong password, so the form
        // doesn't reveal which emails are registered.
        const fail = new Error("The email or password is incorrect. Check both fields and try again.");
        if (!user || await hashPassword(password, user.salt) !== user.passwordHash) throw fail;
        writeSession(user.id);
        return publicUser(user);
    }

    async function logout() {
        writeSession(null);
    }

    // Who is signed in? null for visitors.
    async function currentUser() {
        await ensureSeeded();
        const id = readSession();
        if (!id) return null;
        const user = await DB.get("users", id);
        if (!user) writeSession(null);       // account was deleted
        return publicUser(user);
    }

    // Page guard: Auth.requireRole("admin"), ("customer") or () for anyone signed in.
    // Visitors go to login.html and come back here afterwards.
    async function requireRole(role) {
        const user = await currentUser();
        if (!user || (role && user.role !== role)) {
            const back = encodeURIComponent(location.pathname.split("/").pop() + location.search);
            location.replace("login.html?next=" + back);
            return null;
        }
        return user;
    }

    const homeFor = user => (user.role === "admin" ? "admin-products.html" : "account.html");

    // Pages only one role may open (the rest are open to everyone). login.js
    // uses this so it never sends someone to a page that would send them back.
    const PAGE_ROLES = { "admin-products.html": "admin", "admin-users.html": "admin", "account.html": "customer" };
    const roleFor = page => PAGE_ROLES[String(page).split(/[?#]/)[0]] ?? null;
    const canOpen = (user, page) => !roleFor(page) || user?.role === roleFor(page);

    /* ---------- Header: "Sign in" ↔ "Hi, Ana · Sign out" ---------- */
    async function renderHeader() {
        const nav = document.querySelector(".header-actions");
        const signIn = nav?.querySelector('a[href="login.html"]');
        const user = await currentUser();
        if (!user || !signIn) return;

        const account = document.createElement("a");
        account.href = homeFor(user);
        account.textContent = user.role === "admin" ? "Admin" : "Hi, " + user.name.split(" ")[0];
        const here = location.pathname.split("/").pop();
        if (here === account.getAttribute("href") || (user.role === "admin" && here.startsWith("admin-"))) {
            account.setAttribute("aria-current", "page");
        }

        const out = document.createElement("a");
        out.href = "index.html";
        out.textContent = "Sign out";
        out.dataset.testid = "sign-out";
        out.addEventListener("click", async (e) => {
            e.preventDefault();
            await logout();
            location.href = "index.html";
        });

        signIn.replaceWith(account, out);
    }
    renderHeader();

    return { register, login, logout, currentUser, requireRole, homeFor, roleFor, canOpen,
             createUser, updateUser, deleteUser, listUsers, checkPassword };
})();
