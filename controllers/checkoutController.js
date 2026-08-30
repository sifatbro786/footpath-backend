import Cart from "../models/Cart.js";
import { CourierBranch, District, ShippingRate } from "../models/ShippingConfig.js";
import {
    applyCouponLogic,
    calculateCODCharge,
    isHomeDeliveryOnly,
} from "../services/pricingService.js";

// ─── Zone Helpers ─────────────────────────────────────────────────────────────

/**
 * shippingZone (DB value) → locationType (API value)
 *   dhaka_city    → dhaka_inside
 *   dhaka_sub     → dhaka_sub
 *   dhaka_outside → outside_dhaka
 *   other_district→ outside_dhaka
 */
const shippingZoneToLocationType = (shippingZone) => {
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
            .select("locationType deliveryType baseCharge freeShippingThreshold reducedShippingThreshold reducedShippingAmount")
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
        const { district } = req.params;

        console.log("🔍 Searching for district:", district);

        const record = await CourierBranch.findOne({
            district: { $regex: new RegExp(`^${district}$`, "i") },
            isActive: true,
        });

        if (record) {
            console.log("✅ Found:", record.district, "Branches:", record.branches);
            return res.status(200).json({
                success: true,
                branches: record.branches,
            });
        }

        const allActive = await CourierBranch.find({ isActive: true }).select("district");
        console.log(
            "📋 Available districts with courier service:",
            allActive.map((r) => r.district),
        );

        res.status(200).json({
            success: true,
            branches: [],
        });
    } catch (error) {
        console.error("❌ Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch courier branches",
            branches: [],
        });
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

        const availableDeliveryTypes = isHomeDeliveryOnly(locationType)
            ? ["Home Delivery"]
            : ["Courier", "Home Delivery"];

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
            availableDeliveryTypes: isHomeDeliveryOnly(locationType)
                ? ["Home Delivery"]
                : ["Courier", "Home Delivery"],
        });
    } catch (error) {
        console.error("Validate location type error:", error);
        res.status(500).json({ success: false, message: "Failed to validate location" });
    }
};

// @desc    Calculate checkout totals (shipping, discount, tax, final total)
// @route   POST /api/checkout/calculate
// @access  Public / Private
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

        // ─── Step 1: Items ────────────────────────────────────────────────
        let itemsToProcess = [];

        if (isGuest) {
            if (!guestItems || guestItems.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "No items provided for calculation",
                });
            }
            itemsToProcess = guestItems;
        } else {
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: "Authentication required",
                });
            }
            const cart = await Cart.findOne({ user: req.user.id }).populate("items.product");
            if (!cart || cart.items.length === 0) {
                return res.status(400).json({ success: false, message: "Cart is empty" });
            }
            itemsToProcess = cart.items;
        }

        // ─── Step 2: Subtotal ──────────────────────────────────────────────
        const itemsSubtotal = itemsToProcess.reduce(
            (acc, item) =>
                acc + parseFloat(item.priceAtPurchase || item.price || 0) * (item.quantity || 1),
            0,
        );

        // ─── Step 3: Coupon ────────────────────────────────────────────────
        let discountAmount = 0;
        let isFreeShippingByCoupon = false;
        let couponMessage = "";

        if (couponCode) {
            const couponResult = await applyCouponLogic(
                couponCode.toUpperCase(),
                itemsSubtotal,
                userId,
                itemsToProcess,
            );
            discountAmount = couponResult.discountAmount;
            isFreeShippingByCoupon = couponResult.isFreeShipping;
            couponMessage = couponResult.validationMessage;
        }

        // ─── Step 4: locationType validation ──────────────────────────────
        const validLocationTypes = ["dhaka_inside", "dhaka_sub", "outside_dhaka"];
        if (!locationType || !validLocationTypes.includes(locationType)) {
            return res.status(400).json({
                success: false,
                message:
                    "Valid location type is required (dhaka_inside / dhaka_sub / outside_dhaka)",
            });
        }

        // ─── Step 5: deliveryType validation ──────────────────────────────
        let finalDeliveryType = deliveryType;

        if (isHomeDeliveryOnly(locationType)) {
            if (deliveryType && deliveryType === "Courier") {
                return res.status(400).json({
                    success: false,
                    message: `Courier service not available for ${locationType === "dhaka_inside" ? "Dhaka Inside" : "Dhaka Sub"}`,
                });
            }
            finalDeliveryType = "Home Delivery";
        } else {
            if (!deliveryType || !["Courier", "Home Delivery"].includes(deliveryType)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Valid delivery type is required for outside Dhaka (Courier/Home Delivery)",
                });
            }
            if (deliveryType === "Courier" && !courierBranch) {
                return res.status(400).json({
                    success: false,
                    message: "Courier branch selection is required",
                });
            }
            finalDeliveryType = deliveryType;
        }

        // ─── Step 6: Payment method validation ────────────────────────────
        if (!paymentMethod || !["COD", "SSLCommerz"].includes(paymentMethod)) {
            return res.status(400).json({
                success: false,
                message: "Valid payment method is required (COD/SSLCommerz)",
            });
        }

        const isCOD = paymentMethod === "COD";
        const orderAmountAfterDiscount = itemsSubtotal - discountAmount;

        // ─── Step 7: District/Upazila validation (Home Delivery only) ─────
        let upazila = null;

        if (finalDeliveryType === "Home Delivery") {
            if (!shippingAddress || !shippingAddress.district || !shippingAddress.upazila) {
                return res.status(200).json({
                    success: true,
                    data: {
                        itemsSubtotal: parseFloat(itemsSubtotal.toFixed(2)),
                        discountAmount: parseFloat(discountAmount.toFixed(2)),
                        shippingPrice: 0,
                        taxPrice: 0,
                        finalTotal: parseFloat((itemsSubtotal - discountAmount).toFixed(2)),
                        locationType,
                        deliveryType: finalDeliveryType,
                        paymentMethod,
                        isCOD,
                        codCharge: 0,
                        codOnlinePaymentAmount: 0,
                        remainingAmount: 0,
                        courierBranch: null,
                        couponMessage,
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

        // ─── Step 8: Shipping rate from DB ────────────────────────────────
        const rateDoc = await ShippingRate.findOne({
            locationType,
            deliveryType: finalDeliveryType,
            isActive: true,
        });

        if (!rateDoc) {
            return res.status(400).json({
                success: false,
                message: "Shipping rate configuration not found. Please contact support.",
            });
        }

        // ─── Step 8b: Flat shipping charge (admin-configured per zone) ────
        // FIX (Phase 3 bug): this used to be `baseCharge * totalQuantity`
        // ("per item shipping"), inherited from a previous project selling
        // heavy items (fans) where shipping genuinely scales with each unit.
        // Stationery items are light — the owner sets ONE flat charge per
        // locationType + deliveryType from the admin panel (e.g. 70/100/130/170)
        // and that charge applies once per order, regardless of quantity.
        let totalShippingPrice = rateDoc.baseCharge;

        // ─── Apply free shipping threshold on subtotal ────────────────────
        if (
            rateDoc.freeShippingThreshold &&
            orderAmountAfterDiscount >= rateDoc.freeShippingThreshold
        ) {
            totalShippingPrice = 0;
        } else if (
            rateDoc.reducedShippingThreshold &&
            rateDoc.reducedShippingAmount !== null &&
            orderAmountAfterDiscount >= rateDoc.reducedShippingThreshold
        ) {
            totalShippingPrice = Math.min(rateDoc.baseCharge, rateDoc.reducedShippingAmount);
        }

        if (isFreeShippingByCoupon) {
            totalShippingPrice = 0;
        }

        const baseShippingPrice = totalShippingPrice;

        // kept for response/debugging visibility only — no longer used in the price math
        const totalQuantity = itemsToProcess.reduce(
            (acc, item) => acc + (parseInt(item.quantity) || 1),
            0,
        );

        // ─── COD Charge calculation ────────────────────────────────────────
        console.log("=== COD Charge Debug ===");
        console.log("RateDoc codChargeType:", rateDoc.codChargeType);
        console.log("RateDoc codChargeValue:", rateDoc.codChargeValue);
        console.log("orderAmountAfterDiscount:", orderAmountAfterDiscount);
        console.log("isCOD:", isCOD);
        const codCharge = isCOD ? calculateCODCharge(rateDoc, orderAmountAfterDiscount) : 0;
        console.log("Calculated COD Charge:", codCharge);

        // ─── Shipping breakdown ────────────────────────────────────────────
        const shippingBreakdown = {
            flatCharge: baseShippingPrice,
            totalQuantity: totalQuantity, // informational only, not used in price calc
            totalShipping: totalShippingPrice,
        };

        // ─── COD Payment breakdown ─────────────────────────────────────────
        let codOnlinePaymentAmount = 0;
        let remainingAmount = 0;
        let finalTotal = 0;
        let displayTotal = 0;

        if (isCOD) {
            codOnlinePaymentAmount = baseShippingPrice + codCharge;
            remainingAmount = orderAmountAfterDiscount;
            finalTotal = orderAmountAfterDiscount + baseShippingPrice + codCharge;
            displayTotal = finalTotal;
        } else {
            codOnlinePaymentAmount = 0;
            remainingAmount = 0;
            finalTotal = orderAmountAfterDiscount + baseShippingPrice;
            displayTotal = finalTotal;
        }

        // ─── Step 9: Tax calculation ──────────────────────────────────────
        const taxRate = parseFloat(process.env.VAT_RATE) || 0;
        let taxPrice = 0;

        if (isCOD) {
            taxPrice = remainingAmount * taxRate;
            finalTotal = finalTotal + taxPrice;
            displayTotal = finalTotal;
        } else {
            taxPrice = (orderAmountAfterDiscount + baseShippingPrice) * taxRate;
            finalTotal = finalTotal + taxPrice;
            displayTotal = finalTotal;
        }

        // ─── Step 10: Estimated delivery ──────────────────────────────────
        let estimatedDelivery = "";
        if (locationType === "dhaka_inside") {
            estimatedDelivery = "1-2 days";
        } else if (locationType === "dhaka_sub") {
            estimatedDelivery = "1-3 days";
        } else {
            estimatedDelivery = finalDeliveryType === "Courier" ? "2-4 days" : "3-5 days";
        }

        // ─── Final Response ────────────────────────────────────────────────
        res.status(200).json({
            success: true,
            data: {
                itemsSubtotal: parseFloat(itemsSubtotal.toFixed(2)),
                discountAmount: parseFloat(discountAmount.toFixed(2)),
                shippingPrice: parseFloat(baseShippingPrice.toFixed(2)),
                taxPrice: parseFloat(taxPrice.toFixed(2)),
                codCharge: parseFloat(codCharge.toFixed(2)),
                codOnlinePaymentAmount: parseFloat(codOnlinePaymentAmount.toFixed(2)),
                remainingAmount: parseFloat(remainingAmount.toFixed(2)),
                finalTotal: parseFloat(displayTotal.toFixed(2)),
                estimatedDelivery,
                shippingZone: upazila ? upazila.shippingZone : null,
                locationType,
                deliveryType: finalDeliveryType,
                paymentMethod,
                isCOD,
                courierBranch: finalDeliveryType === "Courier" ? courierBranch : null,
                couponMessage,
                shippingBreakdown: {
                    flatCharge: parseFloat(shippingBreakdown.flatCharge.toFixed(2)),
                    totalQuantity: shippingBreakdown.totalQuantity,
                    totalShipping: parseFloat(shippingBreakdown.totalShipping.toFixed(2)),
                },
                breakdown: {
                    subtotal: parseFloat(itemsSubtotal.toFixed(2)),
                    discount: parseFloat(discountAmount.toFixed(2)),
                    subtotalAfterDiscount: parseFloat(orderAmountAfterDiscount.toFixed(2)),
                    baseShipping: parseFloat(baseShippingPrice.toFixed(2)),
                    codCharge: parseFloat(codCharge.toFixed(2)),
                    codOnlinePayment: parseFloat(codOnlinePaymentAmount.toFixed(2)),
                    remainingForDelivery: parseFloat(remainingAmount.toFixed(2)),
                    tax: parseFloat(taxPrice.toFixed(2)),
                    total: parseFloat(displayTotal.toFixed(2)),
                },
            },
        });
    } catch (error) {
        console.error("Checkout calculation error:", error);
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
