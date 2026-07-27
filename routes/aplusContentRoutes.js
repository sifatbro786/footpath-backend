import express from "express";
import {
    getAplusContentByProductId,
    getAplusContentByProductSlug,
    getAplusContentById,
    getBulkAplusContent,
} from "../controllers/aplusContentController.js";

const router = express.Router();

router.get("/product/:productId", getAplusContentByProductId);
router.get("/product-slug/:slug", getAplusContentByProductSlug);
router.get("/:id", getAplusContentById);
router.post("/bulk", getBulkAplusContent);

// Admin A+ content routes now live in routes/admin/aplusContentAdminRoutes.js
export default router;
