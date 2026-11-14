import mongoose from "mongoose";

// Customer / lead book for marketing (SMS, calls, promos). Separate from User
// on purpose: most of these people never create an account. Rows come from
// the owner's old spreadsheets (CSV import), manual entry, storefront orders
// and inquiries. Identity = normalized BD mobile number (utils/phone.js).
const SOURCES = ["manual", "import", "order", "inquiry"];

const customerSchema = new mongoose.Schema(
    {
        name: { type: String, trim: true, maxlength: 120, default: "" },
        phone: { type: String, required: true, trim: true, match: /^01[3-9]\d{8}$/ },
        email: { type: String, trim: true, lowercase: true, maxlength: 160 },
        district: { type: String, trim: true, maxlength: 80 },
        address: { type: String, trim: true, maxlength: 300 },
        // Free labels for segmenting: "vip", "eid-2026", "corporate".
        tags: {
            type: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
            default: [],
        },
        source: { type: String, enum: SOURCES, default: "manual", index: true },
        note: { type: String, trim: true, maxlength: 1000 },
        // Opt-out must stick across re-imports, so import never touches it.
        marketingOptIn: { type: Boolean, default: true },
        ordersPlaced: { type: Number, default: 0, min: 0 },
        lastOrderAt: { type: Date },
        // Which CSV a row first came from, to undo a bad import by hand.
        importBatch: { type: String, trim: true, maxlength: 80 },
    },
    { timestamps: true },
);

customerSchema.index({ phone: 1 }, { unique: true });
customerSchema.index({ tags: 1 });
customerSchema.index({ createdAt: -1 });

export const CUSTOMER_SOURCES = SOURCES;
export default mongoose.model("Customer", customerSchema);
