// routes/admin/categoryAdminRoutes.js — mounted at /api/v1/admin/categories
// FIX (critical): none of these mutating routes had ANY auth middleware in the
// original categoryRoutes.js, despite the controller doc-comments saying
// "@access Private/Admin" — anyone could create/update/delete categories and
// delete category images without logging in.
import express from "express";
import {
    createCategory,
    updateCategory,
    deleteCategory,
    deleteCategoryImage,
} from "../../controllers/categoryController.js";
import { uploadCategoryImage } from "../../middlewares/uploadCategoryImage.js";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

router.route("/").post(uploadCategoryImage, createCategory);
router.route("/:id").put(uploadCategoryImage, updateCategory).delete(deleteCategory);
router.route("/:id/image").delete(deleteCategoryImage);

export default router;
