// controllers/heroContentController.js

import HeroContent from "../models/HeroContent.js";
import asyncHandler from "express-async-handler"; // ধরে নিলাম আপনি এটি ব্যবহার করছেন

// @desc    Get all active hero content, grouped by device type
// @route   GET /api/v1/hero
// @access  Public
const getActiveHeroContent = asyncHandler(async (req, res) => {
    const activeContent = await HeroContent.find({ isActive: true }).sort({ order: 1 });

    // Group content for frontend
    const desktopVideos = activeContent
        .filter((item) => item.deviceType === "desktop" && item.mediaType === "video")
        .map((item) => item.mediaUrl);

    const desktopImages = activeContent
        .filter((item) => item.deviceType === "desktop" && item.mediaType === "image")
        .map((item) => item.mediaUrl);

    const mobileVideos = activeContent
        .filter((item) => item.deviceType === "mobile" && item.mediaType === "video")
        .map((item) => item.mediaUrl);

    const mobileImages = activeContent
        .filter((item) => item.deviceType === "mobile" && item.mediaType === "image")
        .map((item) => item.mediaUrl);

    res.json({
        desktopVideos,
        desktopImages,
        mobileVideos,
        mobileImages,
        // Note: If you want to send the full object, you can group by deviceType only
    });
});

// --- Admin CRUD Operations ---

// @desc    Get all hero content (for Admin panel)
// @route   GET /api/v1/admin/hero
// @access  Private/Admin
const getAllHeroContent = asyncHandler(async (req, res) => {
    const content = await HeroContent.find({}).sort({ deviceType: 1, order: 1 });
    res.json(content);
});

// @desc    Create new hero content
// @route   POST /api/v1/admin/hero
// @access  Private/Admin
const createHeroContent = asyncHandler(async (req, res) => {
    const {
        title,
        subtitle,
        buttonText,
        buttonLink,
        mediaType,
        mediaUrl,
        deviceType,
        order,
        isActive,
    } = req.body;

    const newContent = new HeroContent({
        title,
        subtitle,
        buttonText,
        buttonLink,
        mediaType,
        mediaUrl,
        deviceType,
        order: order || 0,
        isActive: isActive !== undefined ? isActive : true,
    });

    const createdContent = await newContent.save();
    res.status(201).json(createdContent);
});

// @desc    Update hero content
// @route   PUT /api/v1/admin/hero/:id
// @access  Private/Admin
const updateHeroContent = asyncHandler(async (req, res) => {
    const {
        title,
        subtitle,
        buttonText,
        buttonLink,
        mediaType,
        mediaUrl,
        deviceType,
        order,
        isActive,
    } = req.body;
    const content = await HeroContent.findById(req.params.id);

    if (content) {
        content.title = title || content.title;
        content.subtitle = subtitle || content.subtitle;
        content.buttonText = buttonText !== undefined ? buttonText : content.buttonText;
        content.buttonLink = buttonLink !== undefined ? buttonLink : content.buttonLink;
        content.mediaType = mediaType || content.mediaType;
        content.mediaUrl = mediaUrl || content.mediaUrl;
        content.deviceType = deviceType || content.deviceType;
        content.order = order !== undefined ? order : content.order;
        content.isActive = isActive !== undefined ? isActive : content.isActive;

        const updatedContent = await content.save();
        res.json(updatedContent);
    } else {
        res.status(404);
        throw new Error("Hero content not found");
    }
});

// @desc    Delete hero content
// @route   DELETE /api/v1/admin/hero/:id
// @access  Private/Admin
const deleteHeroContent = asyncHandler(async (req, res) => {
    const content = await HeroContent.findById(req.params.id);

    if (content) {
        await HeroContent.deleteOne({ _id: content._id });
        res.json({ message: "Hero content removed" });
    } else {
        res.status(404);
        throw new Error("Hero content not found");
    }
});

export {
    getActiveHeroContent,
    getAllHeroContent,
    createHeroContent,
    updateHeroContent,
    deleteHeroContent,
};
