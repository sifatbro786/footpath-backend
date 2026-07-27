// models/HeroContentModel.js

import mongoose from "mongoose";

const HeroContentSchema = mongoose.Schema(
    {
        // Common fields
        title: {
            type: String,
            required: [true, "Title is required"],
            trim: true,
            maxlength: 100,
        },
        subtitle: {
            type: String,
            required: [true, "Subtitle is required"],
            trim: true,
            maxlength: 250,
        },
        buttonText: {
            type: String,
            default: "Get Started",
            trim: true,
            maxlength: 50,
        },
        buttonLink: {
            type: String,
            default: "#",
            trim: true,
        },

        // Media fields
        mediaType: {
            // 'video' or 'image'
            type: String,
            required: [true, "Media type is required"],
            enum: ["video", "image"],
            default: "video",
        },
        mediaUrl: {
            type: String,
            required: [true, "Media URL is required"],
            trim: true,
        },

        // Device specific field
        deviceType: {
            // 'desktop' or 'mobile'
            type: String,
            required: [true, "Device type is required"],
            enum: ["desktop", "mobile"],
        },

        // Optional: To control the order of slides
        order: {
            type: Number,
            default: 0,
        },

        // Optional: To enable/disable a slide
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    },
);

const HeroContent = mongoose.model("HeroContent", HeroContentSchema);

export default HeroContent;
