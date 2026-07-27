// controllers/heroController.js
// Extracted from the old routes/heroRoutes.js (which had all logic inline,
// no controller) while splitting admin routes out per the folder restructure.
import HeroItem from "../models/Hero.js";

// @desc    Get all active hero items
// @route   GET /api/v1/hero-items
// @access  Public
export const getActiveHeroItems = async (req, res) => {
    try {
        const { device } = req.query;

        let filter = { isActive: true };

        if (device && ["desktop", "mobile"].includes(device)) {
            filter.$or = [{ deviceType: device }, { deviceType: "both" }];
        }

        const heroItems = await HeroItem.find(filter)
            .sort({ order: 1, createdAt: -1 })
            .select("-__v");

        res.status(200).json({
            success: true,
            message: "Hero items fetched successfully",
            data: heroItems,
            count: heroItems.length,
        });
    } catch (error) {
        console.error("Error fetching hero items:", error);
        res.status(500).json({
            success: false,
            message: "Server Error",
            error: error.message,
        });
    }
};

// @desc    Get hero item by ID
// @route   GET /api/v1/hero-items/:id
// @access  Public
export const getHeroItemById = async (req, res) => {
    try {
        const heroItem = await HeroItem.findById(req.params.id);

        if (!heroItem) {
            return res.status(404).json({
                success: false,
                message: "Hero item not found",
            });
        }

        res.json({
            success: true,
            data: heroItem,
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
