// controllers/review.controller.js
import Review from "../models/Review.js";
import Product from "../models/Product.js";
import mongoose from "mongoose";
import { validationResult } from "express-validator";

// Helper function to update product rating
const updateProductRating = async (productId) => {
    try {
        const stats = await Review.aggregate([
            {
                $match: {
                    product: new mongoose.Types.ObjectId(productId),
                    status: "approved",
                },
            },
            {
                $group: {
                    _id: "$product",
                    averageRating: { $avg: "$rating" },
                    numReviews: { $sum: 1 },
                },
            },
        ]);

        if (stats.length > 0) {
            await Product.findByIdAndUpdate(productId, {
                averageRating: Math.round(stats[0].averageRating * 10) / 10,
                numReviews: stats[0].numReviews,
            });
        } else {
            // No approved reviews, reset ratings
            await Product.findByIdAndUpdate(productId, {
                averageRating: 0,
                numReviews: 0,
            });
        }
    } catch (error) {
        console.error("Error updating product rating:", error);
    }
};

// User adds a review
export const addReview = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: "Validation errors",
                errors: errors.array(),
            });
        }

        const { productId, rating, comment } = req.body;
        const userId = req.user._id;

        // Check if product exists and is active
        const product = await Product.findOne({
            _id: productId,
            isActive: true,
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found or not active",
            });
        }

        // Check if user already reviewed this product
        const existingReview = await Review.findOne({
            product: productId,
            user: userId,
        });

        if (existingReview) {
            return res.status(400).json({
                success: false,
                message: "You have already reviewed this product",
            });
        }

        // Create new review
        const review = new Review({
            product: productId,
            user: userId,
            rating,
            comment,
            status: "pending", // Admin approval required
        });

        const savedReview = await review.save();
        await savedReview.populate("user", "name email");
        await savedReview.populate("product", "name slug");

        res.status(201).json({
            success: true,
            message: "Review submitted successfully. Waiting for admin approval.",
            review: savedReview,
        });
    } catch (error) {
        console.error("Error adding review:", error);
        res.status(500).json({
            success: false,
            message: "Error adding review",
            error: error.message,
        });
    }
};

// Get approved reviews for a product
export const getProductReviews = async (req, res) => {
    try {
        const { productId } = req.params;
        const {
            page = 1,
            limit = 10,
            sortBy = "createdAt",
            sortOrder = "desc",
            rating,
        } = req.query;

        let filter = {
            product: productId,
            status: "approved",
        };

        // Filter by rating if provided
        if (rating && !isNaN(rating)) {
            filter.rating = parseInt(rating);
        }

        const reviews = await Review.find(filter)
            .populate("user", "name email")
            .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Review.countDocuments(filter);

        // Get rating statistics
        const ratingStats = await Review.aggregate([
            {
                $match: {
                    product: new mongoose.Types.ObjectId(productId),
                    status: "approved",
                },
            },
            {
                $group: {
                    _id: "$rating",
                    count: { $sum: 1 },
                },
            },
            {
                $sort: { _id: 1 },
            },
        ]);

        // Calculate total reviews and average rating
        const totalStats = await Review.aggregate([
            {
                $match: {
                    product: new mongoose.Types.ObjectId(productId),
                    status: "approved",
                },
            },
            {
                $group: {
                    _id: "$product",
                    averageRating: { $avg: "$rating" },
                    totalReviews: { $sum: 1 },
                },
            },
        ]);

        res.status(200).json({
            success: true,
            reviews,
            totalPages: Math.ceil(total / limit),
            currentPage: Number(page),
            total,
            ratingStats,
            averageRating: totalStats[0]?.averageRating || 0,
            totalReviews: totalStats[0]?.totalReviews || 0,
        });
    } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching reviews",
            error: error.message,
        });
    }
};

// Get user's own reviews
export const getUserReviews = async (req, res) => {
    try {
        const userId = req.user._id;
        const { page = 1, limit = 10, status } = req.query;

        let filter = { user: userId };
        if (status) {
            filter.status = status;
        }

        const reviews = await Review.find(filter)
            .populate("product", "name slug images price")
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Review.countDocuments(filter);

        res.status(200).json({
            success: true,
            reviews,
            totalPages: Math.ceil(total / limit),
            currentPage: Number(page),
            total,
        });
    } catch (error) {
        console.error("Error fetching user reviews:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching your reviews",
            error: error.message,
        });
    }
};

// User updates their own review (only if pending)
export const updateReview = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: "Validation errors",
                errors: errors.array(),
            });
        }

        const { reviewId } = req.params;
        const { rating, comment } = req.body;
        const userId = req.user._id;

        const review = await Review.findOne({
            _id: reviewId,
            user: userId,
        });

        if (!review) {
            return res.status(404).json({
                success: false,
                message: "Review not found",
            });
        }

        // Only allow update if review is pending
        if (review.status !== "pending") {
            return res.status(400).json({
                success: false,
                message: "Can only update pending reviews",
            });
        }

        // Update review
        if (rating) review.rating = rating;
        if (comment !== undefined) review.comment = comment;

        const updatedReview = await review.save();
        await updatedReview.populate("product", "name slug");

        res.status(200).json({
            success: true,
            message: "Review updated successfully",
            review: updatedReview,
        });
    } catch (error) {
        console.error("Error updating review:", error);
        res.status(500).json({
            success: false,
            message: "Error updating review",
            error: error.message,
        });
    }
};

// User deletes their own review
export const deleteReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const userId = req.user._id;

        const review = await Review.findOne({
            _id: reviewId,
            user: userId,
        });

        if (!review) {
            return res.status(404).json({
                success: false,
                message: "Review not found",
            });
        }

        await Review.findByIdAndDelete(reviewId);

        // If review was approved, update product ratings
        if (review.status === "approved") {
            await updateProductRating(review.product);
        }

        res.status(200).json({
            success: true,
            message: "Review deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting review:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting review",
            error: error.message,
        });
    }
};

// Admin: Get pending reviews
export const getPendingReviews = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;

        // ✅ FIX: "images" doesn't exist on Product top level
        const reviews = await Review.find({ status: "pending" })
            .populate("user", "name email")
            .populate("product", "name slug sku") // ✅ Changed from "images" to "sku"
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Review.countDocuments({ status: "pending" });

        res.status(200).json({
            success: true,
            reviews,
            totalPages: Math.ceil(total / limit),
            currentPage: Number(page),
            total,
        });
    } catch (error) {
        console.error("Error fetching pending reviews:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching pending reviews",
            error: error.message,
        });
    }
};

// Admin: Approve/Reject review
export const updateReviewStatus = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { status, adminNotes } = req.body;

        if (!["approved", "rejected"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Status must be either 'approved' or 'rejected'",
            });
        }

        // ✅ FIX: null (not undefined) so re-approving actually clears a
        // previous rejection's note instead of Mongoose silently
        // dropping the undefined key from the update.
        const review = await Review.findByIdAndUpdate(
            reviewId,
            {
                status,
                adminNotes: status === "rejected" ? adminNotes : null, // ✅ Fixed
            },
            { new: true },
        )
            .populate("user", "name email")
            .populate("product");

        if (!review) {
            return res.status(404).json({
                success: false,
                message: "Review not found",
            });
        }

        // If approved, update product rating statistics
        if (status === "approved") {
            await updateProductRating(review.product._id);
        }

        res.status(200).json({
            success: true,
            message: `Review ${status} successfully`,
            review,
        });
    } catch (error) {
        console.error("Error updating review status:", error);
        res.status(500).json({
            success: false,
            message: "Error updating review status",
            error: error.message,
        });
    }
};

// Admin permanently delete any review (spam/abuse)
export const deleteReviewAdmin = async (req, res) => {
    try {
        const { reviewId } = req.params;

        const review = await Review.findById(reviewId);
        if (!review) {
            return res.status(404).json({
                success: false,
                message: "Review not found",
            });
        }

        await Review.findByIdAndDelete(reviewId);

        // If review was approved, update product ratings
        if (review.status === "approved") {
            await updateProductRating(review.product);
        }

        res.status(200).json({
            success: true,
            message: "Review deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting review (admin):", error);
        res.status(500).json({
            success: false,
            message: "Error deleting review",
            error: error.message,
        });
    }
};

/**
 * @desc Admin adds multiple demo reviews for a product in bulk (Feature 1)
 * @route POST /api/reviews/admin/bulk
 * @access Private/Admin
 */
export const addBulkDemoReviews = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: "Validation errors",
                errors: errors.array(),
            });
        }

        const { productId, reviews: bulkReviews } = req.body;

        // 1. Check if product exists
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        // 2. Prepare reviews for bulk insertion
        const reviewsToInsert = bulkReviews.map((review) => ({
            ...review,
            product: new mongoose.Types.ObjectId(productId),
            user: new mongoose.Types.ObjectId().toHexString(),
            status: "approved",
            adminNotes: "Admin-generated demo review for initial social proof.",
        }));

        // 3. Bulk Insert
        const result = await Review.insertMany(reviewsToInsert, { ordered: false });

        // 4. Update product statistics
        await updateProductRating(productId);

        res.status(201).json({
            success: true,
            message: `Successfully added ${result.length} bulk demo reviews for product ${productId}`,
            insertedCount: result.length,
        });
    } catch (error) {
        console.error("Error adding bulk demo reviews:", error);
        if (error.code === 11000) {
            return res.status(500).json({
                success: false,
                message: "A unique key constraint violation occurred during bulk insert.",
                error: error.message,
            });
        }
        res.status(500).json({
            success: false,
            message: "Error adding bulk demo reviews",
            error: error.message,
        });
    }
};

/**
 * @desc Admin gets all reviews and star analysis statistics (Feature 2)
 * @route GET /api/reviews/admin/all
 * @access Private/Admin
 */
export const getAllReviewsAndStats = async (req, res) => {
    try {
        // FIX: Added page, limit, status query params
        const { page = 1, limit = 10, status } = req.query;
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 10);

        const filter = {};
        if (["pending", "approved", "rejected"].includes(status)) {
            filter.status = status;
        }

        // FIX: "image"/"images" don't exist on Product top level
        // FIX: Added total, totalAll, pendingCount, page, totalPages, averageRating
        const [reviews, total, totalAll, pendingCount] = await Promise.all([
            Review.find(filter)
                .populate("product", "name slug sku") // ✅ Changed from "image"
                .populate("user", "name email")
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            Review.countDocuments(filter),
            Review.countDocuments({}),
            Review.countDocuments({ status: "pending" }),
        ]);

        // --- 2. Star Rating Analysis (Aggregation) ---
        const starStats = await Review.aggregate([
            {
                $match: {
                    status: "approved",
                },
            },
            {
                $group: {
                    _id: "$rating",
                    count: { $sum: 1 },
                },
            },
            {
                $project: {
                    _id: 0,
                    rating: "$_id",
                    count: 1,
                },
            },
            {
                $sort: { rating: -1 },
            },
        ]);

        // 3. Calculate total and percentage for analysis
        const totalApprovedReviews = starStats.reduce((sum, stat) => sum + stat.count, 0);

        const formattedStarStats = starStats.map((stat) => ({
            rating: stat.rating,
            count: stat.count,
            percentage:
                totalApprovedReviews > 0
                    ? parseFloat(((stat.count / totalApprovedReviews) * 100).toFixed(2))
                    : 0,
        }));

        // ✅ NEW: Calculate average rating
        const averageRating =
            totalApprovedReviews > 0
                ? parseFloat(
                      (
                          starStats.reduce((sum, s) => sum + s.rating * s.count, 0) /
                          totalApprovedReviews
                      ).toFixed(2),
                  )
                : 0;

        res.status(200).json({
            success: true,
            message: "All reviews and star statistics retrieved successfully",
            reviews,
            starStats: formattedStarStats,
            totalApprovedReviews,
            // ✅ NEW: Added pagination fields
            total,
            totalAll,
            pendingCount,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum) || 1,
            averageRating,
        });
    } catch (error) {
        console.error("Error retrieving all reviews and statistics:", error);
        res.status(500).json({
            success: false,
            message: "Error retrieving all reviews and statistics",
            error: error.message,
        });
    }
};

// Export the helper function if needed elsewhere
export { updateProductRating };
