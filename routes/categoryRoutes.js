import express from "express";
import { getCategories, getCategoryTree, getCategory, getCategoryPath } from "../controllers/categoryController.js";

const router = express.Router();

router.route("/tree").get(getCategoryTree);
router.route("/:id/path").get(getCategoryPath);
router.route("/").get(getCategories);
router.route("/:id").get(getCategory);

// Admin category-management routes now live in routes/admin/categoryAdminRoutes.js
export default router;
