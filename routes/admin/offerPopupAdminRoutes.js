// routes/admin/offerPopupAdminRoutes.js — mounted at /api/admin/offers
import express from "express";
import {
    createOffer,
    deleteOffer,
    getAllOffers,
    toggleOfferStatus,
    updateOffer,
} from "../../controllers/offerPopupController.js";
import { adminOnly, protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, adminOnly);

router.get("/all", getAllOffers);
router.post("/create", createOffer);
router.put("/:id", updateOffer);
router.delete("/:id", deleteOffer);
router.patch("/:id/toggle", toggleOfferStatus);

export default router;
