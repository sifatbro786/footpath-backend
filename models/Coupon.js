import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: [true, "Coupon code is required"],
            unique: true,
            uppercase: true,
            trim: true,
        },
        description: {
            type: String,
            maxlength: [200, "Description cannot exceed 200 characters"],
            trim: true,
        },
        couponType: {
            type: String,
            enum: ["percentage", "fixed_amount", "free_shipping"],
            required: [true, "Coupon type is required"],
        },
        value: {
            type: Number,
            required: [true, "Discount value is required"],
            min: [0, "Discount value cannot be negative"], // ✅ min 1 থেকে 0 করা হয়েছে
            validate: {
                validator: function (v) {
                    if (this.couponType === "free_shipping") {
                        return true; // free_shipping এর জন্য যেকোনো value accept করবে
                    }
                    return v >= 1; // অন্য টাইপের জন্য minimum 1
                },
                message: "Discount value must be at least 1 for non-free shipping coupons",
            },
        },
        minOrderAmount: {
            type: Number,
            default: 0,
            min: [0, "Minimum order amount cannot be negative"],
        },
        // FIX: pricingService.js's applyCouponLogic already reads `coupon.maxDiscountAmount`
        // to cap percentage discounts (e.g. "20% off, up to ৳500") but this field never
        // existed on the schema, so `coupon.maxDiscountAmount` was always undefined and the
        // cap silently never applied — a 20%-off coupon on a ৳50,000 order gave ৳10,000 off
        // with no ceiling. Only meaningful for couponType "percentage"; ignored otherwise.
        maxDiscountAmount: {
            type: Number,
            default: null,
            min: [0, "Maximum discount amount cannot be negative"],
        },
        maxUsage: {
            type: Number,
            default: 0,
        },
        usedCount: {
            type: Number,
            default: 0,
            select: false,
        },
        usagePerCustomer: {
            type: Number,
            default: 1,
        },
        appliesTo: {
            type: String,
            enum: ["all", "products", "categories"],
            default: "all",
        },
        productRestrictions: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product",
            },
        ],
        categoryRestrictions: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Category",
            },
        ],
        startDate: {
            type: Date,
            required: [true, "Start date is required"],
        },
        expiryDate: {
            type: Date,
            required: [true, "Expiry date is required"],
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    },
);

// ✅ Pre-save hook - নতুন এবং আপডেট দুই ক্ষেত্রেই কাজ করবে
couponSchema.pre("save", function (next) {
    // Start date must be before expiry date
    if (this.startDate && this.expiryDate) {
        if (this.startDate >= this.expiryDate) {
            const error = new Error("Start date must be before expiry date");
            error.name = "ValidationError";
            return next(error);
        }
    }

    // Free shipping এর জন্য value 0 সেট করুন
    if (this.couponType === "free_shipping") {
        this.value = 0;
    }

    // Percentage discount value চেক
    if (this.couponType === "percentage" && this.value > 100) {
        const error = new Error("Percentage discount value cannot exceed 100");
        error.name = "ValidationError";
        return next(error);
    }

    next();
});

// ✅ Pre-findOneAndUpdate hook - updateOne/findByIdAndUpdate এর জন্য
couponSchema.pre("findOneAndUpdate", function (next) {
    const update = this.getUpdate();

    // যদি free_shipping টাইপ হয়, value 0 করে দিন
    if (update.couponType === "free_shipping") {
        update.value = 0;
    }

    // Percentage value check
    if (update.couponType === "percentage" && update.value > 100) {
        const error = new Error("Percentage discount value cannot exceed 100");
        error.name = "ValidationError";
        return next(error);
    }

    // Start/Expiry date validation
    if (update.startDate && update.expiryDate) {
        if (new Date(update.startDate) >= new Date(update.expiryDate)) {
            const error = new Error("Start date must be before expiry date");
            error.name = "ValidationError";
            return next(error);
        }
    }

    next();
});

couponSchema.virtual("isExpired").get(function () {
    return this.expiryDate < new Date();
});

const Coupon = mongoose.model("Coupon", couponSchema);
export default Coupon;
