/* ==========================================================================
   config.js — server settings, read from environment variables
   --------------------------------------------------------------------------
   Every value has a default that works on a developer machine with a local
   MongoDB, so `npm start` needs no setup.
       PORT         HTTP port                       (default 8080)
       MONGO_URL    MongoDB connection string       (default mongodb://127.0.0.1:27017)
       DB_NAME      database name                   (default cacheandcarry)
       CC_TEST=1    enables the /api/test/* helpers used by the test suite
       COOKIE_SECURE=1   mark the session cookie Secure (use behind HTTPS)
   ========================================================================== */

module.exports = {
    PORT: Number(process.env.PORT) || 8080,
    MONGO_URL: process.env.MONGO_URL || "mongodb://127.0.0.1:27017",
    DB_NAME: process.env.DB_NAME || "cacheandcarry",
    SESSION_DAYS: 7,
    COOKIE_SECURE: process.env.COOKIE_SECURE === "1",
    TEST_MODE: process.env.CC_TEST === "1",
};
