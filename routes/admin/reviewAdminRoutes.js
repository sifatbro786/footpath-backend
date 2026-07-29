import express from "express";
import {
    getPendingReviews,
    updateReviewStatus,
    addBulkDemoReviews,
    getAllReviewsAndStats,
    deleteReviewAdmin,
} from "../../controllers/reviewController.js";
import { body } from "express-validator";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

const bulkReviewValidationRules = [
    body("productId").isMongoId().withMessage("Valid product ID is required"),
    body("reviews").isArray({ min: 1 }).withMessage("Must provide an array of at least one review"),
    body("reviews.*.rating")
        .isInt({ min: 1, max: 5 })
        .withMessage("Each review rating must be between 1 and 5"),
    body("reviews.*.comment")
        .optional()
        .isLength({ max: 1000 })
        .withMessage("Each review comment is too long"),
];

router.get("/pending", getPendingReviews);
router.get("/all", getAllReviewsAndStats);
router.post("/bulk", bulkReviewValidationRules, addBulkDemoReviews);
router.patch("/:reviewId/status", updateReviewStatus);
router.delete("/:reviewId", deleteReviewAdmin);

export default router;
