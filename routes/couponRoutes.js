import express from "express";
import { applyCoupon } from "../controllers/couponController.js";
import { couponLimiter } from "../middlewares/rateLimiter.js";

const router = express.Router();

// Rate limited (Phase 0): unauthenticated coupon lookup is a code-enumeration
// oracle without one. See middlewares/rateLimiter.js.
router.post("/apply", couponLimiter, applyCoupon);

// Admin coupon management routes now live in routes/admin/couponAdminRoutes.js
export default router;
