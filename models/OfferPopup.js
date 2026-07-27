// models/OfferPopup.js
import mongoose from "mongoose";

const offerPopupSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: [true, "Offer title is required"],
            trim: true,
            maxlength: [200, "Title cannot exceed 200 characters"],
        },
        description: {
            type: String,
            required: [true, "Offer description is required"],
            maxlength: [1000, "Description cannot exceed 1000 characters"],
        },
        thumbnailImage: {
            type: String,
            required: [true, "Thumbnail image is required"],
        },
        buttonText: {
            type: String,
            required: [true, "Button text is required"],
            default: "Shop Now",
            maxlength: [50, "Button text cannot exceed 50 characters"],
        },
        buttonLink: {
            type: String,
            required: [true, "Button navigation link is required"],
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        startDate: {
            type: Date,
            default: Date.now,
        },
        endDate: {
            type: Date,
        },
        displayFrequency: {
            type: String,
            enum: ["once", "daily", "always"],
            default: "once",
        },
        priority: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    {
        timestamps: true,
    },
);

// Index for faster queries
offerPopupSchema.index({ isActive: 1, priority: -1 });
offerPopupSchema.index({ startDate: 1, endDate: 1 });

const OfferPopup = mongoose.model("OfferPopup", offerPopupSchema);

export default OfferPopup;
