// routes/admin/offerPopupAdminRoutes.js — mounted at /api/v1/admin/offers
import express from "express";
import {
    createOffer,
    updateOffer,
    deleteOffer,
    getAllOffers,
    toggleOfferStatus,
} from "../../controllers/offerPopupController.js";
import { protect, adminOnly } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, adminOnly);

router.get("/all", getAllOffers);
router.post("/create", createOffer);
router.put("/:id", updateOffer);
router.delete("/:id", deleteOffer);
router.patch("/:id/toggle", toggleOfferStatus);

export default router;
