import express from "express";
import { getCampaigns, getCampaignById } from "../controllers/productCampaignController.js";

const router = express.Router();

// Public routes (for checking active campaigns)
router.get("/", getCampaigns);
router.get("/:id", getCampaignById);

// Admin campaign-management routes now live in routes/admin/productCampaignAdminRoutes.js
export default router;
