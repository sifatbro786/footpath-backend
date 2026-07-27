import Order from "../models/Order.js";
import { verifyPayment } from "../config/sslcommerz.js";
import { updateProductStock } from "./orderController.js";

const getClientUrl = () => {
    return (
        process.env.CLIENT_URL ||
        (process.env.NODE_ENV === "production" ? process.env.SITE_URL : "http://localhost:5173")
    );
};

// Helper function to find order by ID or orderNumber
const findOrder = async (tran_id) => {
    let order = await Order.findById(tran_id);
    if (!order) {
        order = await Order.findOne({ orderNumber: tran_id });
    }
    return order;
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
            return res.redirect(
                `${CLIENT_URL}/order/success?orderId=${order._id}&orderNumber=${order.orderNumber}`,
            );
        }

        let isVerified = false;

        // FIX (CRITICAL — payment bypass): this used to fall back to
        // `isVerified = true` whenever `val_id` was missing, with a comment
        // claiming it was "development mode" but NO actual environment check.
        // This endpoint is public and unauthenticated (SSLCommerz redirects the
        // customer's browser here) — anyone could call
        // GET /api/v1/payment/process-success?orderId=<any pending order id>
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

                order.orderStatus = "Confirmed";
                order.paymentStatus = codPaidAmount >= order.totalPrice ? "Paid" : "Partially Paid";
                order.paidAt = new Date();
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

            const redirectUrl = `${CLIENT_URL}/order/success?orderId=${order._id}&orderNumber=${order.orderNumber}`;
            console.log(`Redirecting to: ${redirectUrl}`);
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
                `${CLIENT_URL}/order/fail?orderId=${order._id}&reason=verification_failed`,
            );
        }
    } catch (error) {
        console.error("processSuccessRedirect error:", error);
        const CLIENT_URL = getClientUrl();
        const orderId = req.query.orderId || req.query.tran_id;
        return res.redirect(`${CLIENT_URL}/order/fail?orderId=${orderId || ""}&error=server_error`);
    }
};

export const processFailRedirect = async (req, res) => {
    console.log("PROCESS FAIL REDIRECT CALLED");
    console.log("Query params:", req.query);

    const CLIENT_URL = getClientUrl();
    const { orderId, tran_id } = req.query;
    const finalOrderId = orderId || tran_id;

    if (finalOrderId) {
        try {
            const order = await findOrder(finalOrderId);
            if (order && order.orderStatus === "Pending") {
                order.orderStatus = "Cancelled";
                order.paymentStatus = "Failed";

                order.statusHistory.push({
                    status: "Cancelled",
                    note: "Payment failed or cancelled by user",
                    updatedBy: "system",
                    updatedAt: new Date(),
                });

                await order.save({ validateBeforeSave: false });
                console.log(`Order ${order.orderNumber} cancelled due to payment failure`);
            }
        } catch (error) {
            console.error("Error cancelling order:", error);
        }
    }

    return res.redirect(`${CLIENT_URL}/order/fail?orderId=${finalOrderId || ""}`);
};

export const processCancelRedirect = async (req, res) => {
    console.log("PROCESS CANCEL REDIRECT CALLED");
    console.log("Query params:", req.query);

    const CLIENT_URL = getClientUrl();
    const { orderId, tran_id } = req.query;
    const finalOrderId = orderId || tran_id;

    if (finalOrderId) {
        try {
            const order = await findOrder(finalOrderId);
            if (order && order.orderStatus === "Pending") {
                order.orderStatus = "Cancelled";
                order.paymentStatus = "Failed";

                order.statusHistory.push({
                    status: "Cancelled",
                    note: "Payment cancelled by user",
                    updatedBy: "system",
                    updatedAt: new Date(),
                });

                await order.save({ validateBeforeSave: false });
                console.log(`Order ${order.orderNumber} cancelled by user`);
            }
        } catch (error) {
            console.error("Error cancelling order:", error);
        }
    }

    return res.redirect(`${CLIENT_URL}/order/fail?orderId=${finalOrderId || ""}&reason=cancelled`);
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

                order.orderStatus = "Confirmed";
                order.paymentStatus = codPaidAmount >= order.totalPrice ? "Paid" : "Partially Paid";
                order.paidAt = new Date();
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
