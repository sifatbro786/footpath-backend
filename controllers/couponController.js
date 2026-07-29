import { validationResult } from "express-validator";
import Coupon from "../models/Coupon.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";

// @desc    Create a new coupon (Admin)
// @route   POST /api/admin/coupons
// @access  Private/Admin
export const createCoupon = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const coupon = await Coupon.create(req.body);
        res.status(201).json({
            success: true,
            coupon,
        });
    } catch (error) {
        // FIX: duplicate coupon code used to bubble up as a raw MongoServerError
        // (E11000 duplicate key) with no friendly message — admin just saw a generic
        // 500. `code` is `unique: true` on the schema, so this is a routine, expected
        // failure mode that deserves a proper 409, not next(error).
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: `A coupon with code "${req.body.code}" already exists`,
            });
        }
        next(error);
    }
};

// @desc    Get all coupons (Admin) — paginated, searchable, filterable
// @route   GET /api/admin/coupons
// @access  Private/Admin
export const getAllCoupons = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, search, status, appliesTo } = req.query;

        const filter = {};
        if (search) {
            filter.$or = [
                { code: { $regex: search, $options: "i" } },
                { description: { $regex: search, $options: "i" } },
            ];
        }
        if (status === "active") filter.isActive = true;
        if (status === "inactive") filter.isActive = false;
        if (appliesTo && appliesTo !== "all") filter.appliesTo = appliesTo;

        // FIX: usedCount is `select: false` on the schema — the admin list used to
        // render every coupon's usage as blank/undefined since it was never selected.
        const [coupons, total] = await Promise.all([
            Coupon.find(filter)
                .select("+usedCount")
                .sort({ createdAt: -1 })
                .limit(limit * 1)
                .skip((page - 1) * limit),
            Coupon.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            count: coupons.length,
            total,
            pages: Math.ceil(total / limit),
            currentPage: Number(page),
            coupons,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get single coupon by ID (Admin)
// @route   GET /api/admin/coupons/:id
// @access  Private/Admin
// FIX: this endpoint didn't exist at all. couponAdminRoutes.js only ever exposed
// create/list/update/delete — there was no way to refresh-safe deep-link an edit
// page (e.g. GET /admin/coupons/:id) without re-fetching the entire list and
// filtering client-side. Added for parity with every other admin module
// (products, categories, orders all have a getOne).
export const getCouponById = async (req, res, next) => {
    try {
        const coupon = await Coupon.findById(req.params.id)
            .select("+usedCount")
            .populate("productRestrictions", "name")
            .populate("categoryRestrictions", "name");

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found",
            });
        }

        res.status(200).json({
            success: true,
            coupon,
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({
                success: false,
                message: "Coupon not found",
            });
        }
        next(error);
    }
};

// @desc    Update a coupon (Admin)
// @route   PUT /api/admin/coupons/:id
// @access  Private/Admin
export const updateCoupon = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        if (req.body.couponType === "free_shipping") {
            req.body.value = 0;
        }

        const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true,
        }).select("+usedCount");

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found",
            });
        }

        res.status(200).json({
            success: true,
            coupon,
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: `A coupon with code "${req.body.code}" already exists`,
            });
        }
        if (error.name === "CastError") {
            return res.status(404).json({
                success: false,
                message: "Coupon not found",
            });
        }
        next(error);
    }
};

// @desc    Delete a coupon (Admin)
// @route   DELETE /api/admin/coupons/:id
// @access  Private/Admin
export const deleteCoupon = async (req, res, next) => {
    try {
        const coupon = await Coupon.findByIdAndDelete(req.params.id);

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Coupon deleted successfully",
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({
                success: false,
                message: "Coupon not found",
            });
        }
        next(error);
    }
};

// @desc    Preview a coupon against cart contents (Public — cart/checkout page)
// @route   POST /api/coupons/apply
// @access  Public
// NOTE: this is a preview-only endpoint used by the cart page before checkout.
// The authoritative calculation that actually gets charged lives in
// services/pricingService.js (applyCouponLogic), used by both
// checkoutController.calculateCheckoutData and orderController.createOrder.
// Kept in sync manually — restriction/eligibility logic here now matches
// pricingService.js's getEligibleAmount exactly (both look up category from the
// DB rather than trusting a client-supplied categoryId).
export const applyCoupon = async (req, res, next) => {
    const { couponCode, cartItems, userId } = req.body;

    if (!couponCode || !cartItems || cartItems.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Coupon code and cart items are required.",
        });
    }

    try {
        const coupon = await Coupon.findOne({ code: couponCode, isActive: true }).select(
            "+usedCount",
        );

        if (!coupon || coupon.isExpired) {
            return res.status(404).json({
                success: false,
                message: "Invalid or expired coupon code.",
            });
        }

        const now = new Date();
        if (now < coupon.startDate || now > coupon.expiryDate) {
            return res.status(400).json({
                success: false,
                message: "Coupon is not active during this period.",
            });
        }

        if (coupon.maxUsage > 0 && coupon.usedCount >= coupon.maxUsage) {
            return res.status(400).json({
                success: false,
                message: "This coupon has reached its maximum usage limit.",
            });
        }

        // FIX: usagePerCustomer was never enforced anywhere — see pricingService.js
        // for the same fix applied to the real checkout/order-creation path.
        if (userId && coupon.usagePerCustomer > 0) {
            const customerUsageCount = await Order.countDocuments({
                user: userId,
                couponCode: coupon.code,
                orderStatus: { $nin: ["Cancelled", "Refunded"] },
            });
            if (customerUsageCount >= coupon.usagePerCustomer) {
                return res.status(400).json({
                    success: false,
                    message: "You have already used this coupon the maximum number of times.",
                });
            }
        }

        const subtotal = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);

        // FIX: eligibility used to trust `item.categoryId` supplied directly by the
        // client — a spoofable value never verified against the DB. Category is now
        // looked up from the real Product record.
        let eligibleAmount = subtotal;
        const eligibleProducts = [];

        if (coupon.appliesTo !== "all") {
            const productIds = cartItems.map((item) => item.productId).filter(Boolean);
            const products = await Product.find({ _id: { $in: productIds } }).select("category");
            const categoryByProduct = new Map(
                products.map((p) => [p._id.toString(), p.category?.toString()]),
            );

            eligibleAmount = 0;
            for (const item of cartItems) {
                const pid = item.productId?.toString();
                const isEligible =
                    coupon.appliesTo === "products"
                        ? coupon.productRestrictions.some((r) => r.toString() === pid)
                        : coupon.appliesTo === "categories"
                          ? coupon.categoryRestrictions.some(
                                (r) => r.toString() === categoryByProduct.get(pid),
                            )
                          : false;

                if (isEligible) {
                    eligibleAmount += item.price * item.quantity;
                    eligibleProducts.push(item);
                }
            }
        }

        if (subtotal < coupon.minOrderAmount) {
            return res.status(400).json({
                success: false,
                message: `Minimum order of ৳${coupon.minOrderAmount} is required to use this coupon.`,
            });
        }

        if (coupon.appliesTo !== "all" && eligibleAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Coupon is not applicable to any items in your cart.",
            });
        }

        let discountAmount = 0;
        let shippingDiscount = 0;

        if (coupon.couponType === "percentage") {
            discountAmount = (eligibleAmount * coupon.value) / 100;
            // FIX: maxDiscountAmount now exists on the schema (see Coupon.js) — cap
            // applied here too, so the preview matches what the order will actually
            // charge (pricingService.applyCouponLogic).
            if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
                discountAmount = coupon.maxDiscountAmount;
            }
        } else if (coupon.couponType === "fixed_amount") {
            discountAmount = Math.min(coupon.value, eligibleAmount);
        } else if (coupon.couponType === "free_shipping") {
            shippingDiscount = 1;
        }

        res.status(200).json({
            success: true,
            message: "Coupon applied successfully.",
            couponCode: coupon.code,
            discountAmount: discountAmount.toFixed(2),
            finalCartTotal: (subtotal - discountAmount).toFixed(2),
            eligibleAmount: eligibleAmount.toFixed(2),
            isFreeShipping: shippingDiscount > 0,
        });
    } catch (error) {
        next(error);
    }
};

export const incrementCouponUsage = async (couponCode) => {
    try {
        await Coupon.updateOne({ code: couponCode }, { $inc: { usedCount: 1 } });
    } catch (error) {
        console.error("Error updating coupon usage:", error.message);
    }
};
