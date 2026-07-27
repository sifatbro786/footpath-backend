import ProductCampaign from "../models/ProductCampaign.js";
import Product from "../models/Product.js";
import ProductCampaignService from "../services/productCampaignService.js";
import { validationResult } from "express-validator";

// Create a new campaign
export const createCampaign = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array(),
            });
        }

        let {
            name,
            description,
            discountType,
            discountValue,
            campaignType,
            productIds,
            categoryIds,
            startDate,
            endDate,
            minQuantity,
            maxDiscountAmount,
            priority,
        } = req.body;

        const convertToUTC = (dateString) => {
            if (!dateString) return null;
            const date = new Date(dateString);
            return date;
        };
        const startDateUTC = convertToUTC(startDate);
        const endDateUTC = convertToUTC(endDate);

        // Validate dates
        if (startDateUTC >= endDateUTC) {
            return res.status(400).json({
                success: false,
                message: "End date must be after start date",
            });
        }

        const campaign = new ProductCampaign({
            name,
            description,
            discountType,
            discountValue,
            campaignType: campaignType || "all_products",
            productIds: productIds || [],
            categoryIds: categoryIds || [],
            startDate: startDateUTC,
            endDate: endDateUTC,
            minQuantity: minQuantity || 1,
            maxDiscountAmount: maxDiscountAmount || null,
            priority: priority || 0,
            createdBy: req.user._id,
        });

        const savedCampaign = await campaign.save();

        const nowUTC = new Date();
        const isActiveNow =
            savedCampaign.isActive &&
            savedCampaign.startDate <= nowUTC &&
            savedCampaign.endDate >= nowUTC;

        if (isActiveNow) {
            console.log(`Campaign ${savedCampaign._id} is active now, applying...`);
            ProductCampaignService.applyCampaign(savedCampaign._id).catch(console.error);
        }

        res.status(201).json({
            success: true,
            message: "Campaign created successfully",
            campaign: savedCampaign,
        });
    } catch (error) {
        console.error("Error creating campaign:", error);
        res.status(500).json({
            success: false,
            message: "Error creating campaign",
            error: error.message,
        });
    }
};

// Get all campaigns
export const getCampaigns = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            isActive,
            status, // upcoming, active, ended
        } = req.query;

        const filter = {};

        if (isActive !== undefined) {
            filter.isActive = isActive === "true";
        }

        const now = new Date();

        if (status === "upcoming") {
            filter.startDate = { $gt: now };
        } else if (status === "active") {
            filter.startDate = { $lte: now };
            filter.endDate = { $gte: now };
            filter.isActive = true;
        } else if (status === "ended") {
            filter.endDate = { $lt: now };
        }

        const campaigns = await ProductCampaign.find(filter)
            .populate("createdBy", "name email")
            .populate("productIds", "name sku price")
            .populate("categoryIds", "name")
            .sort({ priority: -1, createdAt: -1 })
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await ProductCampaign.countDocuments(filter);

        // Add current status to each campaign
        const campaignsWithStatus = campaigns.map((campaign) => {
            const campaignObj = campaign.toObject();
            campaignObj.currentStatus = campaign.isCurrentlyActive()
                ? "active"
                : new Date(campaign.startDate) > new Date()
                  ? "upcoming"
                  : "ended";
            return campaignObj;
        });

        res.status(200).json({
            success: true,
            campaigns: campaignsWithStatus,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
        });
    } catch (error) {
        console.error("Error fetching campaigns:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching campaigns",
            error: error.message,
        });
    }
};

// Get single campaign by ID
export const getCampaignById = async (req, res) => {
    try {
        const campaign = await ProductCampaign.findById(req.params.id)
            .populate("createdBy", "name email")
            .populate("productIds", "name sku price imageGroups")
            .populate("categoryIds", "name slug")
            .populate("affectedProducts.productId", "name sku price");

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
            });
        }

        const campaignObj = campaign.toObject();
        campaignObj.currentStatus = campaign.isCurrentlyActive()
            ? "active"
            : new Date(campaign.startDate) > new Date()
              ? "upcoming"
              : "ended";

        res.status(200).json({
            success: true,
            campaign: campaignObj,
        });
    } catch (error) {
        console.error("Error fetching campaign:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching campaign",
            error: error.message,
        });
    }
};

// Update campaign
export const updateCampaign = async (req, res) => {
    try {
        const campaign = await ProductCampaign.findById(req.params.id);

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
            });
        }

        const wasActive = campaign.isCurrentlyActive();
        if (wasActive) {
            console.log(`Rolling back campaign ${campaign._id} before update...`);
            await ProductCampaignService.rollbackCampaign(campaign._id);
        }

        const {
            name,
            description,
            discountType,
            discountValue,
            campaignType,
            productIds,
            categoryIds,
            startDate,
            endDate,
            minQuantity,
            maxDiscountAmount,
            priority,
            isActive,
        } = req.body;

        const updateData = {};
        if (name) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (discountType) updateData.discountType = discountType;
        if (discountValue !== undefined) updateData.discountValue = discountValue;
        if (campaignType) updateData.campaignType = campaignType;
        if (productIds) updateData.productIds = productIds;
        if (categoryIds) updateData.categoryIds = categoryIds;

        if (startDate) {
            updateData.startDate = new Date(startDate);
            console.log(`Start date set to: ${updateData.startDate}`);
        }
        if (endDate) {
            updateData.endDate = new Date(endDate);
            console.log(`End date set to: ${updateData.endDate}`);
        }

        if (minQuantity) updateData.minQuantity = minQuantity;
        if (maxDiscountAmount !== undefined) updateData.maxDiscountAmount = maxDiscountAmount;
        if (priority !== undefined) updateData.priority = priority;
        if (isActive !== undefined) updateData.isActive = isActive;

        if (startDate || endDate) {
            updateData.affectedProducts = [];
            updateData.lastAppliedAt = null;
        }

        const updatedCampaign = await ProductCampaign.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true,
        });

        const now = new Date();
        const shouldBeActive =
            updatedCampaign.isActive &&
            updatedCampaign.startDate <= now &&
            updatedCampaign.endDate >= now;

        console.log("After update:", {
            id: updatedCampaign._id,
            isActive: updatedCampaign.isActive,
            startUTC: updatedCampaign.startDate,
            endUTC: updatedCampaign.endDate,
            nowUTC: now,
            shouldBeActive: shouldBeActive,
        });

        if (shouldBeActive) {
            console.log(`Applying campaign ${updatedCampaign._id} after update...`);
            await ProductCampaignService.applyCampaign(updatedCampaign._id);
        }

        res.status(200).json({
            success: true,
            message: "Campaign updated successfully",
            campaign: updatedCampaign,
        });
    } catch (error) {
        console.error("Error updating campaign:", error);
        res.status(500).json({
            success: false,
            message: "Error updating campaign",
            error: error.message,
        });
    }
};

// Delete campaign
export const deleteCampaign = async (req, res) => {
    try {
        const campaign = await ProductCampaign.findById(req.params.id);

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
            });
        }

        // Rollback campaign if it was applied
        if (campaign.affectedProducts.length > 0) {
            await ProductCampaignService.rollbackCampaign(campaign._id);
        }

        await ProductCampaign.findByIdAndDelete(req.params.id);

        res.status(200).json({
            success: true,
            message: "Campaign deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting campaign:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting campaign",
            error: error.message,
        });
    }
};

// Manually apply campaign
export const applyCampaignManually = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await ProductCampaignService.applyCampaign(id);

        res.status(200).json({
            success: true,
            message: "Campaign applied successfully",
            result,
        });
    } catch (error) {
        console.error("Error applying campaign:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Error applying campaign",
        });
    }
};

// Manually rollback campaign
export const rollbackCampaignManually = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await ProductCampaignService.rollbackCampaign(id);

        res.status(200).json({
            success: true,
            message: "Campaign rolled back successfully",
            result,
        });
    } catch (error) {
        console.error("Error rolling back campaign:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Error rolling back campaign",
        });
    }
};

// Process all campaigns (for cron job)
export const processAllCampaigns = async (req, res) => {
    try {
        const results = await ProductCampaignService.processAllActiveCampaigns();

        res.status(200).json({
            success: true,
            message: "Campaigns processed successfully",
            results,
        });
    } catch (error) {
        console.error("Error processing campaigns:", error);
        res.status(500).json({
            success: false,
            message: "Error processing campaigns",
            error: error.message,
        });
    }
};

// Get products under a specific campaign
export const getCampaignProducts = async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const campaign = await ProductCampaign.findById(id);

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
            });
        }

        const productIds = campaign.affectedProducts.map((p) => p.productId);

        const products = await Product.find({
            _id: { $in: productIds },
        })
            .select("name sku price basePrice discountType discountValue imageGroups")
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = productIds.length;

        res.status(200).json({
            success: true,
            products,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
        });
    } catch (error) {
        console.error("Error fetching campaign products:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching campaign products",
            error: error.message,
        });
    }
};
