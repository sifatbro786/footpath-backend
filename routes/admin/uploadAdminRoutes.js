// routes/admin/uploadAdminRoutes.js — mounted at /api/admin/upload
// FIX (critical): none of these had ANY auth in the original uploadRoutes.js —
// anyone could upload arbitrary files to the server without logging in
// (storage abuse / spam / hosting unwanted content risk). This is
// admin-panel-only functionality (generic image upload used when creating
// offers/hero content/etc.), so moved fully under admin with protect+admin.
import express from "express";
import upload, {
    uploadImage,
    uploadMultipleImages,
    uploadOfferImage,
} from "../../controllers/uploadController.js";
import { admin, protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

router.post("/single", upload.single("image"), uploadImage);
router.post("/multiple", upload.array("images", 10), uploadMultipleImages);
// uploadOfferImage runs its OWN multer internally — do NOT add an outer
// upload.single() here or it drains the stream first (req.file becomes
// undefined → 400) and misfiles into products/. Saves to uploads/offers/.
router.post("/offer", uploadOfferImage);

export default router;
