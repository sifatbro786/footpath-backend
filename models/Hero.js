// models/heroModel.js
import mongoose from "mongoose";

const heroItemSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },
        subtitle: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },
        buttonText: {
            type: String,
            default: "Get Started",
            trim: true,
            maxlength: 30,
        },
        mediaType: {
            type: String,
            enum: ["video", "image"],
            required: true,
        },
        mediaUrl: {
            type: String,
            required: true,
        },
        deviceType: {
            type: String,
            enum: ["desktop", "mobile", "both"],
            default: "both",
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        order: {
            type: Number,
            default: 0,
        },
        duration: {
            type: Number,
            default: 5, // seconds for image slides
        },
    },
    {
        timestamps: true,
    },
);

const HeroItem = mongoose.model("HeroItem", heroItemSchema);
export default HeroItem;
