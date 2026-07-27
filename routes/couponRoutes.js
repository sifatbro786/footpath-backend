import express from "express";
import { applyCoupon } from "../controllers/couponController.js";

const router = express.Router();

router.post("/apply", applyCoupon);

// Admin coupon management routes now live in routes/admin/couponAdminRoutes.js
export default router;
