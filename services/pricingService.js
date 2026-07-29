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
import Order from "../models/Order.js";
import Product from "../models/Product.js";
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
 * Computes how much of the cart a coupon with appliesTo="products"/"categories"
 * restrictions actually applies to. `items` accepts any of the three shapes that
 * exist in this codebase: populated Cart subdocs (item.product is a full Product
 * doc), guest checkout items ({productId, price, quantity}), or order items
 * ({product: ObjectId, price, quantity}). Category is looked up from the DB for
 * any item that isn't already populated — never trusted from client input.
 */
const getEligibleAmount = async (coupon, items, fallbackAmount) => {
    if (coupon.appliesTo === "all" || !Array.isArray(items) || items.length === 0) {
        return fallbackAmount;
    }

    const normalized = items
        .map((item) => {
            const productDoc =
                item.product && typeof item.product === "object" ? item.product : null;
            const productId = (productDoc?._id || item.product || item.productId)?.toString();
            const category = productDoc?.category ? productDoc.category.toString() : undefined;
            const amount =
                parseFloat(item.priceAtPurchase ?? item.price ?? 0) * (item.quantity || 1);
            return { productId, category, amount };
        })
        .filter((i) => i.productId);

    if (coupon.appliesTo === "products") {
        const allowed = new Set(coupon.productRestrictions.map((id) => id.toString()));
        return normalized.reduce((sum, i) => sum + (allowed.has(i.productId) ? i.amount : 0), 0);
    }

    if (coupon.appliesTo === "categories") {
        const allowed = new Set(coupon.categoryRestrictions.map((id) => id.toString()));
        const missingCategoryIds = normalized
            .filter((i) => i.category === undefined)
            .map((i) => i.productId);

        if (missingCategoryIds.length > 0) {
            const products = await Product.find({ _id: { $in: missingCategoryIds } }).select(
                "category",
            );
            const categoryByProduct = new Map(
                products.map((p) => [p._id.toString(), p.category?.toString()]),
            );
            normalized.forEach((i) => {
                if (i.category === undefined) i.category = categoryByProduct.get(i.productId);
            });
        }

        return normalized.reduce(
            (sum, i) => sum + (i.category && allowed.has(i.category) ? i.amount : 0),
            0,
        );
    }

    return fallbackAmount;
};

/**
 * Validates a coupon code server-side and returns the discount that actually
 * applies. Never trust a client-supplied discountAmount — always recompute.
 * `items` (optional) enables appliesTo="products"/"categories" restriction
 * checking — see getEligibleAmount above. Falls back to treating the whole
 * itemsSubtotal as eligible when omitted (only safe for appliesTo="all" coupons;
 * callers passing a restricted coupon MUST pass items).
 */
export const applyCouponLogic = async (couponCode, itemsSubtotal, userId, items = []) => {
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

    // FIX: `usagePerCustomer` is a real schema field (shown in the admin UI as
    // "Usage Per Customer") but was never enforced anywhere in the codebase — every
    // coupon was effectively unlimited-per-customer regardless of this setting.
    // Cancelled/Refunded orders don't count against the limit (the coupon was never
    // successfully used on them).
    if (userId && coupon.usagePerCustomer > 0) {
        const customerUsageCount = await Order.countDocuments({
            user: userId,
            couponCode: coupon.code,
            orderStatus: { $nin: ["Cancelled", "Refunded"] },
        });
        if (customerUsageCount >= coupon.usagePerCustomer) {
            return {
                discountAmount,
                isFreeShipping,
                validationMessage: "You have already used this coupon the maximum number of times",
            };
        }
    }

    if (itemsSubtotal < coupon.minOrderAmount) {
        return {
            discountAmount,
            isFreeShipping,
            validationMessage: `Minimum order amount of ${coupon.minOrderAmount} is required`,
        };
    }

    // FIX (critical, price-tampering-adjacent): appliesTo="products"/"categories"
    // restrictions were only validated in the standalone preview endpoint
    // (couponController.applyCoupon, POST /api/coupons/apply) and silently ignored by
    // the actual pricing path — checkoutController.js called this function with only a
    // subtotal number via a documented no-op wrapper, and orderController.js's
    // createOrder never passed restriction info at all. A coupon restricted to one
    // category discounted the customer's ENTIRE cart at both checkout-preview and
    // real order-creation time. Eligibility is now computed here from real
    // Product.category values — see getEligibleAmount above.
    const eligibleAmount = await getEligibleAmount(coupon, items, itemsSubtotal);

    if (coupon.appliesTo !== "all" && eligibleAmount <= 0) {
        return {
            discountAmount,
            isFreeShipping,
            validationMessage: "Coupon is not applicable to any items in your cart",
        };
    }

    if (coupon.couponType === "percentage") {
        discountAmount = eligibleAmount * (coupon.value / 100);
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

    // FIX: was clamped against itemsSubtotal (the whole cart) instead of
    // eligibleAmount (what the coupon can actually touch) — a coupon restricted to a
    // ৳10 item inside a ৳1,000 cart could discount up to ৳1,000 instead of ৳10.
    if (discountAmount > eligibleAmount) {
        discountAmount = eligibleAmount;
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
    items = [],
}) => {
    const taxRate = parseFloat(process.env.VAT_RATE) || 0;

    const couponResult = await applyCouponLogic(couponCode, itemsSubtotal, userId, items);
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
