import Coupon from "../models/Coupon.js";
import Product from "../models/Product.js";
import Category from "../models/Category.js";

export const createCoupon = async (req, res, next) => {
    try {
        const coupon = await Coupon.create(req.body);
        res.status(201).json({
            success: true,
            coupon,
        });
    } catch (error) {
        next(error);
    }
};

export const getAllCoupons = async (req, res, next) => {
    try {
        const coupons = await Coupon.find();
        res.status(200).json({
            success: true,
            count: coupons.length,
            coupons,
        });
    } catch (error) {
        next(error);
    }
};

export const updateCoupon = async (req, res, next) => {
    try {
        if (req.body.couponType === "free_shipping") {
            req.body.value = 0;
        }

        const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true,
        });

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
        next(error);
    }
};

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
        next(error);
    }
};

export const applyCoupon = async (req, res, next) => {
    const { couponCode, cartItems, userId } = req.body;

    if (!couponCode || !cartItems || cartItems.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Coupon code and cart items are required.",
        });
    }

    try {
        const coupon = await Coupon.findOne({ code: couponCode, isActive: true });

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

        const usedCount = await Coupon.findOne({ _id: coupon._id })
            .select("+usedCount")
            .then((c) => (c ? c.usedCount : 0));

        if (coupon.maxUsage > 0 && usedCount >= coupon.maxUsage) {
            return res.status(400).json({
                success: false,
                message: "This coupon has reached its maximum usage limit.",
            });
        }

        let subtotal = 0;
        let eligibleAmount = 0;
        const eligibleProducts = [];

        subtotal = cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0);

        for (const item of cartItems) {
            if (coupon.appliesTo === "all") {
                eligibleAmount += item.price * item.quantity;
                eligibleProducts.push(item);
            } else if (coupon.appliesTo === "products") {
                const isRestricted = coupon.productRestrictions.some(
                    (restrictedId) => restrictedId.toString() === item.productId.toString(),
                );
                if (isRestricted) {
                    eligibleAmount += item.price * item.quantity;
                    eligibleProducts.push(item);
                }
            } else if (coupon.appliesTo === "categories") {
                const isRestricted = coupon.categoryRestrictions.some(
                    (restrictedId) => restrictedId.toString() === item.categoryId.toString(),
                );
                if (isRestricted) {
                    eligibleAmount += item.price * item.quantity;
                    eligibleProducts.push(item);
                }
            }
        }

        if (subtotal < coupon.minOrderAmount) {
            return res.status(400).json({
                success: false,
                message: `Minimum order of ₹${coupon.minOrderAmount} is required to use this coupon.`,
            });
        }

        let discountAmount = 0;
        let shippingDiscount = 0;

        if (coupon.couponType === "percentage") {
            discountAmount = (eligibleAmount * coupon.value) / 100;
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
