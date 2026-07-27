import mongoose from "mongoose";
import Order from "../models/Order.js";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { computeOrderTotals } from "../services/pricingService.js";
import { incrementCouponUsage } from "./couponController.js";
import { escapeRegex } from "../utils/escapeRegex.js";

import { initializePayment } from "../config/sslcommerz.js";

// NOTE (Phase 3 cleanup): a dead `calculateShippingPrice()` function used to live
// here — hardcoded to different, stale values (50/70/130) that didn't match the
// admin-configured ShippingRate collection and was never actually called anywhere.
// Removed. The single source of truth for shipping price is
// `controllers/checkoutController.js` → `calculateCheckoutData` (reads ShippingRate
// from the DB). See MIGRATION_NOTES.md for the bigger issue this points to:
// createOrder below still trusts `shippingPrice`/`taxPrice` from the request body
// instead of re-deriving them server-side.

// Product Stock Update
export const updateProductStock = async (orderItems, action = "decrease", session = null) => {
    const opts = session ? { session } : {};
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
                            v.options.some((vOpt) => vOpt.name === opt.name && vOpt.value === opt.value),
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
            if (!result && delta < 0) {
                console.warn(
                    `updateProductStock: insufficient variant stock for product ${item.product} — clamping to 0.`,
                );
                await Product.updateOne({ _id: item.product }, { $set: { [path]: 0 } }, opts);
            }
        } else {
            const query = { _id: item.product };
            if (delta < 0) query.stock = { $gte: -delta };
            const result = await Product.findOneAndUpdate(query, { $inc: { stock: delta } }, opts);
            if (!result && delta < 0) {
                console.warn(
                    `updateProductStock: insufficient stock for product ${item.product} — clamping to 0.`,
                );
                await Product.updateOne({ _id: item.product }, { $set: { stock: 0 } }, opts);
            }
        }
    }
};

// @desc    Create a new order
// @route   POST /api/v1/orders
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
        let finalDeliveryType = deliveryType;
        const isHomeOnly = locationType === "dhaka_inside" || locationType === "dhaka_sub";

        if (isHomeOnly) {
            // Dhaka Inside ও Dhaka Sub —
            if (finalDeliveryType && finalDeliveryType === "Courier") {
                validationErrors.push(
                    `Courier service not available for ${locationType === "dhaka_inside" ? "Dhaka Inside" : "Dhaka Sub"}`,
                );
            }
            finalDeliveryType = "Home Delivery";
        } else if (locationType === "outside_dhaka") {
            if (!finalDeliveryType || !["Courier", "Home Delivery"].includes(finalDeliveryType)) {
                validationErrors.push(
                    "Valid delivery type is required for outside Dhaka (Courier/Home Delivery)",
                );
            }
            if (finalDeliveryType === "Courier" && !courierBranch) {
                validationErrors.push("Courier branch selection is required");
            }
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

        const isCOD = paymentMethod === "COD";

        // ─── Order Items ──────────────────────────────────────────────────────────
        let finalOrderItems = [];
        let user = null;

        if (isGuest) {
            finalOrderItems = guestItems.map((item) => {
                const variantData = convertVariantToOrderFormat(item.variant);
                return {
                    name: item.name,
                    product: item.productId,
                    variant: variantData,
                    quantity: parseInt(item.quantity) || 1,
                    price: parseFloat(item.priceAtPurchase || item.price || 0),
                    image: item.image || "",
                };
            });
        } else {
            if (!req.user) {
                await session.abortTransaction();
                return res.status(401).json({ success: false, message: "Authentication required" });
            }

            user = req.user.id;
            const cart = await Cart.findOne({ user })
                .session(session)
                .populate("items.product", "name slug imageGroups variants hasVariants");

            if (!cart || cart.items.length === 0) {
                await session.abortTransaction();
                return res.status(400).json({ success: false, message: "Cart is empty" });
            }

            finalOrderItems = cart.items.map((item) => {
                const variantData = convertVariantToOrderFormat(item.variant);
                const product = item.product;
                let imageUrl = "";

                if (item.imageGroupName && product.imageGroups) {
                    const variantImageGroup = product.imageGroups.find(
                        (group) => group.name === item.imageGroupName,
                    );
                    if (variantImageGroup?.images.length > 0) {
                        imageUrl = variantImageGroup.images[0].url;
                    }
                }

                if (!imageUrl && product.imageGroups?.length > 0) {
                    const mainGroup =
                        product.imageGroups.find((g) => g.name === "Main") ||
                        product.imageGroups[0];
                    if (mainGroup?.images.length > 0) imageUrl = mainGroup.images[0].url;
                }

                return {
                    name: getOrderItemName(product.name, item.variant, item.variantDisplayName),
                    product: product._id,
                    variant: variantData,
                    quantity: parseInt(item.quantity) || 1,
                    price: parseFloat(item.priceAtPurchase || 0),
                    image: imageUrl,
                };
            });
        }

        // ─── Price Calculation ────────────────────────────────────────────────────
        // FIX (critical, price-tampering): shippingPrice/taxPrice/discountAmount/
        // codCharge/codOnlinePaymentAmount/remainingAmount used to come straight
        // from req.body and were trusted as-is. They are now always recomputed
        // server-side via the same logic the checkout-preview endpoint uses
        // (services/pricingService.js) — nothing price-related is accepted from
        // the client here.
        const itemsPrice = finalOrderItems.reduce(
            (acc, item) => acc + item.price * item.quantity,
            0,
        );

        const pricing = await computeOrderTotals({
            itemsSubtotal: itemsPrice,
            couponCode,
            userId: isGuest ? null : user,
            locationType,
            deliveryType: finalDeliveryType,
            isCOD,
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
            paymentMethod,
            shippingPrice: finalShippingPrice,
            taxPrice: finalTaxPrice,
            couponCode: couponCode || undefined,
            discountAmount: finalDiscountAmount,
            totalPrice,
            orderStatus: "Pending",
            paymentStatus: "Pending",
            shippingBreakdown: {
                flatCharge: finalShippingPrice,
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
        if (paymentMethod === "SSLCommerz") {
            const paymentData = {
                amount: totalPrice,
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
                `SSLCommerz Payment Initializing: ${totalPrice} BDT for order ${newOrder._id}`,
            );
            const paymentInit = await initializePayment(newOrder._id.toString(), paymentData);

            if (paymentInit.status === "SUCCESS" && paymentInit.GatewayPageURL) {
                if (!isGuest && req.user) {
                    await Cart.findOneAndDelete({ user: req.user.id }).session(session);
                }
                await session.commitTransaction();
                // FIX: usedCount was never incremented anywhere in the codebase,
                // so maxUsage limits were effectively unenforced. Done outside the
                // transaction (best-effort, non-blocking) after commit succeeds.
                if (couponCode) incrementCouponUsage(couponCode);
                return res.status(201).json({
                    success: true,
                    message: "Payment initialized. Redirecting to gateway.",
                    order: newOrder,
                    redirectUrl: paymentInit.GatewayPageURL,
                });
            } else {
                console.error("SSLCommerz initialization failed:", paymentInit);
                newOrder.orderStatus = "Cancelled";
                newOrder.paymentStatus = "Failed";
                newOrder.adminNotes = newOrder.adminNotes || [];
                newOrder.adminNotes.push({
                    note: `SSLCommerz initialization failed: ${paymentInit.failedreason || "Unknown error"}`,
                    addedBy: "system",
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
        } else if (paymentMethod === "COD") {
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
                    addedBy: "system",
                    addedAt: new Date(),
                });

                await newOrder.save({ session, validateBeforeSave: false });
                await session.commitTransaction();
                if (couponCode) incrementCouponUsage(couponCode);
                return res.status(201).json({
                    success: true,
                    message: `COD order - Please pay ${codChargeAmount} BDT online`,
                    order: newOrder,
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
                    addedBy: "system",
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

/**
 * converting Variant data to orders.
 */
const convertVariantToOrderFormat = (variant) => {
    if (!variant || Object.keys(variant).length === 0) {
        return undefined;
    }

    // full options array (current cart shape) — preserve ALL attributes, not just the first
    if (variant.options && Array.isArray(variant.options) && variant.options.length > 0) {
        return {
            options: variant.options.map((opt) => ({ name: opt.name, value: opt.value })),
            displayName:
                variant.displayName ||
                variant.options.map((opt) => `${opt.name}: ${opt.value}`).join(", "),
            sku: variant.sku || undefined,
        };
    }

    // legacy single name/value shape (older clients / imported data)
    if (variant.name || variant.value) {
        return {
            options: [{ name: variant.name || "Variant", value: variant.value || "Default" }],
            displayName: `${variant.name || "Variant"}: ${variant.value || "Default"}`,
            sku: variant.sku || undefined,
        };
    }

    return undefined;
};

/**
 * creating order items name with variant details for better order summary
 */
const getOrderItemName = (productName, variant, variantDisplayName) => {
    let itemName = productName;

    if (variantDisplayName) {
        itemName += ` - ${variantDisplayName}`;
    } else if (variant && variant.options && Array.isArray(variant.options)) {
        const variantText = variant.options.map((opt) => `${opt.name}: ${opt.value}`).join(", ");
        if (variantText) {
            itemName += ` - ${variantText}`;
        }
    } else if (variant && (variant.name || variant.value)) {
        itemName += ` - ${variant.name || "Variant"}: ${variant.value || "Default"}`;
    }

    return itemName;
};

// @desc    Get my orders
// @route   GET /api/v1/orders
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
// @route   GET /api/v1/orders/:id
// @access  Private/Public
export const getOrderById = async (req, res, next) => {
    try {
        console.log("Fetching order with ID:", req.params.id);
        let order = await Order.findOne({ orderNumber: req.params.id })
            .populate("user", "name email")
            .populate("statusHistory.updatedBy", "name");
        if (!order) {
            console.log("Trying to find by _id:", req.params.id);
            order = await Order.findById(req.params.id)
                .populate("user", "name email")
                .populate("statusHistory.updatedBy", "name");
        }
        if (!order) {
            console.log("Order not found for:", req.params.id);
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }
        console.log("Order found:", order.orderNumber);
        // Authorization check - Updated logic
        if (order.isGuest) {
            return res.status(200).json({ success: true, order });
        }
        // Registered user order
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required to view this order",
            });
        }
        if (order.user && order.user._id.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: "Not authorized to view this order",
            });
        }
        res.status(200).json({ success: true, order });
    } catch (error) {
        console.error("Order fetch error:", error);
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
// @route   GET /api/v1/admin/orders
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

        // Search functionality
        if (search) {
            filter.$or = [
                { orderNumber: { $regex: escapeRegex(search), $options: "i" } },
                { "shippingAddress.name": { $regex: escapeRegex(search), $options: "i" } },
                { "shippingAddress.phone": { $regex: escapeRegex(search), $options: "i" } },
                { "shippingAddress.email": { $regex: escapeRegex(search), $options: "i" } },
            ];
        }

        // Sort
        const sort = {};
        sort[sortBy] = sortOrder === "desc" ? -1 : 1;

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
// @route   GET /api/v1/admin/orders/stats
// @access  Private/Admin
export const getOrderStats = async (req, res, next) => {
    try {
        const totalOrders = await Order.countDocuments();
        const pendingOrders = await Order.countDocuments({ orderStatus: "Pending" });
        const deliveredOrders = await Order.countDocuments({ orderStatus: "Delivered" });
        const totalRevenue = await Order.aggregate([
            { $match: { orderStatus: "Delivered" } },
            { $group: { _id: null, total: { $sum: "$totalPrice" } } },
        ]);

        // Last 7 days orders
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentOrders = await Order.countDocuments({
            createdAt: { $gte: sevenDaysAgo },
        });

        // Monthly revenue
        const currentMonth = new Date().getMonth();
        const monthlyRevenue = await Order.aggregate([
            {
                $match: {
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
// @route   PUT /api/v1/admin/orders/:id/status
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
        if (status === "Cancelled" && order.orderStatus !== "Cancelled") {
            console.log("Restoring product stock for cancelled order");
            await updateProductStock(order.orderItems, "increase");
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
// @route   PUT /api/v1/admin/orders/:id/payment
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
        const validStatuses = ["Pending", "Paid", "Failed", "Refunded"];
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

export const updateOrder = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { orderItems, shippingAddress, shippingPrice, taxPrice, note } = req.body;
        const orderId = req.params.id;

        const order = await Order.findById(orderId).session(session);

        if (!order) {
            await session.abortTransaction();
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        let itemsTotal = 0;
        if (orderItems && Array.isArray(orderItems)) {
            const newOrderItems = orderItems.map((item) => ({
                ...item,
                quantity: parseInt(item.quantity) || 0,
                price: parseFloat(item.price) || 0,
                product: item.product._id || item.product,
            }));

            await updateProductStock(order.orderItems, "increase", session);
            order.orderItems = newOrderItems;
            await updateProductStock(newOrderItems, "decrease", session);
            itemsTotal = newOrderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        } else {
            itemsTotal = order.orderItems.reduce(
                (sum, item) => sum + item.price * item.quantity,
                0,
            );
        }
        if (shippingAddress) {
            order.shippingAddress = {
                ...order.shippingAddress,
                ...shippingAddress,
            };
        }

        if (shippingPrice !== undefined) {
            order.shippingPrice = parseFloat(shippingPrice) || 0;
        }

        if (taxPrice !== undefined) {
            order.taxPrice = parseFloat(taxPrice) || 0;
        }

        order.totalPrice = itemsTotal + order.shippingPrice + order.taxPrice;
        order.statusHistory.push({
            status: order.orderStatus,
            note: note || "Order details updated by admin",
            updatedBy: req.user.id,
            updatedAt: new Date(),
        });

        await order.save({ session, runValidators: true });
        await session.commitTransaction();
        const updatedOrder = await Order.findById(orderId)
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
        if (error.name === "ValidationError") {
            const errors = Object.values(error.errors).map((err) => err.message);
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: errors,
            });
        }
        return res
            .status(500)
            .json({ success: false, message: "Server error during order update" });
    } finally {
        session.endSession();
    }
};

// @desc    Add admin note to order
// @route   POST /api/v1/admin/orders/:id/notes
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
// @route   DELETE /api/v1/admin/orders/:id
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

        if (order.orderStatus !== "Cancelled") {
            await updateProductStock(order.orderItems, "increase");
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

export const updateOrderDetails = async (req, res, next) => {
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

        console.log("🔄 Order Update Request:", {
            orderId: req.params.id,
            itemsCount: orderItems?.length,
            shippingPrice,
            taxPrice,
            user: req.user.id,
        });
        let order;
        if (mongoose.Types.ObjectId.isValid(req.params.id)) {
            order = await Order.findById(req.params.id);
        } else {
            order = await Order.findOne({ orderNumber: req.params.id });
        }

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        console.log("Order found:", order.orderNumber);
        if (shippingAddress) {
            order.shippingAddress = {
                ...order.shippingAddress,
                ...shippingAddress,
            };
            console.log("Shipping address updated");
        }

        if (orderItems && Array.isArray(orderItems)) {
            order.orderItems = orderItems.map((item) => ({
                name: item.name,
                product: item.productId || item.product,
                variant: item.variant || {},
                quantity: parseInt(item.quantity) || 1,
                price: parseFloat(item.price) || 0,
                image: item.image || "",
                _id: item._id || new mongoose.Types.ObjectId(),
            }));
            console.log("Order items updated:", orderItems.length);
        }

        // Update pricing
        if (shippingPrice !== undefined) {
            order.shippingPrice = parseFloat(shippingPrice) || 0;
            console.log("Shipping price updated:", order.shippingPrice);
        }

        if (taxPrice !== undefined) {
            order.taxPrice = parseFloat(taxPrice) || 0;
            console.log("Tax price updated:", order.taxPrice);
        }

        if (discountAmount !== undefined) {
            order.discountAmount = parseFloat(discountAmount) || 0;
            console.log("Discount amount updated:", order.discountAmount);
        }
        if (couponCode !== undefined) {
            order.couponCode = couponCode || undefined;
            console.log("Coupon code updated:", order.couponCode);
        }

        // Recalculate total price
        const itemsTotal = order.orderItems.reduce((sum, item) => {
            return sum + item.price * item.quantity;
        }, 0);

        order.totalPrice =
            itemsTotal + order.shippingPrice + order.taxPrice - (order.discountAmount || 0);
        console.log("Total price recalculated:", order.totalPrice);

        // Add to status history
        order.statusHistory.push({
            status: order.orderStatus,
            note: note || "Order details updated by admin",
            updatedBy: req.user.id,
            updatedAt: new Date(),
        });

        await order.save();

        // Populate for response
        await order.populate("user", "name email");
        await order.populate("statusHistory.updatedBy", "name");

        console.log("Order updated successfully:", order.orderNumber);

        res.status(200).json({
            success: true,
            message: "Order updated successfully",
            order,
        });
    } catch (error) {
        console.error("Order update error:", error);

        if (error.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID",
            });
        }

        if (error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error: " + error.message,
        });
    }
};
