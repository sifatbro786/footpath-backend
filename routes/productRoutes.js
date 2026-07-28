import express from "express";
import {
    getProducts,
    getProductById,
    getProductBySlug,
    addReview,
    getFeaturedProducts,
    getProductsByAttributes,
    getProductAttributes,
    getProductsByMultipleAttributes,
    getProductsForDynamicSection,
    getHomepageSections,
    getRelatedProducts,
    incrementProductView,
    getOrderedProducts,
} from "../controllers/productController.js";

import { body } from "express-validator";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

const reviewValidationRules = [
    body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5"),
    body("comment")
        .optional()
        .isLength({ max: 500 })
        .withMessage("Comment cannot exceed 500 characters"),
];

// ============= PUBLIC ROUTES (No Auth Required) =============
router.get("/", getProducts);
router.get("/featured", getFeaturedProducts);
router.get("/attributes", getProductAttributes);
router.get("/filter/attributes", getProductsByAttributes);
router.get("/filter/multiple-attributes", getProductsByMultipleAttributes);
router.get("/homepage-sections", getHomepageSections);
router.get("/dynamic-section/:sectionId", getProductsForDynamicSection);
router.get("/related", getRelatedProducts);
router.get("/:id", getProductById);
router.get("/slug/:slug", getProductBySlug);

// Get products with custom ordering (for public storefront)
router.get("/ordered/list", getOrderedProducts);

// Increment product view count (public, no auth needed)
router.put("/:id/view", incrementProductView);

// ============= REVIEW ROUTE (logged-in users, not admin-only) =============
router.post("/:id/reviews", protect, reviewValidationRules, addReview);

// Admin-only product routes now live in routes/admin/productAdminRoutes.js
export default router;
