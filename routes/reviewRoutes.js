import express from "express";
import {
    addReview,
    getProductReviews,
    getFeaturedReviews,
    getUserReviews,
    updateReview,
    deleteReview,
} from "../controllers/reviewController.js";
import { body } from "express-validator";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

const reviewValidationRules = [
    body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5"),
    body("productId").isMongoId().withMessage("Valid product ID is required"),
    body("comment").optional().isLength({ max: 1000 }).withMessage("Comment too long"),
];

const updateReviewValidationRules = [
    body("rating")
        .optional()
        .isInt({ min: 1, max: 5 })
        .withMessage("Rating must be between 1 and 5"),
    body("comment").optional().isLength({ max: 1000 }).withMessage("Comment too long"),
];

// Public route - anyone can see approved reviews
//
// NOTE: /featured must be declared before any "/:something" route on this
// router, or Express would match it as a param and treat "featured" as an id.
router.get("/featured", getFeaturedReviews);
router.get("/product/:productId", getProductReviews);

// User routes (authenticated) - require login, not admin
router.post("/", protect, reviewValidationRules, addReview);
router.get("/my-reviews", protect, getUserReviews);
router.put("/:reviewId", protect, updateReviewValidationRules, updateReview);
router.delete("/:reviewId", protect, deleteReview);

// Admin review-moderation routes now live in routes/admin/reviewAdminRoutes.js
export default router;
