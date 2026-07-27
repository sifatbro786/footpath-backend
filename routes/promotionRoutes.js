import express from "express";
import { getUserCampaigns } from "../controllers/promotionController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/my-campaigns", protect, getUserCampaigns);

// Admin promotion-creation routes now live in routes/admin/promotionAdminRoutes.js
export default router;
