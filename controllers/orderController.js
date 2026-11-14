import crypto from "crypto";
import mongoose from "mongoose";
import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import { computeOrderTotals } from "../services/pricingService.js";
import { priceLines } from "../services/lineItemPricing.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { incrementCouponUsage } from "./couponController.js";

import { initializePayment } from "../config/sslcommerz.js";
import { checkDeliveryChoice } from "../services/deliveryOptions.js";
import { recordCustomerFromOrder } from "../services/customerSync.js";
import { recordMovements } from "../services/stockLedger.js";

// NOTE (Phase 3 cleanup): a dead `calculateShippingPrice()` function used to live
// here — hardcoded to different, stale values (50/70/130) that didn't match the
// admin-configured ShippingRate collection and was never actually called anywhere.
// Removed. The single source of truth for shipping price is
// `controllers/checkoutController.js` → `calculateCheckoutData` (reads ShippingRate
// from the DB). See MIGRATION_NOTES.md for the bigger issue this points to:
// createOrder below still trusts `shippingPrice`/`taxPrice` from the request body
// instead of re-deriving them server-side.

// Statuses in which stock has actually been decremented for this order.
// Stock is only ever decremented in paymentController.js on verified payment
// (COD advance charge -> "Confirmed", full online payment -> "Processing"), never
// at order creation. Any status-change or delete logic that restores/re-decrements
// stock MUST check against this list — comparing against "Cancelled" alone (the old
// behavior) incorrectly restores stock for orders that were still "Pending" and never
// had stock removed in the first place, silently inflating inventory.
export const STOCK_HELD_STATUSES = ["Confirmed", "Processing", "Shipped", "Delivered", "Refunded"];

const ADMIN_ROLES = ["admin", "executive"];

// ─── Guest order access token helpers (Phase 0 — IDOR patch) ─────────────────

/** 24 random bytes -> 48 hex chars. ~192 bits of entropy; not brute-forceable. */
export const generateGuestAccessToken = () => crypto.randomBytes(24).toString("hex");

/**
 * Constant-time token comparison. A naive `a === b` leaks a byte-at-a-time
 * timing oracle; with a public, unauthenticated endpoint that is a real (if
 * slow) attack path, so compare via crypto.timingSafeEqual.
 * Length is checked first because timingSafeEqual throws on length mismatch —
 * that check is not itself sensitive, since token length is a public constant.
 */
const tokensMatch = (expected, provided) => {
    if (typeof expected !== "string" || typeof provided !== "string") return false;
    if (expected.length === 0 || expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
};

/**
 * Strip the capability token before an order ever leaves the API. `select: false`
 * already hides it on queries, but a freshly constructed document (createOrder)
 * still carries it in memory and would serialize it into the response body.
 */
const toClientOrder = (orderDoc) => {
    if (!orderDoc) return orderDoc;
    const plain = typeof orderDoc.toObject === "function" ? orderDoc.toObject() : { ...orderDoc };
    delete plain.guestAccessToken;
    return plain;
};

// Product Stock Update
// `meta` feeds the stock ledger (models/StockMovement.js):
//   { order?: {_id, orderNumber}, by?: userId, type?: "order"|"order_cancel"|..., note? }
// Every product change below is one atomic findOneAndUpdate that returns the
// document BEFORE the change, which is where the ledger's `before` comes from.
export const updateProductStock = async (orderItems, action = "decrease", session = null, meta = {}) => {
    const opts = session ? { session } : {};
    const ledger = [];
    const type = meta.type || (action === "decrease" ? "order" : "order_cancel");
    const base = {
        type,
        order: meta.order?._id || null,
        orderNumber: meta.order?.orderNumber,
        note: meta.note,
        by: meta.by,
    };

    for (const item of orderItems) {
        const delta = action === "decrease" ? -item.quantity : item.quantity;

        if (item.variant && (item.variant.sku || item.variant.options?.length)) {
            const product = await Product.findById(item.product)
                .select("variants hasVariants")
                .session(session || null);
            if (!product || !product.hasVariants) continue;

            let variantIndex = -1;
            if (item.variant.sku) {
                variantIndex = product.variants.findIndex((v) => v.sku === item.variant.sku);
            }
            // FIX: fall back to options-based matching (SKU is optional on variants,
            // so a missing/mismatched SKU used to mean stock was never decremented)
            if (variantIndex === -1 && item.variant.options?.length) {
                variantIndex = product.variants.findIndex(
                    (v) =>
                        v.options.length === item.variant.options.length &&
                        item.variant.options.every((opt) =>
                            v.options.some(
                                (vOpt) => vOpt.name === opt.name && vOpt.value === opt.value,
                            ),
                        ),
                );
            }

            if (variantIndex === -1) {
                console.warn(
                    `updateProductStock: could not match variant for product ${item.product} (order item "${item.name}") — stock not adjusted.`,
                );
                continue;
            }

            // Atomic update: only decrement if enough stock exists (guards against
            // concurrent orders racing each other, same pattern as the Product module fix).
            const path = `variants.${variantIndex}.stock`;
            const query = { _id: item.product };
            if (delta < 0) query[path] = { $gte: -delta };
            const result = await Product.findOneAndUpdate(query, { $inc: { [path]: delta } }, opts);
            const options = product.variants[variantIndex].options.map(({ name, value }) => ({ name, value }));
            const row = { ...base, product: item.product, productName: item.name, variantOptions: options, variantLabel: options.map((o) => o.value).join(" / ") };
            if (!result && delta < 0) {
                console.warn(
                    `updateProductStock: insufficient variant stock for product ${item.product} — clamping to 0.`,
                );
                const prev = await Product.findOneAndUpdate({ _id: item.product }, { $set: { [path]: 0 } }, opts);
                const before = prev?.variants?.[variantIndex]?.stock ?? 0;
                ledger.push({ ...row, change: -before, before, after: 0, note: `${base.note || ""} Wanted ${-delta}, only ${before} in stock (oversold).`.trim() });
            } else if (result) {
                const before = result.variants?.[variantIndex]?.stock ?? 0;
                ledger.push({ ...row, change: delta, before, after: before + delta });
            }
        } else {
            const query = { _id: item.product };
            if (delta < 0) query.stock = { $gte: -delta };
            const result = await Product.findOneAndUpdate(query, { $inc: { stock: delta } }, opts);
            const row = { ...base, product: item.product, productName: item.name };
            if (!result && delta < 0) {
                console.warn(
                    `updateProductStock: insufficient stock for product ${item.product} — clamping to 0.`,
                );
                const prev = await Product.findOneAndUpdate({ _id: item.product }, { $set: { stock: 0 } }, opts);
                const before = prev?.stock ?? 0;
                ledger.push({ ...row, change: -before, before, after: 0, note: `${base.note || ""} Wanted ${-delta}, only ${before} in stock (oversold).`.trim() });
            } else if (result) {
                const before = result.stock ?? 0;
                ledger.push({ ...row, change: delta, before, after: before + delta });
            }
        }
    }
    await recordMovements(ledger, session);
};

// @desc    Create a new order
// @route   POST /api/orders
// @access  Public/Private
export const createOrder = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const {
            shippingAddress,
            paymentMethod,
            couponCode,
            isGuest = false,
            guestEmail,
            guestItems,
            orderItems,
            locationType,
            deliveryType,
            courierBranch,
        } = req.body;

        const validationErrors = [];

        // ─── locationType validation  ───────────────────────────────
        const validLocationTypes = ["dhaka_inside", "dhaka_sub", "outside_dhaka"];
        if (!locationType || !validLocationTypes.includes(locationType)) {
            validationErrors.push(
                "Valid location type is required (dhaka_inside / dhaka_sub / outside_dhaka)",
            );
        }

        // ─── deliveryType validation ──────────────────────────────────────────────
        // Same rule as the checkout preview (services/deliveryOptions.js):
        // offered types come from active rates + the district's courier branches.
        let finalDeliveryType = deliveryType;
        if (locationType && validLocationTypes.includes(locationType)) {
            const delivery = await checkDeliveryChoice({
                locationType,
                district: shippingAddress?.district,
                deliveryType,
                courierBranch,
            });
            if (delivery.ok) finalDeliveryType = delivery.deliveryType;
            else validationErrors.push(delivery.message);
        }

        // ─── paymentMethod validation ─────────────────────────────────────────────
        if (!paymentMethod || !["COD", "SSLCommerz"].includes(paymentMethod)) {
            validationErrors.push("Valid payment method is required (COD/SSLCommerz)");
        }

        // ─── name & phone সবসময় required ─────────────────────────────────────────
        if (!shippingAddress || !shippingAddress.name || !shippingAddress.phone) {
            validationErrors.push("Name and phone are required");
        }

        // ─── Home Delivery তে address/district/upazila required ──────────────────
        if (finalDeliveryType === "Home Delivery") {
            if (!shippingAddress?.addressLine1)
                validationErrors.push("Address is required for Home Delivery");
            if (!shippingAddress?.district) validationErrors.push("District is required");
            if (!shippingAddress?.upazila) validationErrors.push("Upazila is required");
        }

        // ─── Guest validation ─────────────────────────────────────────────────────
        if (isGuest && (!guestEmail || !guestItems || guestItems.length === 0)) {
            validationErrors.push("Guest email and items are required");
        }

        if (validationErrors.length > 0) {
            await session.abortTransaction();
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: validationErrors,
            });
        }

        // ─── Order Items: priced from the live Product only ───────────────────────
        // FIX (critical, price-tampering): guest lines used to take
        // item.price / item.priceAtPurchase straight from the request (i.e. from
        // localStorage), so a guest could order anything for 1 BDT. Signed-in
        // lines used the cart's stored priceAtPurchase, which went stale when a
        // campaign changed. Every line now goes through
        // services/lineItemPricing.js (live price, stock, weight).
        let rawItems;
        let user = null;

        if (isGuest) {
            rawItems = guestItems;
        } else {
            if (!req.user) {
                await session.abortTransaction();
                return res.status(401).json({ success: false, message: "Authentication required" });
            }
            user = req.user.id;
            const cart = await Cart.findOne({ user }).session(session).lean();
            if (!cart || cart.items.length === 0) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: "Cart is empty" });
            }
            rawItems = cart.items;
        }

        const priced = await priceLines(rawItems, { session });
        if (!priced.ok) {
            await session.abortTransaction();
            return res
                .status(priced.status)
                .json({ success: false, message: priced.message, errors: priced.errors });
        }

        // Online only when the bag holds a product marked codAllowed: false.
        const effectivePaymentMethod = !priced.codAvailable ? "SSLCommerz" : paymentMethod;
        const isCOD = effectivePaymentMethod === "COD";

        const finalOrderItems = priced.lines.map((l) => ({
            name: l.name,
            product: l.product,
            variant: l.variant,
            quantity: l.quantity,
            price: l.price,
            retailPrice: l.retailPrice,
            weightKg: l.weightKg,
            image: l.image,
        }));

        // ─── Price Calculation ────────────────────────────────────────────────────
        // shipping/tax/discount/COD are recomputed server side via the
        // same function the checkout preview uses; nothing is read from the body.
        const pricing = await computeOrderTotals({
            itemsSubtotal: priced.itemsSubtotal,
            couponCode,
            userId: isGuest ? null : user,
            locationType,
            deliveryType: finalDeliveryType,
            isCOD,
            items: priced.lines,
            totalWeightKg: priced.totalWeightKg,
        });

        if (!pricing.ok) {
            await session.abortTransaction();
            return res.status(pricing.status).json({ success: false, message: pricing.message });
        }

        const finalShippingPrice = pricing.shippingPrice;
        const finalTaxPrice = pricing.taxPrice;
        const finalDiscountAmount = pricing.discountAmount;
        const totalPrice = pricing.totalPrice;

        // ─── Order Data ───────────────────────────────────────────────────────────
        const orderData = {
            user: isGuest ? null : user,
            isGuest,
            guestEmail: isGuest ? guestEmail : null,
            // Capability token so the guest can read back their own order without
            // an account. Registered orders don't need one — ownership is proven
            // by the JWT.
            guestAccessToken: isGuest ? generateGuestAccessToken() : undefined,
            orderItems: finalOrderItems,
            shippingAddress: {
                name: shippingAddress.name,
                phone: shippingAddress.phone,
                email: shippingAddress.email || "",
                addressLine1: shippingAddress.addressLine1 || "",
                addressLine2: shippingAddress.addressLine2 || "",
                district: shippingAddress.district || "",
                upazila: shippingAddress.upazila || "",
                zipCode: shippingAddress.zipCode || "",
                country: shippingAddress.country || "Bangladesh",
                locationType,
                deliveryType: finalDeliveryType,
                courierBranch: finalDeliveryType === "Courier" ? courierBranch : undefined,
            },
            paymentMethod: effectivePaymentMethod,
            totalWeightKg: priced.totalWeightKg,
            shippingPrice: finalShippingPrice,
            taxPrice: finalTaxPrice,
            couponCode: couponCode || undefined,
            discountAmount: finalDiscountAmount,
            totalPrice,
            orderStatus: "Pending",
            paymentStatus: "Pending",
            shippingBreakdown: {
                ...(pricing.shippingBreakdown || {}),
                totalQuantity: finalOrderItems.reduce((acc, i) => acc + i.quantity, 0),
                totalShipping: finalShippingPrice,
            },
            codCharge: pricing.codCharge,
            codOnlinePaymentAmount: pricing.codOnlinePaymentAmount,
            remainingAmount: pricing.remainingAmount,
        };

        const newOrder = new Order(orderData);
        await newOrder.save({ session, validateBeforeSave: false });

        // ─── SSLCommerz Payment ───────────────────────────────────────────────────
        if (effectivePaymentMethod === "SSLCommerz") {
            const amountNow = totalPrice;
            const paymentData = {
                amount: amountNow,
                cus_name: shippingAddress.name,
                cus_email: shippingAddress.email || newOrder.guestEmail || "customer@example.com",
                cus_phone: shippingAddress.phone,
                shippingAddress: {
                    ...shippingAddress,
                    locationType,
                    deliveryType: finalDeliveryType,
                    courierBranch,
                },
                isCOD: false,
            };

            console.log(
                `SSLCommerz Payment Initializing: ${amountNow} BDT for order ${newOrder.orderNumber || newOrder._id}`,
            );
            const paymentInit = await initializePayment(newOrder._id.toString(), paymentData);

            if (paymentInit.status === "SUCCESS" && paymentInit.GatewayPageURL) {
                if (!isGuest && req.user) {
                    await Cart.findOneAndDelete({ user: req.user.id }).session(session);
                }
                await session.commitTransaction();
                recordCustomerFromOrder(newOrder); // lead book, best effort
                // FIX: usedCount was never incremented anywhere in the codebase,
                // so maxUsage limits were effectively unenforced. Done outside the
                // transaction (best-effort, non-blocking) after commit succeeds.
                if (couponCode) incrementCouponUsage(couponCode);
                return res.status(201).json({
                    success: true,
                    message: "Payment initialized. Redirecting to gateway.",
                    order: toClientOrder(newOrder),
                    // Surfaced once, at creation only. The client must persist this
                    // to read the order back later; it is never returned again.
                    guestAccessToken: isGuest ? newOrder.guestAccessToken : undefined,
                    redirectUrl: paymentInit.GatewayPageURL,
                });
            } else {
                console.error("SSLCommerz initialization failed:", paymentInit);
                newOrder.orderStatus = "Cancelled";
                newOrder.paymentStatus = "Failed";
                newOrder.adminNotes = newOrder.adminNotes || [];
                newOrder.adminNotes.push({
                    note: `SSLCommerz initialization failed: ${paymentInit.failedreason || "Unknown error"}`,
                    // System entry: addedBy (ObjectId ref) omitted for a non-user actor.
                    addedAt: new Date(),
                });
                await newOrder.save({ session, validateBeforeSave: false });
                await session.commitTransaction();
                return res.status(500).json({
                    success: false,
                    message: paymentInit.failedreason || "Failed to initiate online payment",
                });
            }

            // ─── COD Payment ──────────────────────────────────────────────────────────
        } else if (effectivePaymentMethod === "COD") {
            // FIX (critical, price-tampering): these three values used to be
            // re-derived from req.body.codOnlinePaymentAmount / req.body.codCharge /
            // req.body.remainingAmount. They're already correct on `newOrder`
            // (set server-side via `pricing` above) — just read them back.
            const codChargeAmount = newOrder.codOnlinePaymentAmount;
            const remainingAmount = newOrder.remainingAmount;

            console.log(`COD Payment Details for Order ${newOrder._id}:`);
            console.log(`  - COD Online Payment Amount: ${codChargeAmount} BDT`);
            console.log(`  - Remaining (Pay on Delivery): ${remainingAmount} BDT`);
            console.log(`  - Total Order Value: ${totalPrice} BDT`);

            const paymentData = {
                amount: codChargeAmount,
                cus_name: shippingAddress.name,
                cus_email: shippingAddress.email || newOrder.guestEmail || "customer@example.com",
                cus_phone: shippingAddress.phone,
                shippingAddress: {
                    ...shippingAddress,
                    locationType,
                    deliveryType: finalDeliveryType,
                    courierBranch,
                },
                isCOD: true,
            };

            console.log(
                `COD Payment Initializing: Charging ${codChargeAmount} BDT for order ${newOrder._id}`,
            );
            const paymentInit = await initializePayment(newOrder._id.toString(), paymentData);

            if (paymentInit.status === "SUCCESS" && paymentInit.GatewayPageURL) {
                if (!isGuest && req.user) {
                    await Cart.findOneAndDelete({ user: req.user.id }).session(session);
                }
                newOrder.adminNotes = newOrder.adminNotes || [];
                newOrder.adminNotes.push({
                    note: `COD payment: Customer needs to pay ${codChargeAmount} BDT online. Remaining ${remainingAmount} BDT will be collected upon delivery.`,
                    // System entry: addedBy (ObjectId ref) omitted for a non-user actor.
                    addedAt: new Date(),
                });

                await newOrder.save({ session, validateBeforeSave: false });
                await session.commitTransaction();
                recordCustomerFromOrder(newOrder); // lead book, best effort
                if (couponCode) incrementCouponUsage(couponCode);
                return res.status(201).json({
                    success: true,
                    message: `COD order - Please pay ${codChargeAmount} BDT online`,
                    order: toClientOrder(newOrder),
                    guestAccessToken: isGuest ? newOrder.guestAccessToken : undefined,
                    redirectUrl: paymentInit.GatewayPageURL,
                    codOnlinePaymentAmount: codChargeAmount,
                    remainingAmount: remainingAmount,
                    note: `Pay ${codChargeAmount} BDT online. Remaining ${remainingAmount} BDT will be collected upon delivery.`,
                });
            } else {
                console.error("SSLCommerz initialization failed for COD:", paymentInit);
                newOrder.orderStatus = "Cancelled";
                newOrder.paymentStatus = "Failed";
                newOrder.adminNotes = newOrder.adminNotes || [];
                newOrder.adminNotes.push({
                    note: `COD payment initialization failed: ${paymentInit.failedreason || "Unknown error"}`,
                    // System entry: addedBy (ObjectId ref) omitted for a non-user actor.
                    addedAt: new Date(),
                });
                await newOrder.save({ session, validateBeforeSave: false });
                await session.commitTransaction();
                return res.status(500).json({
                    success: false,
                    message: paymentInit.failedreason || "Failed to initiate COD payment",
                });
            }
        }
    } catch (error) {
        await session.abortTransaction();
        console.error("Order creation error:", error);

        if (error.name === "ValidationError") {
            const errors = Object.values(error.errors).map((err) => err.message);
            return res
                .status(400)
                .json({ success: false, message: "Database validation failed", errors });
        }

        return res.status(500).json({
            success: false,
            message: "Server error: " + error.message,
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
        });
    } finally {
        session.endSession();
    }
};

// @desc    Look up an order by number + phone, for guests
// @route   POST /api/orders/track
// @access  Public (rate limited)
//
// PHASE 6: a guest's only route back to their order was the capability token
// in the confirmation URL. Lose that link and the order is unreachable, which
// is the single most common support request a shop gets.
//
// Why phone rather than the token: the token is a bearer secret, unguessable
// by design, and asking someone to paste a 48 character hex string is not a
// recovery path. orderNumber + the phone on the order is a two factor check
// that a real customer can satisfy from memory.
//
// Why POST: the phone number is PII and must not land in access logs, browser
// history or a Referer header, all of which happen with a GET query string.
//
// The response is deliberately a SUBSET: status, timeline, items and totals.
// No email, no full address, no admin notes, no capability token. Enough to
// answer "where is my order", not enough to be worth harvesting.
export const trackOrder = async (req, res, next) => {
    try {
        const orderNumber = String(req.body.orderNumber || "").trim().toUpperCase();
        const phone = String(req.body.phone || "").replace(/[\s-]/g, "");

        if (!orderNumber || !phone) {
            return res.status(400).json({
                success: false,
                message: "Order number and phone number are required.",
            });
        }

        const order = await Order.findOne({ orderNumber })
            .select("-guestAccessToken -adminNotes -__v")
            .populate("statusHistory.updatedBy", "name");

        // Identical response for "no such order" and "phone does not match", so
        // this cannot be used to confirm which order numbers exist.
        const storedPhone = String(order?.shippingAddress?.phone || "").replace(/[\s-]/g, "");
        if (!order || !storedPhone || storedPhone !== phone) {
            return res.status(404).json({
                success: false,
                message: "We could not find an order with those details.",
            });
        }

        res.status(200).json({
            success: true,
            order: {
                orderNumber: order.orderNumber,
                orderStatus: order.orderStatus,
                paymentStatus: order.paymentStatus,
                paymentMethod: order.paymentMethod,
                createdAt: order.createdAt,
                paidAt: order.paidAt,
                deliveredAt: order.deliveredAt,
                trackingNumber: order.trackingNumber,
                carrier: order.carrier,
                statusHistory: order.statusHistory,
                orderItems: order.orderItems,
                totalPrice: order.totalPrice,
                codOnlinePaymentAmount: order.codOnlinePaymentAmount,
                totalWeightKg: order.totalWeightKg,
                shippingPrice: order.shippingPrice,
                discountAmount: order.discountAmount,
                taxPrice: order.taxPrice,
                codCharge: order.codCharge,
                remainingAmount: order.remainingAmount,
                // Coarse destination only: enough to recognise the order,
                // not enough to reconstruct a home address.
                shippingAddress: {
                    name: order.shippingAddress?.name,
                    district: order.shippingAddress?.district,
                    upazila: order.shippingAddress?.upazila,
                    courierBranch: order.shippingAddress?.courierBranch,
                    deliveryType: order.shippingAddress?.deliveryType,
                },
            },
        });
    } catch (error) {
        console.error("Order tracking error:", error.message);
        next(error);
    }
};

// @desc    Get my orders
// @route   GET /api/orders
// @access  Private
export const getMyOrders = async (req, res, next) => {
    try {
        const orders = await Order.find({ user: req.user.id })
            .sort({ createdAt: -1 })
            .select("-adminNotes");
        res.status(200).json({
            success: true,
            count: orders.length,
            orders,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private/Public
export const getOrderById = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Accept the capability token from either the query string (the payment
        // gateway round-trip can only carry it back as a URL param) or a header
        // (preferred for XHR — keeps the token out of referrers and access logs).
        const providedToken = String(req.query.token || req.headers["x-order-token"] || "");

        // Lookup by orderNumber first, then by _id. findById is guarded by an
        // ObjectId check so a non-ObjectId lookup key can't throw a CastError.
        let order = await Order.findOne({ orderNumber: id })
            .select("+guestAccessToken")
            .populate("user", "name email")
            .populate("statusHistory.updatedBy", "name");

        if (!order && mongoose.isValidObjectId(id)) {
            order = await Order.findById(id)
                .select("+guestAccessToken")
                .populate("user", "name email")
                .populate("statusHistory.updatedBy", "name");
        }

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        // ─── Authorization ────────────────────────────────────────────────────
        // SECURITY (Phase 0 — IDOR patch): a guest order used to be returned to
        // anyone who could name it, exposing name, phone, email and full address.
        // Access now requires proving one of three things.
        const isAdmin = Boolean(req.user && ADMIN_ROLES.includes(req.user.role));
        const isOwner = Boolean(
            req.user && order.user && String(order.user._id) === String(req.user.id),
        );
        const hasValidToken = tokensMatch(order.guestAccessToken, providedToken);

        if (!isAdmin && !isOwner && !hasValidToken) {
            // Deliberately identical shape for "wrong token" and "not your order"
            // so this endpoint can't be used to probe which order ids exist.
            // Legacy guest orders created before this patch have no token stored
            // and are therefore no longer publicly readable — that is the intended
            // fail-closed behaviour; recover them through the admin endpoints.
            return res.status(req.user ? 403 : 401).json({
                success: false,
                message: "Not authorized to view this order",
            });
        }

        res.status(200).json({ success: true, order: toClientOrder(order) });
    } catch (error) {
        console.error("Order fetch error:", error.message);
        if (error.name === "CastError") {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }
        next(error);
    }
};

// @desc    Get all orders (Admin)
// @route   GET /api/admin/orders
// @access  Private/Admin
export const getAllOrders = async (req, res, next) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            paymentMethod,
            paymentStatus,
            search,
            sortBy = "createdAt",
            sortOrder = "desc",
        } = req.query;

        const filter = {};

        if (status && status !== "all") filter.orderStatus = status;
        if (paymentMethod && paymentMethod !== "all") filter.paymentMethod = paymentMethod;
        if (paymentStatus && paymentStatus !== "all") filter.paymentStatus = paymentStatus;
        // Phone orders vs website orders (?source=phone|web).
        if (req.query.source === "phone" || req.query.source === "web") filter.orderSource = req.query.source;

        // Search functionality
        if (search) {
            filter.$or = [
                { orderNumber: { $regex: escapeRegex(search), $options: "i" } },
                { "shippingAddress.name": { $regex: escapeRegex(search), $options: "i" } },
                { "shippingAddress.phone": { $regex: escapeRegex(search), $options: "i" } },
                { "shippingAddress.email": { $regex: escapeRegex(search), $options: "i" } },
            ];
        }

        // Sort. Whitelisted: the key comes from the query string.
        const SORTABLE = ["createdAt", "totalPrice"];
        const sort = { [SORTABLE.includes(sortBy) ? sortBy : "createdAt"]: sortOrder === "desc" ? -1 : 1 };
        if (!sort.createdAt) sort.createdAt = -1;

        // Execute query
        const orders = await Order.find(filter)
            .populate("user", "name email")
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Order.countDocuments(filter);

        res.status(200).json({
            success: true,
            count: orders.length,
            total,
            pages: Math.ceil(total / limit),
            currentPage: page,
            orders,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get order statistics (Admin)
// @route   GET /api/admin/orders/stats
// @access  Private/Admin
export const getOrderStats = async (req, res, next) => {
    try {
        const scope = {};
        const totalOrders = await Order.countDocuments(scope);
        const pendingOrders = await Order.countDocuments({ ...scope, orderStatus: "Pending" });
        const deliveredOrders = await Order.countDocuments({ ...scope, orderStatus: "Delivered" });
        const totalRevenue = await Order.aggregate([
            { $match: { ...scope, orderStatus: "Delivered" } },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } },
        ]);
        // Last 7 days orders
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentOrders = await Order.countDocuments({
            ...scope,
            createdAt: { $gte: sevenDaysAgo },
        });

        // Monthly revenue
        const currentMonth = new Date().getMonth();
        const monthlyRevenue = await Order.aggregate([
            {
                $match: {
                    ...scope,
                    orderStatus: "Delivered",
                    createdAt: { $gte: new Date(new Date().getFullYear(), currentMonth, 1) },
                },
            },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } },
        ]);

        res.status(200).json({
            success: true,
            stats: {
                totalOrders,
                pendingOrders,
                deliveredOrders,
                totalRevenue: totalRevenue[0]?.total || 0,
                monthlyRevenue: monthlyRevenue[0]?.total || 0,
                recentOrders,
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update order status (Admin)
// @route   PUT /api/admin/orders/:id/status
// @access  Private/Admin

export const updateOrderStatus = async (req, res, next) => {
    try {
        const { status, note, trackingNumber, carrier } = req.body;
        console.log("Order Status Update Request:", {
            orderId: req.params.id,
            status,
            note,
            trackingNumber,
            carrier,
            user: req.user.id,
        });

        // Validate required fields
        if (!status) {
            return res.status(400).json({
                success: false,
                message: "Status is required",
            });
        }

        // Validate status value
        const validStatuses = [
            "Pending",
            "Confirmed",
            "Processing",
            "Shipped",
            "Delivered",
            "Cancelled",
            "Refunded",
        ];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order status",
            });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        console.log("Current Order:", {
            id: order._id,
            currentStatus: order.orderStatus,
            newStatus: status,
        });
        const updateData = {
            orderStatus: status,
        };
        if (trackingNumber !== undefined) {
            updateData.trackingNumber = trackingNumber;
        }
        if (carrier !== undefined) {
            updateData.carrier = carrier;
        }
        if (status === "Delivered" && order.orderStatus !== "Delivered") {
            updateData.deliveredAt = new Date();
            updateData.paymentStatus = "Paid";
            console.log("Order marked as delivered, setting paidAt");
        }
        const updatedOrder = await Order.findByIdAndUpdate(
            req.params.id,
            {
                $set: updateData,
                $push: {
                    statusHistory: {
                        status: status,
                        note: note || `Order status updated to ${status}`,
                        updatedBy: req.user.id,
                        updatedAt: new Date(),
                    },
                },
            },
            {
                new: true,
                runValidators: false,
            },
        )
            .populate("statusHistory.updatedBy", "name")
            .populate("user", "name email");
        console.log("Order updated successfully");

        // FIX: reconcile stock based on actual state transition, not just "-> Cancelled".
        // `order.orderStatus` here is still the PRE-update value (order was fetched before
        // the $set above). Only restore stock if the order is LEAVING a status where stock
        // was actually held; only decrement if it's ENTERING one (e.g. an admin reverting a
        // mistaken Cancel back to Confirmed) — using the same oversell-guarded atomic path
        // as the payment flow.
        const wasStockHeld = STOCK_HELD_STATUSES.includes(order.orderStatus);
        const willHoldStock = STOCK_HELD_STATUSES.includes(status);
        if (wasStockHeld && !willHoldStock) {
            console.log("Restoring product stock — order left a stock-held status");
            await updateProductStock(order.orderItems, "increase", null, { order, by: req.user._id, note: `Status ${order.orderStatus} -> ${status}` });
        } else if (!wasStockHeld && willHoldStock) {
            console.log("Decrementing product stock — order entered a stock-held status");
            await updateProductStock(order.orderItems, "decrease", null, { order, by: req.user._id, note: `Status ${order.orderStatus} -> ${status}` });
        }
        console.log("Order status update completed");
        res.status(200).json({
            success: true,
            message: "Order status updated successfully",
            order: updatedOrder,
        });
    } catch (error) {
        console.error("Order status update error:", error);
        if (error.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID",
            });
        }
        res.status(500).json({
            success: false,
            message: "Server error: " + error.message,
        });
    }
};

// @desc    Update payment status (Admin)
// @route   PUT /api/admin/orders/:id/payment
// @access  Private/Admin
export const updatePaymentStatus = async (req, res, next) => {
    try {
        const { paymentStatus } = req.body;

        console.log("Payment Status Update Request:", {
            orderId: req.params.id,
            paymentStatus,
            user: req.user.id,
        });

        // Validate required fields
        if (!paymentStatus) {
            return res.status(400).json({
                success: false,
                message: "Payment status is required",
            });
        }

        // Validate payment status
        const validStatuses = ["Pending", "Partial", "Paid", "Failed", "Refunded"];
        if (!validStatuses.includes(paymentStatus)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment status",
            });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        // Update payment status
        order.paymentStatus = paymentStatus;

        // Set paidAt if payment status is Paid
        if (paymentStatus === "Paid" && !order.paidAt) {
            order.paidAt = new Date();
            console.log("Payment marked as paid, setting paidAt");
        }

        // Add to status history
        order.statusHistory.push({
            status: order.orderStatus,
            note: `Payment status updated to ${paymentStatus}`,
            updatedBy: req.user.id,
            updatedAt: new Date(),
        });

        await order.save();

        // Populate for response
        await order.populate("statusHistory.updatedBy", "name");

        res.status(200).json({
            success: true,
            message: "Payment status updated successfully",
            order,
        });
    } catch (error) {
        console.error(" Payment status update error:", error);
        next(error);
    }
};

// @desc    Add admin note to order
// @route   POST /api/admin/orders/:id/notes
// @access  Private/Admin
export const addAdminNote = async (req, res, next) => {
    try {
        const { note } = req.body;

        if (!note || note.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Note is required",
            });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        order.adminNotes.push({
            note: note.trim(),
            addedBy: req.user.id,
        });

        await order.save();

        // Populate for response
        await order.populate("adminNotes.addedBy", "name");

        res.status(200).json({
            success: true,
            message: "Note added successfully",
            order,
        });
    } catch (error) {
        console.error("Add admin note error:", error);
        next(error);
    }
};

// @desc    Delete order (Admin)
// @route   DELETE /api/admin/orders/:id
// @access  Private/Admin
export const deleteOrder = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        // FIX: same reconciliation bug as updateOrderStatus — a Pending order that's
        // deleted never had stock decremented, so restoring it here used to inflate
        // inventory. Only restore when the order was actually holding stock.
        if (STOCK_HELD_STATUSES.includes(order.orderStatus)) {
            await updateProductStock(order.orderItems, "increase", null, { order, by: req.user._id, note: "Order deleted" });
        }
        await Order.findByIdAndDelete(req.params.id);
        res.status(200).json({
            success: true,
            message: "Order deleted successfully",
        });
    } catch (error) {
        next(error);
    }
};

export const getOrderByIdAdmin = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate("user", "name email")
            .populate("statusHistory.updatedBy", "name")
            .populate("adminNotes.addedBy", "name");

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        res.status(200).json({
            success: true,
            order,
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }
        next(error);
    }
};

// @desc    Update order details (items/shipping/pricing/coupon) — Admin
// @route   PUT /api/admin/orders/:id
// @access  Private/Admin
export const updateOrderDetails = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const {
            shippingAddress,
            orderItems,
            shippingPrice,
            taxPrice,
            couponCode,
            discountAmount,
            note,
        } = req.body;

        let order;
        if (mongoose.Types.ObjectId.isValid(req.params.id)) {
            order = await Order.findById(req.params.id).session(session);
        } else {
            order = await Order.findOne({ orderNumber: req.params.id }).session(session);
        }

        if (!order) {
            await session.abortTransaction();
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        if (shippingAddress) {
            order.shippingAddress = {
                ...order.shippingAddress,
                ...shippingAddress,
            };
        }

        if (orderItems && Array.isArray(orderItems)) {
            const newOrderItems = orderItems.map((item) => ({
                name: item.name,
                product: item.productId || item.product,
                variant: item.variant || {},
                quantity: parseInt(item.quantity) || 1,
                price: parseFloat(item.price) || 0,
                image: item.image || "",
                _id: item._id || new mongoose.Types.ObjectId(),
            }));

            // FIX: this endpoint used to swap order.orderItems in place without ever
            // touching product stock, so any admin item edit (change qty, add/remove a
            // line) silently desynced inventory from what was actually reserved at
            // payment time. Stock is only ever held for orders in STOCK_HELD_STATUSES —
            // for those, restore the OLD items' stock then atomically (oversell-guarded)
            // decrement the NEW items' stock, inside the same transaction as the save.
            // Pending orders never had stock decremented, so item edits on them correctly
            // leave stock untouched.
            if (STOCK_HELD_STATUSES.includes(order.orderStatus)) {
                await updateProductStock(order.orderItems, "increase", session, { order, by: req.user._id, note: "Items edited (old lines)" });
                await updateProductStock(newOrderItems, "decrease", session, { order, by: req.user._id, note: "Items edited (new lines)" });
            }

            order.orderItems = newOrderItems;
        }

        if (shippingPrice !== undefined) {
            order.shippingPrice = parseFloat(shippingPrice) || 0;
        }
        if (taxPrice !== undefined) {
            order.taxPrice = parseFloat(taxPrice) || 0;
        }
        if (discountAmount !== undefined) {
            order.discountAmount = parseFloat(discountAmount) || 0;
        }
        if (couponCode !== undefined) {
            order.couponCode = couponCode || undefined;
        }

        // Recalculate total price (matches the itemsTotal + shipping + tax - discount
        // convention used by pricingService.computeOrderTotals at order-creation time)
        const itemsTotal = order.orderItems.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0,
        );
        order.totalPrice =
            itemsTotal + order.shippingPrice + order.taxPrice - (order.discountAmount || 0);

        order.statusHistory.push({
            status: order.orderStatus,
            note: note || "Order details updated by admin",
            updatedBy: req.user.id,
            updatedAt: new Date(),
        });

        await order.save({ session, runValidators: true });
        await session.commitTransaction();

        const updatedOrder = await Order.findById(order._id)
            .populate("user", "name email")
            .populate("statusHistory.updatedBy", "name");

        res.status(200).json({
            success: true,
            message: "Order updated successfully",
            order: updatedOrder,
        });
    } catch (error) {
        await session.abortTransaction();
        console.error("Order update error:", error);

        if (error.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID",
            });
        }
        if (error.name === "ValidationError") {
            const errors = Object.values(error.errors).map((err) => err.message);
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors,
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error: " + error.message,
        });
    } finally {
        session.endSession();
    }
};
