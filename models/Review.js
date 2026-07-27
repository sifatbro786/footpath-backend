// models/review.model.js
import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
    {
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
        },
        comment: {
            type: String,
            trim: true,
            maxlength: 1000,
        },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },
        adminNotes: {
            type: String,
            trim: true,
        },
        isHelpful: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
            },
        ],
        helpfulCount: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    },
);

// Compound index for better query performance
reviewSchema.index({ product: 1, status: 1 });
reviewSchema.index({ user: 1, product: 1 }, { unique: true }); // One review per product per user
reviewSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("Review", reviewSchema);
