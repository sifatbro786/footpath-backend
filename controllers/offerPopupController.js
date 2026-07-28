// controllers/offerPopupController.js
import OfferPopup from "../models/OfferPopup.js";
import { escapeRegex } from "../utils/escapeRegex.js";

// @desc    Get active offers for frontend
// @route   GET /api/offers/active
// @access  Public
export const getActiveOffers = async (req, res) => {
    try {
        const now = new Date();

        const activeOffers = await OfferPopup.find({
            isActive: true,
            $or: [{ endDate: { $gte: now } }, { endDate: null }],
            startDate: { $lte: now },
        })
            .sort({ priority: -1, createdAt: -1 })
            .select("-createdBy -updatedBy -__v");

        res.status(200).json({
            success: true,
            count: activeOffers.length,
            data: activeOffers,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch active offers",
            error: error.message,
        });
    }
};

// @desc    Get single offer by ID
// @route   GET /api/offers/:id
// @access  Public
export const getOfferById = async (req, res) => {
    try {
        const offer = await OfferPopup.findById(req.params.id).select("-createdBy -updatedBy -__v");

        if (!offer) {
            return res.status(404).json({
                success: false,
                message: "Offer not found",
            });
        }

        res.status(200).json({
            success: true,
            data: offer,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch offer",
            error: error.message,
        });
    }
};

// @desc    Create new offer (Admin only)
// @route   POST /api/admin/offers
// @access  Private/Admin
export const createOffer = async (req, res) => {
    try {
        const {
            title,
            description,
            thumbnailImage,
            buttonText,
            buttonLink,
            startDate,
            endDate,
            displayFrequency,
            priority,
            isActive,
        } = req.body;

        // Validate required fields
        if (!title || !description || !thumbnailImage || !buttonLink) {
            return res.status(400).json({
                success: false,
                message:
                    "Please provide all required fields: title, description, thumbnailImage, buttonLink",
            });
        }

        const offerData = {
            title,
            description,
            thumbnailImage,
            buttonText: buttonText || "Shop Now",
            buttonLink,
            startDate: startDate || new Date(),
            endDate,
            displayFrequency: displayFrequency || "once",
            priority: priority || 0,
            isActive: isActive !== undefined ? isActive : true,
            createdBy: req.user._id,
        };

        const offer = await OfferPopup.create(offerData);

        res.status(201).json({
            success: true,
            message: "Offer created successfully",
            data: offer,
        });
    } catch (error) {
        // Handle validation errors
        if (error.name === "ValidationError") {
            const messages = Object.values(error.errors).map((err) => err.message);
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: messages,
            });
        }

        res.status(500).json({
            success: false,
            message: "Failed to create offer",
            error: error.message,
        });
    }
};

// @desc    Update offer (Admin only)
// @route   PUT /api/admin/offers/:id
// @access  Private/Admin
export const updateOffer = async (req, res) => {
    try {
        const offer = await OfferPopup.findById(req.params.id);

        if (!offer) {
            return res.status(404).json({
                success: false,
                message: "Offer not found",
            });
        }

        const updateData = {
            ...req.body,
            updatedBy: req.user._id,
        };

        const updatedOffer = await OfferPopup.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true,
        });

        res.status(200).json({
            success: true,
            message: "Offer updated successfully",
            data: updatedOffer,
        });
    } catch (error) {
        if (error.name === "ValidationError") {
            const messages = Object.values(error.errors).map((err) => err.message);
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: messages,
            });
        }

        res.status(500).json({
            success: false,
            message: "Failed to update offer",
            error: error.message,
        });
    }
};

// @desc    Delete offer (Admin only)
// @route   DELETE /api/admin/offers/:id
// @access  Private/Admin
export const deleteOffer = async (req, res) => {
    try {
        const offer = await OfferPopup.findById(req.params.id);

        if (!offer) {
            return res.status(404).json({
                success: false,
                message: "Offer not found",
            });
        }

        await OfferPopup.findByIdAndDelete(req.params.id);

        res.status(200).json({
            success: true,
            message: "Offer deleted successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to delete offer",
            error: error.message,
        });
    }
};

// @desc    Get all offers with filters (Admin only)
// @route   GET /api/admin/offers
// @access  Private/Admin
export const getAllOffers = async (req, res) => {
    try {
        const { page = 1, limit = 10, sort = "-createdAt", status, search } = req.query;

        const query = {};

        // Filter by active status
        if (status === "active") {
            query.isActive = true;
        } else if (status === "inactive") {
            query.isActive = false;
        }

        // Search by title
        if (search) {
            query.title = { $regex: escapeRegex(search), $options: "i" };
        }

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort,
        };

        const offers = await OfferPopup.find(query)
            .sort(sort)
            .skip((options.page - 1) * options.limit)
            .limit(options.limit)
            .populate("createdBy", "name email")
            .populate("updatedBy", "name email");

        const total = await OfferPopup.countDocuments(query);

        res.status(200).json({
            success: true,
            data: offers,
            pagination: {
                total,
                page: options.page,
                pages: Math.ceil(total / options.limit),
                limit: options.limit,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch offers",
            error: error.message,
        });
    }
};

// @desc    Toggle offer active status (Admin only)
// @route   PATCH /api/admin/offers/:id/toggle
// @access  Private/Admin
export const toggleOfferStatus = async (req, res) => {
    try {
        const offer = await OfferPopup.findById(req.params.id);

        if (!offer) {
            return res.status(404).json({
                success: false,
                message: "Offer not found",
            });
        }

        offer.isActive = !offer.isActive;
        offer.updatedBy = req.user._id;
        await offer.save();

        res.status(200).json({
            success: true,
            message: `Offer ${offer.isActive ? "activated" : "deactivated"} successfully`,
            data: offer,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to toggle offer status",
            error: error.message,
        });
    }
};
