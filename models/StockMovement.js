import mongoose from "mongoose";

// Append-only stock ledger. Every change to Product.stock / variants[i].stock
// writes one row here: orders (decrease on confirm/payment, increase on
// cancel/delete/edit), and admin adjustments from the Stock page. Rows are
// never edited; a mistake is corrected by a new "correction" row.
//
// Variant identity is the options array (variants have no _id), stored with a
// readable label so the history survives a renamed or deleted variant.
export const MOVEMENT_TYPES = [
    "purchase", // stock received (new harvest, supplier delivery)
    "return", // customer return put back on the shelf
    "damage", // spoiled, broken, expired
    "correction", // count mismatch, set to counted value
    "order", // sold: order entered a stock-held status
    "order_cancel", // order left a stock-held status / deleted / items edited
    "other",
];

const stockMovementSchema = new mongoose.Schema(
    {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
        productName: { type: String, trim: true },
        variantOptions: { type: [{ name: String, value: String, _id: false }], default: [] },
        variantLabel: { type: String, trim: true, default: "" },
        type: { type: String, enum: MOVEMENT_TYPES, required: true, index: true },
        // Signed: +10 received, -3 sold.
        change: { type: Number, required: true },
        before: { type: Number },
        after: { type: Number },
        unit: { type: String, trim: true },
        order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
        orderNumber: { type: String, trim: true },
        note: { type: String, trim: true, maxlength: 500 },
        // Omitted for system rows (payment IPN, gateway callbacks): an ObjectId ref
        // cannot hold "system" (see CLAUDE.md trap 6).
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

stockMovementSchema.index({ createdAt: -1 });
stockMovementSchema.index({ product: 1, createdAt: -1 });

export default mongoose.model("StockMovement", stockMovementSchema);
