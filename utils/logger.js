// utils/logger.js
// Small logging helpers. WHY: controllers used console.log for whole request
// bodies and gateway IPN payloads, which put customer names, phones, emails
// and addresses into the server logs (and every log shipper behind them).
//   debug(...)  prints only with LOG_LEVEL=debug, values passed through redact()
//   redact(x)   masks personal fields, keeps the shape for debugging
const DEBUG = process.env.LOG_LEVEL === "debug";
const PII = /^(name|cus_name|email|cus_email|guestEmail|phone|cus_phone|phoneNumber|address|addressLine1|addressLine2|cus_add1|cus_add2|password|token|guestAccessToken|card_no|card_number|bank_tran_id)$/i;

export const redact = (value, depth = 0) => {
    if (value === null || typeof value !== "object" || depth > 5) return value;
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = PII.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
};

export const debug = (...args) => {
    if (!DEBUG) return;
    console.log(...args.map((a) => (typeof a === "object" ? redact(a) : a)));
};
