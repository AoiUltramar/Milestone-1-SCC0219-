/* ==========================================================================
   services/users.js — customers and administrators
   --------------------------------------------------------------------------
   Business rules for accounts. Passwords are hashed with scrypt
   (passwords.js) and the hash/salt never leave the server: every function
   here returns users through publicUser().
   ========================================================================== */

const { bad, notFound, forbidden, conflict } = require("../errors");
const { exclusive } = require("../lock");
const { hashPassword, verifyPassword } = require("../passwords");
const { newId, text } = require("../util");

// The user without password fields.
function publicUser(user) {
    if (!user) return null;
    const { salt, passwordHash, ...rest } = user;
    return rest;
}

const sameText = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

// Rules for creating AND editing. `ignoreId` is the user being edited, so
// they don't clash with themselves.
function validate(data, users, ignoreId) {
    if (!text(data.name)) throw bad("Please enter a name.");
    if (!/^\S+@\S+\.\S+$/.test(text(data.email))) throw bad("Please enter a valid email address.");
    if (users.some(u => u.id !== ignoreId && sameText(u.email, data.email))) {
        throw conflict("There is already an account with this email.");
    }
    if (text(data.username) && users.some(u => u.id !== ignoreId && sameText(u.username, data.username))) {
        throw conflict("That username is taken.");
    }
}

const address = data => ({
    street: text(data?.address?.street ?? data?.street),
    city: text(data?.address?.city ?? data?.city),
    cep: text(data?.address?.cep ?? data?.cep),
});

async function listUsers(store, role) {
    return (await store.list("users", role ? { role } : {})).map(publicUser);
}

async function getUser(store, id) {
    const user = publicUser(await store.get("users", id));
    if (!user) throw notFound("User not found.");
    return user;
}

// role: "customer" or "admin".
function createUser(store, data, role = "customer") {
    return exclusive(async () => {
        if (!["customer", "admin"].includes(role)) throw bad("The role must be customer or admin.");
        const users = await store.list("users");
        validate(data, users);
        if (typeof data.password !== "string" || data.password.length < 8) throw bad("The password must have at least 8 characters.");
        const user = {
            id: newId("user"), role,
            username: text(data.username) || null,       // customers sign in with their email
            name: text(data.name), email: text(data.email), phone: text(data.phone),
            ...await hashPassword(data.password),
            createdAt: new Date().toISOString(),
        };
        if (role === "customer") user.address = address(data);     // only customers have an address
        await store.insert("users", user);
        return publicUser(user);
    });
}

// `actor` is the signed-in user making the request. Changing your OWN
// password needs the current one; an administrator editing someone else's
// account does not. The role can never be changed here.
function updateUser(store, id, changes, actor) {
    return exclusive(async () => {
        const users = await store.list("users");
        const current = users.find(u => u.id === id);
        if (!current) throw notFound("User not found.");

        const fields = {};
        for (const key of ["name", "email", "phone"]) if (key in changes) fields[key] = text(changes[key]);
        if (current.role === "customer" && changes.address) fields.address = address(changes);
        if (current.role === "admin" && "username" in changes) fields.username = text(changes.username) || null;
        validate({ ...current, ...fields }, users, id);

        if (changes.password !== undefined && changes.password !== "") {
            if (typeof changes.password !== "string" || changes.password.length < 8) throw bad("The password must have at least 8 characters.");
            if (actor.id === id && !await verifyPassword(changes.currentPassword, current)) {
                throw bad("Your current password is incorrect.");
            }
            Object.assign(fields, await hashPassword(changes.password));
        }
        return publicUser(await store.update("users", id, fields));
    });
}

// Removes the account, the cart and the free trial. Orders and finished
// subscriptions stay as sales records. A customer with an ACTIVE
// subscription must cancel it first.
function deleteUser(store, id, actor) {
    return exclusive(async () => {
        if (id === "u-admin") throw forbidden("The default admin account can't be deleted.");
        if (id === actor.id) throw forbidden("You can't delete the account you're signed in with.");
        if (!await store.get("users", id)) throw notFound("User not found.");
        if (await store.cols.subscriptions.findOne({ userId: id, status: "active" })) {
            throw conflict("Cancel active subscriptions before deleting this customer.");
        }
        await store.remove("users", id);
        await store.cols.carts.deleteOne({ _id: id });
        await store.cols.trials.deleteMany({ userId: id });       // frees the VM it reserved
        await store.cols.sessions.deleteMany({ userId: id });     // signs the person out everywhere
    });
}

module.exports = { publicUser, listUsers, getUser, createUser, updateUser, deleteUser };
