import mongoose from "mongoose";
import { verifyPayment } from "../config/sslcommerz.js";
import Order from "../models/Order.js";
import { updateProductStock } from "./orderController.js";

const getClientUrl = () => {
    return (
        process.env.CLIENT_URL ||
        (process.env.NODE_ENV === "production" ? process.env.SITE_URL : "http://localhost:5173")
    );
};

// Helper function to find order by ID or orderNumber.
//
// `+guestAccessToken` is required so the redirect helper below can hand the
// capability token back to a guest's browser — the field is `select: false` on
// the schema and would otherwise come back undefined.
//
// The isValidObjectId guard prevents a CastError when tran_id is an orderNumber
// (findById on a non-ObjectId string throws rather than returning null).
const findOrder = async (tran_id) => {
    let order = null;
    if (mongoose.isValidObjectId(tran_id)) {
        order = await Order.findById(tran_id).select("+guestAccessToken");
    }
    if (!order) {
        order = await Order.findOne({ orderNumber: tran_id }).select("+guestAccessToken");
    }
    return order;
};

/**
 * Build a storefront result URL for an order.
 *
 * SECURITY (Phase 0): the gateway redirects the customer's *browser* here, so
 * this is the only point in the flow where a guest can be handed the capability
 * token that lets them read their own order back
 * (GET /api/orders/:id?token=...). Registered users prove ownership with their
 * JWT and never receive a token.
 *
 * URLSearchParams also gets us encoding for free — orderNumber and reason
 * strings were previously interpolated raw into the query string.
 */
const buildOrderResultUrl = (clientUrl, path, order, extraParams = {}) => {
    const params = new URLSearchParams({
        orderId: String(order._id),
        orderNumber: order.orderNumber || "",
        ...extraParams,
    });
    if (order.isGuest && order.guestAccessToken) {
        params.set("token", order.guestAccessToken);
    }
    return `${clientUrl}${path}?${params.toString()}`;
};

export const processSuccessRedirect = async (req, res) => {
    console.log("PROCESS SUCCESS REDIRECT CALLED");
    console.log("Query params:", req.query);

    try {
        const { orderId, val_id, status, tran_id } = req.query;
        const CLIENT_URL = getClientUrl();

        const finalOrderId = orderId || tran_id;

        if (!finalOrderId) {
            console.error("No orderId or tran_id found");
            return res.redirect(`${CLIENT_URL}/order/fail?message=NoOrderID`);
        }

        console.log("Processing order:", finalOrderId);

        const order = await findOrder(finalOrderId);

        if (!order) {
            console.error(`Order not found: ${finalOrderId}`);
            return res.redirect(`${CLIENT_URL}/order/fail?message=OrderNotFound`);
        }

        console.log("Order found:", {
            orderNumber: order.orderNumber,
            status: order.orderStatus,
            paymentMethod: order.paymentMethod,
            codOnlinePaymentAmount: order.codOnlinePaymentAmount,
            totalPrice: order.totalPrice,
        });

        if (order.orderStatus !== "Pending") {
            console.log(`Already processed: ${order.orderStatus}`);
            // Must carry the token too — a guest refreshing the success page or
            // hitting a duplicate gateway callback lands here, and without it
            // the confirmation page would 401 on its order fetch.
            return res.redirect(buildOrderResultUrl(CLIENT_URL, "/order/success", order));
        }

        let isVerified = false;

        // FIX (CRITICAL — payment bypass): this used to fall back to
        // `isVerified = true` whenever `val_id` was missing, with a comment
        // claiming it was "development mode" but NO actual environment check.
        // This endpoint is public and unauthenticated (SSLCommerz redirects the
        // customer's browser here) — anyone could call
        // GET /api/payment/process-success?orderId=<any pending order id>
        // with no val_id at all and have the order marked Paid/Confirmed for
        // free, in production. Verification against SSLCommerz's validation API
        // is now mandatory whenever val_id is present; if it's missing, the
        // order is treated as unverified (not paid) — never trusted by default.
        if (val_id && status === "VALID") {
            const isCOD = order.paymentMethod === "COD";
            const expectedAmount = isCOD ? order.codOnlinePaymentAmount || 0 : order.totalPrice;

            console.log("Verifying payment:", { val_id, isCOD, expectedAmount });

            const verification = await verifyPayment(val_id, finalOrderId, expectedAmount);
            isVerified = verification.isValid;

            console.log("Verification result:", { isValid: verification.isValid });
        } else {
            console.warn(
                `Payment success redirect for order ${finalOrderId} arrived without a valid val_id — treating as unverified, NOT marking as paid.`,
            );
            isVerified = false;
        }

        if (isVerified) {
            if (order.paymentMethod === "COD") {
                const codPaidAmount = order.codOnlinePaymentAmount || 0;
                const remainingAmount = order.remainingAmount || order.totalPrice - codPaidAmount;
                const isFullyPaid = codPaidAmount >= order.totalPrice;

                order.orderStatus = "Confirmed";
                // FIX: "Partially Paid" isn't a valid paymentStatus enum value (Order.js only
                // allows Pending/Paid/Failed/Refunded) — this used to throw a ValidationError
                // on save() for every COD order with a remaining balance, silently breaking
                // order confirmation. paymentStatus now stays "Pending" until the full total is
                // collected; the advance amount is still tracked via codOnlinePaymentAmount /
                // remainingAmount and logged in adminNotes below.
                order.paymentStatus = isFullyPaid ? "Paid" : "Pending";
                if (isFullyPaid) order.paidAt = new Date();
                order.paymentResult = {
                    id: finalOrderId,
                    status: "VALID",
                    method: "SSLCommerz (COD Charge)",
                    update_time: new Date().toISOString(),
                    amount_paid: codPaidAmount,
                    remaining_amount: remainingAmount,
                };

                order.adminNotes = order.adminNotes || [];
                order.adminNotes.push({
                    note: `COD charge of ${codPaidAmount} BDT paid online. Remaining ${remainingAmount} BDT to be collected upon delivery.`,
                    addedBy: "system",
                    addedAt: new Date(),
                });

                console.log("COD order confirmed");
            } else {
                order.orderStatus = "Processing";
                order.paymentStatus = "Paid";
                order.paidAt = new Date();
                order.paymentResult = {
                    id: finalOrderId,
                    status: "VALID",
                    method: "SSLCommerz",
                    update_time: new Date().toISOString(),
                    amount_paid: order.totalPrice,
                    remaining_amount: 0,
                };
                console.log("Full payment processed");
            }

            try {
                await updateProductStock(order.orderItems, "decrease");
                console.log("Stock updated successfully");
            } catch (stockError) {
                console.error("Stock update error:", stockError);
            }

            order.statusHistory.push({
                status: order.orderStatus,
                note:
                    order.paymentMethod === "COD"
                        ? `COD charge paid online. Order confirmed. Paid: ${order.codOnlinePaymentAmount}`
                        : "Full payment completed online",
                updatedBy: "system",
                updatedAt: new Date(),
            });

            await order.save({ validateBeforeSave: false });
            console.log("Order saved successfully");

            const redirectUrl = buildOrderResultUrl(CLIENT_URL, "/order/success", order);
            console.log(`Redirecting to /order/success for ${order.orderNumber}`);
            return res.redirect(redirectUrl);
        } else {
            console.error("Payment verification failed");
            order.orderStatus = "Cancelled";
            order.paymentStatus = "Failed";

            order.statusHistory.push({
                status: "Cancelled",
                note: "Payment verification failed",
                updatedBy: "system",
                updatedAt: new Date(),
            });

            await order.save({ validateBeforeSave: false });

            return res.redirect(
                buildOrderResultUrl(CLIENT_URL, "/order/fail", order, {
                    reason: "verification_failed",
                }),
            );
        }
    } catch (error) {
        console.error("processSuccessRedirect error:", error);
        const CLIENT_URL = getClientUrl();
        const orderId = req.query.orderId || req.query.tran_id;
        return res.redirect(`${CLIENT_URL}/order/fail?orderId=${orderId || ""}&error=server_error`);
    }
};

/**
 * Shared implementation for the gateway's fail and cancel callbacks. Both do
 * exactly the same thing — cancel a still-Pending order and bounce the customer
 * back to the storefront — so they differ only in the note recorded and the
 * page they land on.
 *
 * NOTE: `updatedBy` is deliberately omitted for system-generated history
 * entries. The path is an ObjectId ref, and the string "system" that used to be
 * passed here never actually persisted: Mongoose records a cast failure instead
 * of throwing, and `validateBeforeSave: false` then discards that error, so the
 * field silently saved as undefined. Omitting it is what was already happening,
 * minus the phantom error. Same pattern still exists in `adminNotes.addedBy`
 * elsewhere in this file and in orderController — worth a follow-up sweep.
 */
const cancelPendingOrderAndRedirect = async (req, res, { note, path, reason }) => {
    const CLIENT_URL = getClientUrl();
    const { orderId, tran_id } = req.query;
    const finalOrderId = orderId || tran_id;

    let order = null;
    if (finalOrderId) {
        try {
            order = await findOrder(finalOrderId);
            if (order && order.orderStatus === "Pending") {
                order.orderStatus = "Cancelled";
                order.paymentStatus = "Failed";

                order.statusHistory.push({
                    status: "Cancelled",
                    note,
                    updatedAt: new Date(),
                });

                await order.save({ validateBeforeSave: false });
                console.log(`Order ${order.orderNumber} cancelled: ${reason}`);
            }
        } catch (error) {
            console.error("Error cancelling order:", error.message);
        }
    }

    // If the order could not be resolved there is no token to hand back and no
    // id worth echoing — send the customer to the bare result page.
    if (!order) {
        return res.redirect(`${CLIENT_URL}${path}?reason=${encodeURIComponent(reason)}`);
    }
    return res.redirect(buildOrderResultUrl(CLIENT_URL, path, order, { reason }));
};

export const processFailRedirect = async (req, res) => {
    console.log("PROCESS FAIL REDIRECT CALLED");
    return cancelPendingOrderAndRedirect(req, res, {
        note: "Payment failed at gateway",
        path: "/order/fail",
        reason: "payment_failed",
    });
};

export const processCancelRedirect = async (req, res) => {
    console.log("PROCESS CANCEL REDIRECT CALLED");
    // FIX: this used to redirect to /order/fail, so a customer who deliberately
    // backed out of payment was shown a failure page. It now lands on the
    // dedicated /order/cancel route.
    return cancelPendingOrderAndRedirect(req, res, {
        note: "Payment cancelled by user",
        path: "/order/cancel",
        reason: "cancelled",
    });
};

export const handleIPN = async (req, res) => {
    console.log("IPN RECEIVED");
    console.log("IPN Body:", req.body);

    const { tran_id, status, val_id, amount } = req.body;

    if (status !== "VALID" || !val_id) {
        console.log("IPN: Status not VALID or val_id missing");
        return res.status(200).send("IPN Status not VALID");
    }

    try {
        const order = await findOrder(tran_id);

        if (!order) {
            console.error(`IPN: Order not found for tran_id: ${tran_id}`);
            return res.status(404).send("Order Not Found");
        }

        if (order.orderStatus === "Processing" || order.orderStatus === "Confirmed") {
            console.log(`IPN: Order ${tran_id} already processed`);
            return res.status(200).send("IPN Handled (Already Processed)");
        }

        const isCODOrder = order.paymentMethod === "COD";
        const expectedAmount = isCODOrder ? order.codOnlinePaymentAmount || 0 : order.totalPrice;

        console.log("IPN Expected amount:", {
            isCODOrder,
            expectedAmount,
            codOnlinePaymentAmount: order.codOnlinePaymentAmount,
        });

        const verificationResult = await verifyPayment(val_id, tran_id, expectedAmount);

        if (verificationResult.isValid) {
            if (isCODOrder) {
                const codPaidAmount = order.codOnlinePaymentAmount || 0;
                const remainingAmount = order.remainingAmount || order.totalPrice - codPaidAmount;

                console.log(`IPN: COD Charge paid for order ${tran_id}: ${codPaidAmount} BDT`);
                const isFullyPaidIPN = codPaidAmount >= order.totalPrice;

                order.orderStatus = "Confirmed";
                // FIX: same enum-mismatch bug as processSuccessRedirect — see comment there.
                order.paymentStatus = isFullyPaidIPN ? "Paid" : "Pending";
                if (isFullyPaidIPN) order.paidAt = new Date();
                order.paymentResult = {
                    id: tran_id,
                    status: verificationResult.data?.status || "VALID",
                    method: "SSLCommerz (COD Charge)",
                    update_time: new Date().toISOString(),
                    amount_paid: codPaidAmount,
                    remaining_amount: remainingAmount,
                };

                await updateProductStock(order.orderItems, "decrease");

                order.adminNotes = order.adminNotes || [];
                order.adminNotes.push({
                    note: `COD charge of ${codPaidAmount} BDT paid online. Remaining ${remainingAmount} BDT to be collected upon delivery.`,
                    addedBy: "system",
                    addedAt: new Date(),
                });
            } else {
                console.log(`IPN: Full payment for order ${tran_id}: ${order.totalPrice} BDT`);

                order.orderStatus = "Processing";
                order.paymentStatus = "Paid";
                order.paidAt = new Date();
                order.paymentResult = {
                    id: tran_id,
                    status: verificationResult.data?.status || "VALID",
                    method: "SSLCommerz",
                    update_time: new Date().toISOString(),
                    amount_paid: order.totalPrice,
                    remaining_amount: 0,
                };

                await updateProductStock(order.orderItems, "decrease");
            }

            order.statusHistory.push({
                status: order.orderStatus,
                note: isCODOrder
                    ? `COD charge paid online via IPN. Amount: ${order.codOnlinePaymentAmount}`
                    : "Full payment completed online via IPN",
                updatedBy: "system",
                updatedAt: new Date(),
            });

            await order.save({ validateBeforeSave: false });

            console.log(
                `IPN: Order ${tran_id} successfully processed. Status: ${order.orderStatus}`,
            );
            res.status(200).send("IPN Handled Successfully");
        } else {
            console.error(`IPN: Payment verification failed for order ${tran_id}`);

            order.orderStatus = "Cancelled";
            order.paymentStatus = "Failed";

            order.statusHistory.push({
                status: "Cancelled",
                note: "Payment verification failed via IPN",
                updatedBy: "system",
                updatedAt: new Date(),
            });

            await order.save({ validateBeforeSave: false });

            res.status(200).send("IPN Validation Failed");
        }
    } catch (error) {
        console.error("IPN processing error:", error);
        res.status(500).send("IPN Server Error");
    }
};
