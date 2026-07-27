import mongoose from "mongoose";

const productCampaignSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Campaign name is required"],
            trim: true,
            maxlength: [200, "Campaign name cannot exceed 200 characters"],
        },
        slug: {
            type: String,
            unique: true,
            lowercase: true,
            index: true,
        },
        description: {
            type: String,
            trim: true,
        },
        discountType: {
            type: String,
            enum: ["percentage", "fixed"],
            required: true,
        },
        discountValue: {
            type: Number,
            required: true,
            min: [0, "Discount value cannot be negative"],
            validate: {
                validator: function (value) {
                    if (this.discountType === "percentage") {
                        return value <= 100;
                    }
                    return true;
                },
                message: "Percentage discount cannot exceed 100%",
            },
        },
        // Campaign type: all_products or specific_products
        campaignType: {
            type: String,
            enum: ["all_products", "specific_products", "category_based"],
            default: "all_products",
        },
        // Specific product IDs (if campaignType is specific_products)
        productIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product",
            },
        ],
        // Category based filtering (if campaignType is category_based)
        categoryIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Category",
            },
        ],
        // Minimum purchase quantity (optional)
        minQuantity: {
            type: Number,
            default: 1,
            min: 1,
        },
        // Maximum discount per product (optional)
        maxDiscountAmount: {
            type: Number,
            default: null,
        },
        // Campaign schedule
        startDate: {
            type: Date,
            required: [true, "Start date is required"],
        },
        endDate: {
            type: Date,
            required: [true, "End date is required"],
        },
        // Status
        isActive: {
            type: Boolean,
            default: true,
        },
        // Priority (higher priority campaigns override lower ones)
        priority: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        // Created by
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        // Track affected products for rollback
        affectedProducts: [
            {
                productId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Product",
                },
                originalPrice: Number,
                originalDiscountType: String,
                originalDiscountValue: Number,
                campaignPrice: Number,
            },
        ],
    },
    {
        timestamps: true,
    },
);

// Slug generation middleware
productCampaignSchema.pre("save", function (next) {
    if (this.isModified("name") && this.name) {
        this.slug = this.name
            .toLowerCase()
            .trim()
            .replace(/[^a-zA-Z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");

        if (!this.slug) {
            this.slug = "campaign-" + Date.now();
        }
    }
    next();
});

// Check if campaign is currently active
productCampaignSchema.methods.isCurrentlyActive = function () {
    const now = new Date();
    return this.isActive && this.startDate <= now && this.endDate >= now;
};

// Get eligible product IDs for this campaign
productCampaignSchema.methods.getEligibleProductIds = async function () {
    if (this.campaignType === "all_products") {
        const products = await mongoose
            .model("Product")
            .find({ isActive: true }, { _id: 1 })
            .lean();
        return products.map((p) => p._id.toString());
    }

    if (this.campaignType === "specific_products") {
        return this.productIds.map((id) => id.toString());
    }

    if (this.campaignType === "category_based") {
        const products = await mongoose
            .model("Product")
            .find(
                {
                    isActive: true,
                    category: { $in: this.categoryIds },
                },
                { _id: 1 },
            )
            .lean();
        return products.map((p) => p._id.toString());
    }

    return [];
};

// Calculate campaign price for a product
productCampaignSchema.methods.calculateCampaignPrice = function (originalPrice) {
    if (this.discountType === "percentage") {
        let discountedPrice = originalPrice - (originalPrice * this.discountValue) / 100;
        if (this.maxDiscountAmount) {
            const maxPossibleDiscount = Math.min(
                (originalPrice * this.discountValue) / 100,
                this.maxDiscountAmount,
            );
            discountedPrice = originalPrice - maxPossibleDiscount;
        }
        return Math.max(0, discountedPrice);
    } else if (this.discountType === "fixed") {
        let discountedPrice = originalPrice - this.discountValue;
        if (this.maxDiscountAmount) {
            discountedPrice = originalPrice - Math.min(this.discountValue, this.maxDiscountAmount);
        }
        return Math.max(0, discountedPrice);
    }
    return originalPrice;
};

// Indexes
productCampaignSchema.index({ startDate: 1, endDate: 1 });
productCampaignSchema.index({ isActive: 1, startDate: 1, endDate: 1 });
productCampaignSchema.index({ campaignType: 1 });
productCampaignSchema.index({ priority: -1 });
// productCampaignSchema.index({ slug: 1 });

export default mongoose.model("ProductCampaign", productCampaignSchema);
