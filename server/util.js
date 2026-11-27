/* ==========================================================================
   util.js — small helpers shared by the services
   ========================================================================== */

const crypto = require("crypto");

// "user-3f2a9c..." — a readable prefix plus a random UUID.
const newId = prefix => `${prefix}-${crypto.randomUUID()}`;

// Round a money amount to cents (avoids 0.1 + 0.2 = 0.30000000000000004).
const money = value => Math.round((value + Number.EPSILON) * 100) / 100;

// Same day of the month `months` later; clamps to the last day when the
// month is shorter (Jan 31 + 1 month = Feb 28/29). Returns an ISO string.
function subscriptionEnd(start, months) {
    const end = new Date(start);
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + months);
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(day, last));
    return end.toISOString();
}

// Only plain text, trimmed; anything else becomes "".
const text = value => (typeof value === "string" ? value.trim() : "");

module.exports = { newId, money, subscriptionEnd, text };
