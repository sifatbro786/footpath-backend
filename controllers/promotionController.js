import Promotion from "../models/Promotion.js";
import Campaign from "../models/Campaign.js";
import Cart from "../models/Cart.js";
import User from "../models/User.js";
import { sendPromotionEmail } from "../services/emailService.js";

// অ্যাবানডন্ড কার্ট ইউজারদের জন্য প্রমোশন ক্রিয়েট
export const createAbandonedCartPromotion = async (req, res, next) => {
    try {
        const {
            name,
            description,
            discountType,
            discountValue,
            minimumCartValue,
            applicableProducts,
            excludedProducts,
            durationHours = 24, // ডিফল্ট ২৪ ঘন্টা
        } = req.body;

        // প্রমোশন ক্রিয়েট
        const promotion = await Promotion.create({
            name,
            description,
            type: "abandoned_cart",
            targetUsers: "abandoned_cart_users",
            discountType,
            discountValue,
            minimumCartValue,
            applicableProducts,
            excludedProducts,
            startDate: new Date(),
            endDate: new Date(Date.now() + durationHours * 60 * 60 * 1000),
        });

        // অ্যাবানডন্ড কার্ট ইউজার খুঁজে বের করা
        const abandonedCarts = await Cart.aggregate([
            {
                $match: {
                    "items.0": { $exists: true }, // কার্টে আইটেম আছে
                    updatedAt: {
                        $lte: new Date(Date.now() - 2 * 60 * 60 * 1000), // ২ ঘন্টার বেশি পুরানো
                    },
                },
            },
            {
                $lookup: {
                    from: "users",
                    localField: "user",
                    foreignField: "_id",
                    as: "userInfo",
                },
            },
            {
                $unwind: "$userInfo",
            },
        ]);

        // প্রতিটি ইউজারের জন্য ক্যাম্পেইন ক্রিয়েট এবং নোটিফিকেশন পাঠানো
        for (const cart of abandonedCarts) {
            const campaign = await Campaign.create({
                user: cart.user,
                promotion: promotion._id,
                cartItems: cart.items,
                expiresAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
            });

            // ইমেইল নোটিফিকেশন
            await sendPromotionEmail({
                to: cart.userInfo.email,
                name: cart.userInfo.name,
                promotionName: name,
                discountValue: discountValue,
                discountType: discountType,
                expiryHours: durationHours,
                campaignId: campaign._id,
            });

            // প্রমোশনে নোটিফিকেশন সেন্ট আপডেট
            await Promotion.findByIdAndUpdate(promotion._id, {
                $addToSet: { notificationSent: cart.user },
            });
        }

        res.status(201).json({
            success: true,
            message: `Promotion created and notifications sent to ${abandonedCarts.length} users`,
            promotion,
        });
    } catch (error) {
        next(error);
    }
};

// ইউজারের একটিভ ক্যাম্পেইন গুলো ফেচ করা
export const getUserCampaigns = async (req, res, next) => {
    try {
        const campaigns = await Campaign.find({
            user: req.user.id,
            status: "active",
            expiresAt: { $gt: new Date() },
        })
            .populate("promotion")
            .populate("cartItems.product");

        res.status(200).json({
            success: true,
            campaigns,
        });
    } catch (error) {
        next(error);
    }
};

export const applyCampaignToCart = async (req, res, next) => {
    try {
        const { campaignId } = req.body;

        const campaign = await Campaign.findOne({
            _id: campaignId,
            user: req.user.id,
            status: "active",
            expiresAt: { $gt: new Date() },
        }).populate("promotion");

        if (!campaign) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found or expired",
            });
        }

        // ক্যাম্পেইন ব্যবহার করা হলে স্ট্যাটাস আপডেট করুন
        campaign.status = "used";
        campaign.usedAt = new Date();
        await campaign.save();

        res.status(200).json({
            success: true,
            message: "Campaign applied successfully",
            campaign,
        });
    } catch (error) {
        next(error);
    }
};
