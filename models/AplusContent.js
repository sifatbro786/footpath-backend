import mongoose from "mongoose";

const aplusContentSchema = new mongoose.Schema(
    {
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
            unique: true,
        },
        title: {
            type: String,
            trim: true,
        },
        sections: [
            {
                type: {
                    type: String,
                    enum: [
                        "comparison",
                        "imageGallery",
                        "text",
                        "video",
                        "specifications",
                        "features",
                    ],
                    default: "text",
                },
                title: { type: String, trim: true },
                content: { type: String }, // HTML content
                images: [
                    {
                        url: { type: String },
                        alt: { type: String },
                        caption: { type: String },
                    },
                ],
                videos: [
                    {
                        url: { type: String },
                        title: { type: String },
                        thumbnail: { type: String },
                    },
                ],
                specifications: [
                    {
                        key: { type: String },
                        value: { type: String },
                    },
                ],
                comparisonData: [
                    {
                        feature: { type: String },
                        ourProduct: { type: String },
                        competitor: { type: String },
                    },
                ],
                order: { type: Number, default: 0 },
            },
        ],
        isActive: {
            type: Boolean,
            default: true,
        },
        metaData: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    },
);

// Indexes
// aplusContentSchema.index({ productId: 1 });
aplusContentSchema.index({ isActive: 1 });

export default mongoose.model("AplusContent", aplusContentSchema);
