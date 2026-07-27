import mongoose from "mongoose";

const dynamicSectionSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: [true, "Section title is required"],
            trim: true,
            maxlength: [100, "Title cannot exceed 100 characters"],
        },
        description: {
            type: String,
            trim: true,
            maxlength: [200, "Description cannot exceed 200 characters"],
        },
        attributeKey: {
            type: String,
            required: [true, "Attribute key is required"],
            trim: true,
        },
        attributeValue: {
            type: String,
            required: [true, "Attribute value is required"],
            trim: true,
        },
        productLimit: {
            type: Number,
            default: 8,
            min: 1,
            max: 20,
        },
        sortBy: {
            type: String,
            enum: ["createdAt", "price", "name", "averageRating", "discountPercentage", "stock"],
            default: "createdAt",
        },
        sortOrder: {
            type: String,
            enum: ["asc", "desc"],
            default: "desc",
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        displayOrder: {
            type: Number,
            default: 0,
        },
        showInHomepage: {
            type: Boolean,
            default: true,
        },
        sectionType: {
            type: String,
            enum: ["attribute-based", "featured", "category-based", "manual"],
            default: "attribute-based",
        },
        customProducts: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product",
            },
        ],
        backgroundColor: {
            type: String,
            default: "#ffffff",
        },
        textColor: {
            type: String,
            default: "#000000",
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
    },
    {
        timestamps: true,
    },
);

// Index for better performance
dynamicSectionSchema.index({ isActive: 1, showInHomepage: 1, displayOrder: 1 });
dynamicSectionSchema.index({ attributeKey: 1, attributeValue: 1 });

export default mongoose.model("DynamicSection", dynamicSectionSchema);
