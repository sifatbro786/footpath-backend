import express from "express";
import {
    createCampaign,
    getCampaigns,
    updateCampaign,
    deleteCampaign,
    getCampaignById,
} from "../controllers/campaignController.js";

const router = express.Router();

// GET /api/v1/campaign - সব campaigns পাওয়ার জন্য
router.get("/", getCampaigns);

// POST /api/v1/campaign - নতুন campaign create করার জন্য
router.post("/", createCampaign);

// PUT /api/v1/campaign/:id - campaign update করার জন্য
router.put("/:id", updateCampaign);

// DELETE /api/v1/campaign/:id - campaign delete করার জন্য
router.delete("/:id", deleteCampaign);

// GET /api/v1/campaign/:id - single campaign পাওয়ার জন্য
router.get("/:id", getCampaignById);

export default router;
