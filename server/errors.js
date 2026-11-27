/* ==========================================================================
   errors.js — one error type for "the request was wrong"
   --------------------------------------------------------------------------
   Services throw HttpError(status, message); the error middleware in app.js
   turns it into a JSON reply  { "error": "message" }  with that status:
       400 invalid data      401 not signed in     403 not allowed
       404 not found         409 conflict (duplicate, out of stock/capacity)
   Anything else is an unexpected bug and becomes a plain 500.
   ========================================================================== */

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const bad = message => new HttpError(400, message);
const unauthorized = (message = "Please sign in.") => new HttpError(401, message);
const forbidden = (message = "You are not allowed to do that.") => new HttpError(403, message);
const notFound = (message = "Item not found.") => new HttpError(404, message);
const conflict = message => new HttpError(409, message);

// Express 4 does not catch errors thrown inside async handlers; this wrapper
// forwards them to the error middleware.
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

module.exports = { HttpError, bad, unauthorized, forbidden, notFound, conflict, wrap };
