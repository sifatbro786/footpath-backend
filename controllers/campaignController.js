import Campaign from "../models/Campaign.js";

// GET /api/campaign - সব campaigns
export const getCampaigns = async (req, res) => {
    try {
        console.log("📨 Fetching campaigns request received");

        const campaigns = await Campaign.find()
            .populate("targetCategory", "name")
            .populate("targetProducts", "name")
            .sort({ createdAt: -1 });

        console.log(`✅ Found ${campaigns.length} campaigns`);

        res.json({
            success: true,
            data: campaigns,
            count: campaigns.length,
        });
    } catch (error) {
        console.error("❌ Error fetching campaigns:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch campaigns",
            error: error.message,
        });
    }
};

// POST /api/campaign - নতুন campaign create
export const createCampaign = async (req, res) => {
    try {
        console.log("📨 Create campaign request:", req.body);

        const campaign = new Campaign(req.body);
        await campaign.save();

        await campaign.populate("targetCategory", "name");
        await campaign.populate("targetProducts", "name");

        console.log("✅ Campaign created successfully:", campaign._id);

        res.status(201).json({
            success: true,
            data: campaign,
            message: "Campaign created successfully",
        });
    } catch (error) {
        console.error("❌ Error creating campaign:", error);
        res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

// PUT /api/campaign/:id - campaign update
export const updateCampaign = async (req, res) => {
    try {
        console.log("📨 Update campaign request for ID:", req.params.id);

        // 1. প্রথমে Document টি খুঁজে বের করুন
        let campaign = await Campaign.findById(req.params.id); // <-- findById ব্যবহার করা হয়েছে

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
            });
        }

        // 2. req.body থেকে পাওয়া ডেটা দিয়ে Document এর প্রপার্টিগুলো আপডেট করুন
        // এটি isModified() ফ্ল্যাগ সেট করবে
        Object.assign(campaign, req.body);

        // 3. save() মেথড কল করুন
        // এটি campaign.model.js-এ থাকা pre('save') হুকটিকে ট্রিগার করবে
        await campaign.save(); // <-- এটিই মূল ফিক্স

        // Populate fields for response
        await campaign.populate("targetCategory", "name");
        await campaign.populate("targetProducts", "name");

        console.log("✅ Campaign updated successfully:", campaign._id);

        res.json({
            success: true,
            message: "Campaign updated successfully",
            data: campaign,
        });
    } catch (error) {
        console.error("❌ Error updating campaign:", error);
        // Validation ত্রুটির জন্য সঠিক স্ট্যাটাস কোড সেট করুন
        const statusCode = error.name === "ValidationError" ? 400 : 500;
        res.status(statusCode).json({
            success: false,
            message: error.message,
        });
    }
};

// DELETE /api/campaign/:id - campaign delete
export const deleteCampaign = async (req, res) => {
    try {
        console.log("📨 Delete campaign request for ID:", req.params.id);

        const campaign = await Campaign.findByIdAndDelete(req.params.id);

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
            });
        }

        console.log("✅ Campaign deleted successfully:", req.params.id);

        res.json({
            success: true,
            message: "Campaign deleted successfully",
        });
    } catch (error) {
        console.error("❌ Error deleting campaign:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete campaign",
        });
    }
};

// GET /api/campaign/:id - single campaign
export const getCampaignById = async (req, res) => {
    try {
        const campaign = await Campaign.findById(req.params.id)
            .populate("targetCategory", "name")
            .populate("targetProducts", "name");

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found",
            });
        }

        res.json({
            success: true,
            data: campaign,
        });
    } catch (error) {
        console.error("Error fetching campaign:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch campaign",
        });
    }
};
