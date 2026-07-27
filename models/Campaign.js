// models/campaign.model.js
import mongoose from "mongoose";
import slugify from "slugify";

const campaignSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        promotion: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Promotion",
            required: true,
        },
        slug: {
            type: String,
            unique: true,
            sparse: true,
        },
        cartItems: [
            {
                product: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Product",
                },
                variant: mongoose.Schema.Types.Mixed,
                originalPrice: Number,
                discountedPrice: Number,
                quantity: Number,
            },
        ],
        status: {
            type: String,
            enum: ["active", "used", "expired"],
            default: "active",
        },
        usedAt: Date,
        expiresAt: {
            type: Date,
            required: true,
        },
    },
    {
        timestamps: true,
    },
);

campaignSchema.pre("save", function (next) {
    if (this.isNew) {
        const timestamp = Date.now().toString(36);
        const randomStr = Math.random().toString(36).substring(2, 8);
        this.slug = `campaign-${timestamp}-${randomStr}`;
    }
    next();
});

campaignSchema.index({ user: 1, status: 1 });
campaignSchema.index({ expiresAt: 1 });

const Campaign = mongoose.model("Campaign", campaignSchema);
export default Campaign;
