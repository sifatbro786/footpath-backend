// routes/admin/uploadAdminRoutes.js — mounted at /api/v1/admin/upload
// FIX (critical): none of these had ANY auth in the original uploadRoutes.js —
// anyone could upload arbitrary files to the server without logging in
// (storage abuse / spam / hosting unwanted content risk). This is
// admin-panel-only functionality (generic image upload used when creating
// offers/hero content/etc.), so moved fully under admin with protect+admin.
import express from "express";
import {
    uploadImage,
    uploadMultipleImages,
    uploadOfferImage,
} from "../../controllers/uploadController.js";
import upload from "../../controllers/uploadController.js";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

router.post("/single", upload.single("image"), uploadImage);
router.post("/multiple", upload.array("images", 10), uploadMultipleImages);
router.post("/offer", upload.single("image"), uploadOfferImage);

export default router;
