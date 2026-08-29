// middlewares/sanitize.js
//
// NoSQL operator-injection guard (Phase 0).
//
// Why this file exists instead of `app.use(mongoSanitize())`:
// -----------------------------------------------------------
// Express 5 changed `req.query` from a plain writable property into a
// getter-only accessor that re-parses the query string on every read. Verified
// against express@5:
//
//   req.query = {...}          -> TypeError: Cannot set property query of
//                                 #<IncomingMessage> which has only a getter
//   req.query.foo = "x"        -> silently discarded; the next read recomputes
//   Object.defineProperty(...) -> works
//
// Both `express-mongo-sanitize`'s bundled middleware and `hpp` sanitise by
// assigning back to `req.query`, so mounting either of them directly on Express 5
// throws on the first request with a query string. This wrapper uses the
// library's exported `sanitize()` primitive (which mutates a target in place)
// and then re-defines `req.query` as a plain writable data property.
//
// That re-definition has a second, deliberate effect: once `req.query` is a
// normal value property, `hpp` can assign to it too. So this middleware MUST be
// mounted BEFORE hpp in server.js.
//
// What it removes: keys beginning with `$` (query operators such as $ne, $gt,
// $where) and keys containing `.` (dotted paths that reach into subdocuments).
// `replaceWith: "_"` neutralises the key rather than dropping it, which keeps
// the payload shape intact and makes the tampering visible in logs.
//
// Without this, `GET /api/products?price[$ne]=` or a login body of
// `{ "email": { "$gt": "" } }` reaches Mongoose as a live operator.

import mongoSanitize from "express-mongo-sanitize";

const OPTIONS = { replaceWith: "_" };

/**
 * Sanitise a container in place, tolerating null/undefined.
 * Returns the same reference so callers can chain.
 */
const scrub = (target) => {
    if (target && typeof target === "object") {
        mongoSanitize.sanitize(target, OPTIONS);
    }
    return target;
};

export const sanitizeRequest = (req, _res, next) => {
    // Body and params are ordinary writable objects on both Express 4 and 5,
    // so in-place mutation is enough.
    scrub(req.body);
    scrub(req.params);

    // Query needs the defineProperty dance described above. Read once (the
    // getter parses here), scrub that snapshot, then pin it as a real value.
    try {
        const snapshot = req.query;
        if (snapshot && typeof snapshot === "object") {
            Object.defineProperty(req, "query", {
                value: scrub(snapshot),
                writable: true,
                configurable: true,
                enumerable: true,
            });
        }
    } catch (err) {
        // A malformed query string can make the getter itself throw. Surface it
        // as a 400 through the error handler rather than crashing the process.
        return next(err);
    }

    return next();
};

export default sanitizeRequest;
