/* ==========================================================================
   auth.js — accounts and sign-in, as seen from the browser
   --------------------------------------------------------------------------
   Everything that matters for security happens on the SERVER now: passwords
   are hashed there, the session lives in an HttpOnly cookie the page cannot
   read, and every API call checks the role again. This file only asks the
   server who is signed in and shows the right things:

       Auth.login / register / logout          POST /api/auth/...
       Auth.currentUser()                      GET  /api/auth/me
       Auth.listUsers / createUser / updateUser / deleteUser   /api/users

   Editing the browser's storage can no longer turn someone into an
   administrator: the role is not stored in the browser at all.
   ========================================================================== */

const Auth = (() => {
    /* ---------- Who is signed in ---------- */
    // The answer is kept for the lifetime of the page and thrown away when
    // something changes (sign-in, sign-out, a profile edit, or a 401).
    let cached = null;

    // currentUser({ fresh: true }) asks the server again; use it before an action
    // that matters, because the person may have signed out in another tab.
    function currentUser({ fresh = false } = {}) {
        if (fresh) cached = null;
        cached ??= DB.request("GET", "/api/auth/me").then(r => r.user).catch(() => null);
        return cached;
    }

    // Tells the rest of the app (header, cart badge) that the user changed.
    function changed() {
        cached = null;
        document.dispatchEvent(new CustomEvent("auth:change"));
    }

    /* ---------- Sign in / out ---------- */
    async function register(data) {
        const { user } = await DB.request("POST", "/api/auth/register", data);
        changed();
        return user;
    }

    async function login(loginName, password) {
        const { user } = await DB.request("POST", "/api/auth/login", { login: loginName, password });
        changed();
        return user;
    }

    async function logout() {
        await DB.request("POST", "/api/auth/logout");
        changed();
    }

    /* ---------- Managing users (the admin screens and "My account") ---------- */
    const listUsers = role => DB.request("GET", "/api/users" + (role ? `?role=${encodeURIComponent(role)}` : ""));

    // role: "customer" or "admin"
    const createUser = (data, role = "customer") => DB.request("POST", "/api/users", { ...data, role });

    // Pass `password` (and `currentPassword` when it is your own) to change the password too.
    async function updateUser(id, changes) {
        const user = await DB.request("PATCH", `/api/users/${encodeURIComponent(id)}`, changes);
        if ((await currentUser())?.id === id) changed();         // refresh the name shown in the header
        return user;
    }

    const deleteUser = id => DB.request("DELETE", `/api/users/${encodeURIComponent(id)}`);

    /* ---------- Access rules (they live with the routes, in router.js) ---------- */
    const homeFor = Router.homeFor;
    const roleFor = Router.roleFor;
    const canOpen = Router.canOpen;

    // A page that needs a role calls this first. The router already checks the
    // route's role before drawing the screen; this is a second look that
    // also gives the screen the user it needs.
    async function requireRole(role) {
        const user = await currentUser();
        if (!user || (role && user.role !== role)) {
            Router.go("/login?next=" + encodeURIComponent(location.pathname + location.search), { replace: true });
            return null;
        }
        return user;
    }

    // A 401 from the server means the session ended (another tab signed out, it expired...).
    document.addEventListener("auth:expired", () => {
        if (cached) changed();
    });

    return { register, login, logout, currentUser, requireRole, homeFor, roleFor, canOpen,
             createUser, updateUser, deleteUser, listUsers };
})();
