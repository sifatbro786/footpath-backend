import express from "express";
import { protect, adminOnly } from "../../middlewares/authMiddleware.js";
import {
    getAllCarts,
    getCartStats,
    createCampaign,
    getAbandonedCarts,
    sendBulkPromotions,
} from "../../controllers/admin/adminCartController.js";

const router = express.Router();

router.get("/carts", protect, adminOnly, getAllCarts);
router.get("/stats", protect, adminOnly, getCartStats);
router.get("/abandoned-carts", protect, adminOnly, getAbandonedCarts);
router.post("/create-campaign", protect, adminOnly, createCampaign);
router.post("/bulk-promotions", protect, adminOnly, sendBulkPromotions);

export default router;
