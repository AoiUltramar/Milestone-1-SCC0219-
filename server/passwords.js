/* ==========================================================================
   passwords.js — password hashing with scrypt
   --------------------------------------------------------------------------
   A password is never stored. We store a random salt and the scrypt hash of
   (password, salt). scrypt is deliberately slow and memory-hungry, which
   makes guessing passwords from a stolen database expensive (unlike a plain
   SHA-256). It ships with Node.js, so no extra package is needed.
   ========================================================================== */

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

// Returns the two fields that go into the user record.
async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const key = await scrypt(password, salt, KEY_LENGTH);
    return { salt, passwordHash: key.toString("hex") };
}

// Re-computes the hash with the stored salt and compares in constant time.
async function verifyPassword(password, user) {
    if (!user?.salt || !user?.passwordHash) return false;
    const key = await scrypt(String(password ?? ""), user.salt, KEY_LENGTH);
    const stored = Buffer.from(user.passwordHash, "hex");
    return stored.length === key.length && crypto.timingSafeEqual(stored, key);
}

module.exports = { hashPassword, verifyPassword };
