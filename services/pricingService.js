// services/pricingService.js
// FIX (Phase 3, critical): pricing logic used to live only inside
// checkoutController.js's `calculateCheckoutData` (the checkout *preview*
// endpoint). `orderController.js`'s `createOrder` — the endpoint that actually
// creates the order — trusted `shippingPrice`, `taxPrice`, and
// `discountAmount` directly from the request body instead of recomputing
// them. A client could call POST /api/orders directly (skipping the
// preview call) with any shipping/discount values it wanted.
//
// This service is now the single source of truth for these calculations,
// used by BOTH the checkout preview and actual order creation.
import Coupon from "../models/Coupon.js";
import { ShippingRate } from "../models/ShippingConfig.js";

export const isHomeDeliveryOnly = (locationType) =>
    locationType === "dhaka_inside" || locationType === "dhaka_sub";

export const calculateCODCharge = (rateDoc, orderAmountAfterDiscount) => {
    if (rateDoc.codChargeType === "percentage") {
        const percentageValue = rateDoc.codChargeValue / 100;
        const calculatedCharge = orderAmountAfterDiscount * percentageValue;
        return Math.round(calculatedCharge * 100) / 100;
    }
    return rateDoc.codChargeValue;
};

/**
 * Validates a coupon code server-side and returns the discount that actually
 * applies. Never trust a client-supplied discountAmount — always recompute.
 */
export const applyCouponLogic = async (couponCode, itemsSubtotal, userId) => {
    let discountAmount = 0;
    let isFreeShipping = false;

    if (!couponCode) {
        return { discountAmount, isFreeShipping, validationMessage: "No coupon code provided" };
    }

    // FIX: usedCount is `select: false` on the schema — must explicitly select it,
    // otherwise the max-usage check below silently never triggers.
    const coupon = await Coupon.findOne({ code: couponCode, isActive: true }).select("+usedCount");

    if (!coupon) {
        return { discountAmount, isFreeShipping, validationMessage: "Invalid coupon code" };
    }

    const now = new Date();
    if (now < coupon.startDate || now > coupon.expiryDate) {
        return {
            discountAmount,
            isFreeShipping,
            validationMessage: "Coupon is expired or not yet active",
        };
    }

    // FIX: maxUsage defaults to 0, meaning "unlimited" (see couponController.js's
    // own `applyCoupon`, which already guards this the same way). Without the
    // `> 0` check, every coupon with the default maxUsage would be rejected
    // immediately (0 >= 0).
    if (coupon.maxUsage > 0 && coupon.usedCount >= coupon.maxUsage) {
        return { discountAmount, isFreeShipping, validationMessage: "Coupon usage limit reached" };
    }

    if (itemsSubtotal < coupon.minOrderAmount) {
        return {
            discountAmount,
            isFreeShipping,
            validationMessage: `Minimum order amount of ${coupon.minOrderAmount} is required`,
        };
    }

    if (coupon.couponType === "percentage") {
        discountAmount = itemsSubtotal * (coupon.value / 100);
        if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
            discountAmount = coupon.maxDiscountAmount;
        }
    } else if (coupon.couponType === "fixed_amount") {
        // FIX: was checking couponType === "fixed", which never matches the
        // schema's actual enum value "fixed_amount" — fixed-amount coupons
        // applied zero discount in checkout/order creation.
        discountAmount = coupon.value;
    } else if (coupon.couponType === "free_shipping") {
        isFreeShipping = true;
        discountAmount = 0;
    }

    if (discountAmount > itemsSubtotal) {
        discountAmount = itemsSubtotal;
    }

    return {
        discountAmount: parseFloat(discountAmount.toFixed(2)),
        isFreeShipping,
        validationMessage: "Coupon applied successfully",
        couponId: coupon._id,
    };
};

/**
 * Flat, admin-configured shipping charge for a given zone/delivery-type,
 * applied once per order (see MIGRATION_NOTES.md — this used to be
 * multiplied by item quantity, which was wrong for lightweight stationery).
 */
export const calculateShippingCharge = async ({
    locationType,
    deliveryType,
    orderAmountAfterDiscount,
    isFreeShippingByCoupon = false,
}) => {
    const rateDoc = await ShippingRate.findOne({
        locationType,
        deliveryType,
        isActive: true,
    });

    if (!rateDoc) {
        return {
            rateDoc: null,
            shippingPrice: null,
            error: "Shipping rate configuration not found.",
        };
    }

    let shippingPrice = rateDoc.baseCharge;

    if (
        rateDoc.freeShippingThreshold &&
        orderAmountAfterDiscount >= rateDoc.freeShippingThreshold
    ) {
        shippingPrice = 0;
    } else if (
        rateDoc.reducedShippingThreshold &&
        rateDoc.reducedShippingAmount !== null &&
        orderAmountAfterDiscount >= rateDoc.reducedShippingThreshold
    ) {
        shippingPrice = Math.min(rateDoc.baseCharge, rateDoc.reducedShippingAmount);
    }

    if (isFreeShippingByCoupon) {
        shippingPrice = 0;
    }

    return { rateDoc, shippingPrice, error: null };
};

export const calculateTax = (taxableAmount) => {
    const taxRate = parseFloat(process.env.VAT_RATE) || 0;
    return parseFloat((taxableAmount * taxRate).toFixed(2));
};

/**
 * Full server-side order pricing — mirrors checkoutController's
 * `calculateCheckoutData` exactly (coupon → shipping → COD split → tax) so
 * that whatever a client saw in the checkout preview is what actually gets
 * charged. Used by `createOrder` so shipping/tax/discount/COD figures are
 * NEVER taken from the request body.
 *
 * @returns {Promise<{ok: true, ...} | {ok: false, status, message}>}
 */
export const computeOrderTotals = async ({
    itemsSubtotal,
    couponCode,
    userId,
    locationType,
    deliveryType,
    isCOD,
}) => {
    const taxRate = parseFloat(process.env.VAT_RATE) || 0;

    const couponResult = await applyCouponLogic(couponCode, itemsSubtotal, userId);
    if (couponCode && couponResult.validationMessage !== "Coupon applied successfully") {
        return { ok: false, status: 400, message: couponResult.validationMessage };
    }
    const discountAmount = couponResult.discountAmount;
    const isFreeShippingByCoupon = couponResult.isFreeShipping;

    const orderAmountAfterDiscount = itemsSubtotal - discountAmount;

    const { rateDoc, shippingPrice, error } = await calculateShippingCharge({
        locationType,
        deliveryType,
        orderAmountAfterDiscount,
        isFreeShippingByCoupon,
    });
    if (error) {
        return { ok: false, status: 400, message: error };
    }

    const codCharge = isCOD ? calculateCODCharge(rateDoc, orderAmountAfterDiscount) : 0;

    let codOnlinePaymentAmount = 0;
    let remainingAmount = 0;
    let finalTotal;

    if (isCOD) {
        codOnlinePaymentAmount = shippingPrice + codCharge;
        remainingAmount = orderAmountAfterDiscount;
        finalTotal = orderAmountAfterDiscount + shippingPrice + codCharge;
    } else {
        finalTotal = orderAmountAfterDiscount + shippingPrice;
    }

    let taxPrice;
    if (isCOD) {
        taxPrice = parseFloat((remainingAmount * taxRate).toFixed(2));
    } else {
        taxPrice = parseFloat(((orderAmountAfterDiscount + shippingPrice) * taxRate).toFixed(2));
    }
    finalTotal = parseFloat((finalTotal + taxPrice).toFixed(2));

    return {
        ok: true,
        discountAmount,
        shippingPrice: parseFloat(shippingPrice.toFixed(2)),
        codCharge: parseFloat(codCharge.toFixed(2)),
        codOnlinePaymentAmount: parseFloat(codOnlinePaymentAmount.toFixed(2)),
        remainingAmount: parseFloat(remainingAmount.toFixed(2)),
        taxPrice,
        totalPrice: finalTotal,
        couponId: couponResult.couponId || null,
    };
};
