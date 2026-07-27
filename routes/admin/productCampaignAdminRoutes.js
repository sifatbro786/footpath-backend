import express from "express";
import { body } from "express-validator";
import { protect, admin } from "../../middlewares/authMiddleware.js";
import {
    createCampaign,
    updateCampaign,
    deleteCampaign,
    applyCampaignManually,
    rollbackCampaignManually,
    processAllCampaigns,
    getCampaignProducts,
} from "../../controllers/productCampaignController.js";

const router = express.Router();

router.use(protect, admin);

const campaignValidationRules = [
    body("name").notEmpty().withMessage("Campaign name is required"),
    body("discountType")
        .isIn(["percentage", "fixed"])
        .withMessage("Discount type must be percentage or fixed"),
    body("discountValue").isNumeric().withMessage("Discount value must be a number"),
    body("startDate").isISO8601().withMessage("Valid start date is required"),
    body("endDate").isISO8601().withMessage("Valid end date is required"),
];

router.post("/", campaignValidationRules, createCampaign);
router.put("/:id", updateCampaign);
router.delete("/:id", deleteCampaign);
router.post("/:id/apply", applyCampaignManually);
router.post("/:id/rollback", rollbackCampaignManually);
router.post("/process/all", processAllCampaigns);
router.get("/:id/products", getCampaignProducts);

export default router;
