// middlewares/rateLimiter.js
// FIX (Phase 3): `express-rate-limit` was already a package.json dependency but
// was never actually wired up anywhere — login, OTP verification, and password
// reset had no brute-force protection at all (OTPs are only 6 digits).
import rateLimit from "express-rate-limit";

const jsonHandler = (req, res) => {
    res.status(429).json({
        success: false,
        message: "Too many attempts. Please try again later.",
    });
};

// Login / register: generous enough for real users, blocks credential-stuffing.
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonHandler,
});

// OTP verification / resend / password reset: tighter, since OTPs are only 6 digits.
export const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonHandler,
});

// Coupon validation (Phase 0): POST /api/coupons/apply is public and
// unauthenticated, and it answers "does this code exist and what is it worth?".
// Without a limit that is a free coupon-code oracle — an attacker can enumerate
// short/guessable codes at full speed. 20 attempts per 15 min is far more than
// any real shopper types and closes the enumeration path.
export const couponLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonHandler,
});

// Global API limiter (Phase 0): everything under /api that isn't covered by a
// tighter limiter above. Generous enough that a browsing session never trips it
// (a product page fans out to several requests), strict enough to blunt
// scraping and brute-force sweeps.
export const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonHandler,
    // Payment callbacks are excluded on purpose. SSLCommerz delivers IPNs from
    // its own server IPs and can burst several in a short window; a 429 there
    // would silently drop a payment notification for a real order.
    skip: (req) => req.path.startsWith("/payment"),
});
