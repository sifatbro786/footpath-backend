import axios from "axios";
import dotenv from "dotenv";
import qs from "qs";
dotenv.config();

// FIX (critical): these were previously hardcoded to "" / "" / false, ignoring
// SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD / SSLCOMMERZ_IS_SANDBOX in
// .env entirely — meaning every payment request was sent with an empty
// store_id/store_passwd and would always fail. Now actually reads .env.
const STORE_ID = process.env.SSLCOMMERZ_STORE_ID || "";
const STORE_PASS = process.env.SSLCOMMERZ_STORE_PASSWORD || "";
const IS_SANDBOX = process.env.SSLCOMMERZ_IS_SANDBOX === "true";

if (!STORE_ID || !STORE_PASS) {
    console.warn(
        "⚠️  SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD are not set in .env — payments will fail until configured.",
    );
}

const BASE_URL = process.env.BASE_URL || "http://localhost:5010";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

console.log("SSLCommerz Environment:", {
    environment: process.env.NODE_ENV,
    base_url: BASE_URL,
    client_url: CLIENT_URL,
    is_sandbox: IS_SANDBOX,
});

const API_URL = IS_SANDBOX
    ? "https://sandbox.sslcommerz.com/gwprocess/v4/api.php"
    : "https://securepay.sslcommerz.com/gwprocess/v4/api.php";

const VALIDATION_URL = IS_SANDBOX
    ? "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"
    : "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php";

export const initializePayment = async (orderId, paymentData) => {
    const { amount, cus_name, cus_email, cus_phone, shippingAddress, isCOD = false } = paymentData;

    const data = {
        store_id: STORE_ID,
        store_passwd: STORE_PASS,
        total_amount: parseFloat(amount).toFixed(2),
        currency: "BDT",
        tran_id: orderId.toString(),

        success_url: `${BASE_URL}/api/payment/process-success?orderId=${orderId}`,
        fail_url: `${BASE_URL}/api/payment/process-fail?orderId=${orderId}`,
        cancel_url: `${BASE_URL}/api/payment/process-cancel?orderId=${orderId}`,
        ipn_url: `${BASE_URL}/api/payment/ipn`,

        shipping_method: "YES",
        ship_name: cus_name,
        ship_add1: shippingAddress?.addressLine1 || "Courier Pickup",
        ship_add2: shippingAddress?.addressLine2 || "",
        ship_city: shippingAddress?.district || "Dhaka",
        ship_state: shippingAddress?.upazila || "Dhaka",
        ship_postcode: shippingAddress?.zipCode || "1000",
        ship_country: "Bangladesh",

        cus_name: cus_name,
        cus_email: cus_email || "customer@example.com",
        cus_add1: shippingAddress?.addressLine1 || "Courier Pickup",
        cus_add2: shippingAddress?.addressLine2 || "",
        cus_city: shippingAddress?.district || "Dhaka",
        cus_state: shippingAddress?.upazila || "Dhaka",
        cus_postcode: shippingAddress?.zipCode || "1000",
        cus_country: "Bangladesh",
        cus_phone: cus_phone,
        cus_fax: cus_phone,

        product_category: "E-commerce",
        product_name: isCOD ? "COD Charge Payment" : "Online Purchase",
        product_profile: "general",

        value_a: isCOD ? "COD" : "FULL",
        value_b: orderId,
        value_c: process.env.NODE_ENV || "development",
    };

    console.log("SSLCommerz Init:", {
        orderId,
        amount: data.total_amount,
        success_url: data.success_url,
        environment: process.env.NODE_ENV,
    });

    try {
        const response = await axios.post(API_URL, qs.stringify(data), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
            },
            timeout: 30000,
        });

        return response.data;
    } catch (error) {
        console.error("SSL Commerz Init Error:", error.response?.data || error.message);
        throw error;
    }
};

export const verifyPayment = async (val_id, tran_id, expectedAmount) => {
    const params = {
        val_id: val_id,
        store_id: STORE_ID,
        store_passwd: STORE_PASS,
        format: "json",
    };

    try {
        const response = await axios.get(VALIDATION_URL, {
            params,
            timeout: 45000,
        });

        const result = response.data;

        const paidAmount = parseFloat(result.amount || result.store_amount);
        const amountMatches = Math.abs(paidAmount - expectedAmount) < 1;

        const isValid = result.status === "VALID" && result.tran_id === tran_id && amountMatches;

        return {
            isValid,
            data: result,
        };
    } catch (error) {
        console.error("SSLCommerz Verification Error:", error.message);
        return { isValid: false, error: error.message };
    }
};
