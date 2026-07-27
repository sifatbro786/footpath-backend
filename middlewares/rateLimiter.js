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
