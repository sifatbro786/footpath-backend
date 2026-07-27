// models/coupon.model.js
import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: [true, "Coupon code is required"],
            unique: true,
            uppercase: true,
            trim: true,
            maxlength: [20, "Coupon code cannot exceed 20 characters"],
        },
        description: {
            type: String,
            trim: true,
        },
        discountType: {
            type: String,
            enum: ["percentage", "fixed"],
            required: true,
            default: "percentage",
        },
        discountValue: {
            type: Number,
            required: [true, "Discount value is required"],
            min: [0, "Discount value cannot be negative"],
        },
        // For percentage discounts
        maxDiscountAmount: {
            type: Number,
            min: 0,
        },
        minOrderAmount: {
            type: Number,
            min: 0,
            default: 0,
        },
        startDate: {
            type: Date,
            required: [true, "Start date is required"],
        },
        endDate: {
            type: Date,
            required: [true, "End date is required"],
        },
        usageLimit: {
            type: Number,
            min: 0,
        },
        usedCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        perUserLimit: {
            type: Number,
            min: 1,
            default: 1,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        applicableCategories: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Category",
            },
        ],
        excludedCategories: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Category",
            },
        ],
        applicableProducts: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product",
            },
        ],
        excludedProducts: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product",
            },
        ],
        userRestrictions: {
            specificUsers: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User",
                },
            ],
            minOrders: {
                type: Number,
                min: 0,
                default: 0,
            },
            userGroups: [
                {
                    type: String,
                    enum: ["new", "regular", "vip"],
                },
            ],
        },
        conditions: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    },
);

// Virtual for checking if coupon is currently active
couponSchema.virtual("isCurrentlyActive").get(function () {
    const now = new Date();
    return (
        this.isActive &&
        this.startDate <= now &&
        this.endDate >= now &&
        (this.usageLimit ? this.usedCount < this.usageLimit : true)
    );
});

// Virtual for checking remaining uses
couponSchema.virtual("remainingUses").get(function () {
    return this.usageLimit ? this.usageLimit - this.usedCount : null;
});

// Index for better performance
couponSchema.index({ code: 1 });
couponSchema.index({ startDate: 1, endDate: 1 });
couponSchema.index({ isActive: 1 });
couponSchema.index({ applicableCategories: 1 });

// Pre-save validation
couponSchema.pre("save", function (next) {
    if (this.startDate >= this.endDate) {
        return next(new Error("End date must be after start date"));
    }

    if (this.discountType === "percentage" && this.discountValue > 100) {
        return next(new Error("Percentage discount cannot exceed 100%"));
    }

    // Auto-generate code if not provided
    if (!this.code) {
        this.code = `CPN${Date.now().toString(36).toUpperCase()}`;
    }

    next();
});

export default mongoose.model("Coupon", couponSchema);
