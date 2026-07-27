// models/promotion.model.js
import mongoose from "mongoose";

const promotionSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: String,
        type: {
            type: String,
            enum: ["cart_discount", "product_discount", "abandoned_cart"],
            default: "abandoned_cart",
        },
        targetUsers: {
            type: String,
            enum: ["all", "abandoned_cart_users", "specific_users"],
            default: "abandoned_cart_users",
        },
        discountType: {
            type: String,
            enum: ["percentage", "fixed_amount"],
            required: true,
        },
        discountValue: {
            type: Number,
            required: true,
        },
        minimumCartValue: Number,
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
        startDate: {
            type: Date,
            required: true,
        },
        endDate: {
            type: Date,
            required: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        maxUsage: Number,
        currentUsage: {
            type: Number,
            default: 0,
        },
        notificationSent: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
            },
        ],
    },
    {
        timestamps: true,
    },
);

const Promotion = mongoose.model("Promotion", promotionSchema);
export default Promotion;
