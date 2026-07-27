// routes/offerPopupRoutes.js
import express from "express";
import { getActiveOffers, getOfferById } from "../controllers/offerPopupController.js";

const router = express.Router();

router.get("/active", getActiveOffers);
router.get("/:id", getOfferById);

// Admin offer-management routes now live in routes/admin/offerPopupAdminRoutes.js
export default router;
