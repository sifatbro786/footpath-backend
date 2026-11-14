import Cart from "../models/Cart.js";
import { CourierBranch, District, ShippingRate } from "../models/ShippingConfig.js";
import { applyCouponLogic, computeOrderTotals } from "../services/pricingService.js";
import { checkDeliveryChoice, findCourierRecord, resolveDeliveryOptions } from "../services/deliveryOptions.js";
import { priceLines } from "../services/lineItemPricing.js";

// ─── Zone Helpers ─────────────────────────────────────────────────────────────

/**
 * shippingZone (DB value) → locationType (API value)
 *   dhaka_city    → dhaka_inside
 *   dhaka_sub     → dhaka_sub
 *   dhaka_outside → outside_dhaka
 *   other_district→ outside_dhaka
 */
export const shippingZoneToLocationType = (shippingZone) => {
    switch (shippingZone) {
        case "dhaka_city":
            return "dhaka_inside";
        case "dhaka_sub":
            return "dhaka_sub";
        case "dhaka_outside":
            return "outside_dhaka";
        case "other_district":
            return "outside_dhaka";
        default:
            return "outside_dhaka";
    }
};

// @desc    Get all active districts
// @route   GET /api/checkout/districts
// @access  Public
// @desc    Public shipping rate summary
// @route   GET /api/checkout/shipping-rates
// @access  Public
//
// PHASE 5: the cart drawer and cart page show a "spend X more for free
// delivery" progress bar, which needs freeShippingThreshold BEFORE an address
// exists. calculateCheckoutData cannot answer that: it requires a validated
// district and upazila, which a shopper has not entered while still browsing.
//
// The admin rates endpoint holds this data but sits behind protect + adminOnly.
// Nothing here is sensitive: every value is quoted to the customer at checkout
// anyway. codChargeValue is deliberately excluded, since it is only meaningful
// alongside the COD rules and would invite mis-display out of context.
export const getPublicShippingRates = async (req, res) => {
    try {
        const rates = await ShippingRate.find({ isActive: true })
            .select("locationType deliveryType baseCharge baseWeightKg perKgCharge freeShippingThreshold reducedShippingThreshold reducedShippingAmount")
            .lean();

        // The lowest non-null threshold across zones is what a shopper can be
        // promised before they have chosen where it is going.
        const thresholds = rates
            .map((r) => r.freeShippingThreshold)
            .filter((t) => typeof t === "number" && t > 0);

        res.status(200).json({
            success: true,
            rates,
            lowestFreeShippingThreshold: thresholds.length ? Math.min(...thresholds) : null,
        });
    } catch (error) {
        console.error("Public shipping rates error:", error.message);
        res.status(500).json({ success: false, message: "Failed to fetch shipping rates" });
    }
};

export const getDistricts = async (req, res) => {
    try {
        const districts = await District.find({ isActive: true }).sort({ name: 1 });
        res.status(200).json({
            success: true,
            districts: districts.map((d) => d.name),
        });
    } catch (error) {
        console.error("Get districts error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch districts" });
    }
};

// @desc    Get upazilas by district
// @route   GET /api/checkout/upazilas/:district
// @access  Public
export const getUpazilas = async (req, res) => {
    try {
        const { district } = req.params;

        const districtDoc = await District.findOne({ name: district, isActive: true });
        if (!districtDoc || districtDoc.upazilas.length === 0) {
            return res.status(404).json({ success: false, message: "District not found" });
        }

        res.status(200).json({ success: true, upazilas: districtDoc.upazilas });
    } catch (error) {
        console.error("Get upazilas error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch upazilas" });
    }
};

// @desc    Get courier branches by district
// @route   GET /api/checkout/courier-branches/:district
// @access  Public
export const getCourierBranches = async (req, res) => {
    try {
        // Escaped, case-insensitive lookup (the base built a RegExp straight
        // from the URL param) and no console noise per request.
        const record = await findCourierRecord(req.params.district);
        res.status(200).json({ success: true, branches: record?.branches || [] });
    } catch (error) {
        console.error("Get courier branches error:", error.message);
        res.status(500).json({ success: false, message: "Failed to fetch courier branches", branches: [] });
    }
};

// @desc    Validate location and return locationType + available delivery types
// @route   POST /api/checkout/validate-location
// @access  Public
export const validateLocation = async (req, res) => {
    try {
        const { district, upazila } = req.body;

        if (!district || !upazila) {
            return res.status(400).json({
                success: false,
                message: "District and upazila are required",
            });
        }

        const districtDoc = await District.findOne({ name: district, isActive: true });
        if (!districtDoc) {
            return res.status(400).json({ success: false, message: "Invalid district" });
        }

        const upazilaObj = districtDoc.upazilas.find((u) => u.name === upazila);
        if (!upazilaObj) {
            return res.status(400).json({ success: false, message: "Invalid upazila" });
        }

        const locationType = shippingZoneToLocationType(upazilaObj.shippingZone);

        const { types: availableDeliveryTypes } = await resolveDeliveryOptions({ locationType, district });

        res.status(200).json({
            success: true,
            locationType,
            shippingZone: upazilaObj.shippingZone,
            availableDeliveryTypes,
        });
    } catch (error) {
        console.error("Location validation error:", error);
        res.status(500).json({ success: false, message: "Failed to validate location" });
    }
};

// @desc    Validate location type (alias)
// @route   POST /api/checkout/validate-location-type
// @access  Public
export const validateLocationType = async (req, res) => {
    try {
        const { district, upazila } = req.body;

        if (!district || !upazila) {
            return res.status(400).json({
                success: false,
                message: "District and upazila are required",
            });
        }

        const districtDoc = await District.findOne({ name: district, isActive: true });
        if (!districtDoc) {
            return res.status(400).json({ success: false, message: "Invalid district" });
        }

        const upazilaObj = districtDoc.upazilas.find((u) => u.name === upazila);
        if (!upazilaObj) {
            return res.status(400).json({ success: false, message: "Invalid upazila" });
        }

        const locationType = shippingZoneToLocationType(upazilaObj.shippingZone);

        res.status(200).json({
            success: true,
            locationType,
            shippingZone: upazilaObj.shippingZone,
            availableDeliveryTypes: (await resolveDeliveryOptions({ locationType, district })).types,
        });
    } catch (error) {
        console.error("Validate location type error:", error);
        res.status(500).json({ success: false, message: "Failed to validate location" });
    }
};

// @desc    Calculate checkout totals (shipping, discount, tax, final total)
// @route   POST /api/checkout/calculate
// @access  Public / Private
//
// Display-only mirror of createOrder. Both run lineItemPricing.priceLines +
// pricingService.computeOrderTotals, so the preview and the charge cannot
// drift. The base version priced guest lines from guestItems[].price (client
// controlled) and carried its own copy of the shipping/COD/tax maths.
export const calculateCheckoutData = async (req, res, next) => {
    try {
        const {
            isGuest,
            shippingAddress,
            couponCode,
            guestItems,
            locationType,
            deliveryType,
            paymentMethod,
            courierBranch,
        } = req.body;

        const userId = req.user?.id;

        // ─── Step 1: Raw items (prices are NOT read from here) ────────────
        let rawItems = [];
        if (isGuest) {
            if (!Array.isArray(guestItems) || guestItems.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "No items provided for calculation",
                });
            }
            rawItems = guestItems;
        } else {
            if (!req.user) {
                return res.status(401).json({ success: false, message: "Authentication required" });
            }
            const cart = await Cart.findOne({ user: req.user.id }).lean();
            if (!cart || cart.items.length === 0) {
                return res.status(400).json({ success: false, message: "Cart is empty" });
            }
            rawItems = cart.items;
        }

        // ─── Step 2: Server-side line pricing ─────────────────────────────
        const priced = await priceLines(rawItems);
        if (!priced.ok) {
            return res
                .status(priced.status)
                .json({ success: false, message: priced.message, errors: priced.errors });
        }
        const { lines, itemsSubtotal, totalWeightKg } = priced;

        // ─── Step 3: locationType / deliveryType / payment validation ─────
        const validLocationTypes = ["dhaka_inside", "dhaka_sub", "outside_dhaka"];
        if (!locationType || !validLocationTypes.includes(locationType)) {
            return res.status(400).json({
                success: false,
                message:
                    "Valid location type is required (dhaka_inside / dhaka_sub / outside_dhaka)",
            });
        }

        // Offered types come from admin data (rates + courier branches), not a
        // hard coded Dhaka rule. See services/deliveryOptions.js.
        const delivery = await checkDeliveryChoice({
            locationType,
            district: shippingAddress?.district,
            deliveryType,
            courierBranch,
        });
        if (!delivery.ok) {
            return res.status(400).json({ success: false, message: delivery.message });
        }
        const finalDeliveryType = delivery.deliveryType;

        if (!paymentMethod || !["COD", "SSLCommerz"].includes(paymentMethod)) {
            return res.status(400).json({
                success: false,
                message: "Valid payment method is required (COD/SSLCommerz)",
            });
        }
        // Online only when the bag holds a product marked codAllowed: false.
        const effectivePaymentMethod = !priced.codAvailable ? "SSLCommerz" : paymentMethod;
        const isCOD = effectivePaymentMethod === "COD";

        // ─── Step 4: Coupon (an invalid code must not break the preview) ──
        let couponMessage = "";
        let validCoupon;
        if (couponCode) {
            const couponResult = await applyCouponLogic(
                couponCode.toUpperCase(),
                itemsSubtotal,
                userId,
                lines,
            );
            couponMessage = couponResult.validationMessage;
            if (couponMessage === "Coupon applied successfully") validCoupon = couponCode.toUpperCase();
        }

        const lineSummary = lines.map((l) => ({
            product: l.product,
            name: l.name,
            variant: l.variant,
            quantity: l.quantity,
            unitPrice: l.price,
            lineTotal: l.lineTotal,
            weightKg: l.weightKg,
        }));

        // ─── Step 5: District/Upazila (Home Delivery only) ────────────────
        let upazila = null;
        if (finalDeliveryType === "Home Delivery") {
            if (!shippingAddress || !shippingAddress.district || !shippingAddress.upazila) {
                return res.status(200).json({
                    success: true,
                    data: {
                        itemsSubtotal,
                        discountAmount: 0,
                        shippingPrice: 0,
                        taxPrice: 0,
                        finalTotal: itemsSubtotal,
                        locationType,
                        deliveryType: finalDeliveryType,
                        paymentMethod: effectivePaymentMethod,
                        isCOD,
                        codAvailable: priced.codAvailable,
                        codCharge: 0,
                        codOnlinePaymentAmount: 0,
                        remainingAmount: 0,
                        totalWeightKg,
                        courierBranch: null,
                        couponMessage,
                        lines: lineSummary,
                        message: "Please provide complete shipping address for delivery",
                    },
                });
            }

            const districtDoc = await District.findOne({
                name: shippingAddress.district,
                isActive: true,
            });
            if (!districtDoc) {
                return res.status(400).json({ success: false, message: "Invalid district" });
            }
            upazila = districtDoc.upazilas.find((u) => u.name === shippingAddress.upazila);
            if (!upazila) {
                return res.status(400).json({ success: false, message: "Invalid upazila" });
            }
        }

        // ─── Step 6: Totals, same function createOrder uses ───────────────
        const pricing = await computeOrderTotals({
            itemsSubtotal,
            couponCode: validCoupon,
            userId,
            locationType,
            deliveryType: finalDeliveryType,
            isCOD,
            items: lines,
            totalWeightKg,
        });
        if (!pricing.ok) {
            return res.status(pricing.status).json({ success: false, message: pricing.message });
        }

        let estimatedDelivery = "";
        if (locationType === "dhaka_inside") {
            estimatedDelivery = "1-2 days";
        } else if (locationType === "dhaka_sub") {
            estimatedDelivery = "1-3 days";
        } else {
            estimatedDelivery = finalDeliveryType === "Courier" ? "2-4 days" : "3-5 days";
        }

        const subtotalAfterDiscount = parseFloat((itemsSubtotal - pricing.discountAmount).toFixed(2));

        res.status(200).json({
            success: true,
            data: {
                itemsSubtotal,
                discountAmount: pricing.discountAmount,
                shippingPrice: pricing.shippingPrice,
                taxPrice: pricing.taxPrice,
                codCharge: pricing.codCharge,
                codOnlinePaymentAmount: pricing.codOnlinePaymentAmount,
                remainingAmount: pricing.remainingAmount,
                finalTotal: pricing.totalPrice,
                estimatedDelivery,
                shippingZone: upazila ? upazila.shippingZone : null,
                locationType,
                deliveryType: finalDeliveryType,
                paymentMethod: effectivePaymentMethod,
                isCOD,
                // false: the bag has a product that must be paid in full online.
                codAvailable: priced.codAvailable,
                totalWeightKg,
                courierBranch: finalDeliveryType === "Courier" ? courierBranch : null,
                couponMessage,
                lines: lineSummary,
                shippingBreakdown: pricing.shippingBreakdown,
                breakdown: {
                    subtotal: itemsSubtotal,
                    discount: pricing.discountAmount,
                    subtotalAfterDiscount,
                    baseShipping: pricing.shippingPrice,
                    codCharge: pricing.codCharge,
                    codOnlinePayment: pricing.codOnlinePaymentAmount,
                    remainingForDelivery: pricing.remainingAmount,
                    tax: pricing.taxPrice,
                    total: pricing.totalPrice,
                },
            },
        });
    } catch (error) {
        console.error("Checkout calculation error:", error.message);
        next(error);
    }
};

// @desc    Get all districts that have courier service
// @route   GET /api/checkout/courier-districts
// @access  Public
export const getCourierDistricts = async (req, res) => {
    try {
        const courierDistricts = await CourierBranch.find({ isActive: true })
            .select("district branches")
            .sort({ district: 1 });

        const formattedDistricts = courierDistricts.map((item) => ({
            district: item.district,
            branches: item.branches,
        }));

        res.status(200).json({
            success: true,
            districts: formattedDistricts,
        });
    } catch (error) {
        console.error("Get courier districts error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch courier districts",
            districts: [],
        });
    }
};
