import express from "express";
import { createAbandonedCartPromotion } from "../../controllers/promotionController.js";
import { protect, adminOnly } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, adminOnly);

router.post("/abandoned-cart", createAbandonedCartPromotion);

export default router;
