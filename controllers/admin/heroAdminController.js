// controllers/admin/heroAdminController.js
// Extracted from the old routes/heroRoutes.js while splitting admin routes
// out per the folder restructure.
import HeroItem from "../../models/Hero.js";

// @desc    Create new hero item
// @route   POST /api/v1/admin/hero-items
// @access  Private/Admin
export const createHeroItem = async (req, res) => {
    try {
        const { title, subtitle, buttonText, mediaType, mediaUrl, deviceType, order, duration } =
            req.body;

        if (!title || !subtitle || !mediaType || !mediaUrl) {
            return res.status(400).json({
                success: false,
                message: "Title, subtitle, mediaType and mediaUrl are required",
            });
        }

        if (!["video", "image"].includes(mediaType)) {
            return res.status(400).json({
                success: false,
                message: "Media type must be either 'video' or 'image'",
            });
        }

        const heroItem = new HeroItem({
            title,
            subtitle,
            buttonText: buttonText || "Get Started",
            mediaType,
            mediaUrl,
            deviceType: deviceType || "both",
            order: order || 0,
            duration: duration || (mediaType === "image" ? 5 : 0),
        });

        const createdHero = await heroItem.save();

        res.status(201).json({
            success: true,
            message: "Hero item created successfully",
            data: createdHero,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: error.message,
        });
    }
};

// @desc    Update hero item
// @route   PUT /api/v1/admin/hero-items/:id
// @access  Private/Admin
export const updateHeroItem = async (req, res) => {
    try {
        const {
            title,
            subtitle,
            buttonText,
            mediaType,
            mediaUrl,
            deviceType,
            isActive,
            order,
            duration,
        } = req.body;

        const heroItem = await HeroItem.findById(req.params.id);

        if (!heroItem) {
            return res.status(404).json({
                success: false,
                message: "Hero item not found",
            });
        }

        if (title !== undefined) heroItem.title = title;
        if (subtitle !== undefined) heroItem.subtitle = subtitle;
        if (buttonText !== undefined) heroItem.buttonText = buttonText;
        if (mediaType !== undefined) heroItem.mediaType = mediaType;
        if (mediaUrl !== undefined) heroItem.mediaUrl = mediaUrl;
        if (deviceType !== undefined) heroItem.deviceType = deviceType;
        if (isActive !== undefined) heroItem.isActive = isActive;
        if (order !== undefined) heroItem.order = order;
        if (duration !== undefined) heroItem.duration = duration;

        const updatedHero = await heroItem.save();

        res.json({
            success: true,
            message: "Hero item updated successfully",
            data: updatedHero,
        });
    } catch (error) {
        if (error.kind === "ObjectId") {
            return res.status(404).json({
                success: false,
                message: "Hero item not found",
            });
        }
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: error.message,
        });
    }
};

// @desc    Delete hero item
// @route   DELETE /api/v1/admin/hero-items/:id
// @access  Private/Admin
export const deleteHeroItem = async (req, res) => {
    try {
        const heroItem = await HeroItem.findById(req.params.id);

        if (!heroItem) {
            return res.status(404).json({
                success: false,
                message: "Hero item not found",
            });
        }

        await HeroItem.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: "Hero item deleted successfully",
        });
    } catch (error) {
        if (error.kind === "ObjectId") {
            return res.status(404).json({
                success: false,
                message: "Hero item not found",
            });
        }
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: error.message,
        });
    }
};

// @desc    Bulk update hero items order
// @route   PUT /api/v1/admin/hero-items
// @access  Private/Admin
export const reorderHeroItems = async (req, res) => {
    try {
        const { items } = req.body; // items: [{id, order}, ...]

        if (!Array.isArray(items)) {
            return res.status(400).json({
                success: false,
                message: "Items array is required",
            });
        }

        const bulkOps = items.map((item) => ({
            updateOne: {
                filter: { _id: item.id },
                update: { order: item.order },
            },
        }));

        await HeroItem.bulkWrite(bulkOps);

        res.json({
            success: true,
            message: "Hero items order updated successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: error.message,
        });
    }
};
