import express from "express";
import {
    createCampaign,
    deleteCampaign,
    getCampaignById,
    getCampaigns,
    updateCampaign,
} from "../controllers/campaignController.js";

const router = express.Router();

// GET /api/campaign - সব campaigns পাওয়ার জন্য
router.get("/", getCampaigns);

// POST /api/campaign - নতুন campaign create করার জন্য
router.post("/", createCampaign);

// PUT /api/campaign/:id - campaign update করার জন্য
router.put("/:id", updateCampaign);

// DELETE /api/campaign/:id - campaign delete করার জন্য
router.delete("/:id", deleteCampaign);

// GET /api/campaign/:id - single campaign পাওয়ার জন্য
router.get("/:id", getCampaignById);

export default router;
