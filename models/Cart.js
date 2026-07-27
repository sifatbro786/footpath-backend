import mongoose from "mongoose";

const cartVariantOptionSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        value: { type: String, required: true, trim: true },
    },
    { _id: false },
);

const cartItemSchema = new mongoose.Schema(
    {
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
        },
        // NOTE (Phase 3 cleanup): a `variantId` ObjectId field used to live here,
        // intended to reference a specific Product variant subdocument. Product
        // variants have `_id: false` (see models/Product.js), so that field was
        // always undefined and never actually used for matching — variant
        // identity is (and always was) determined by the `options` array below.
        variant: {
            options: [cartVariantOptionSchema],
            imageGroupName: { type: String, trim: true },
            displayName: { type: String, trim: true },
            sku: { type: String, trim: true },
        },
        quantity: {
            type: Number,
            required: true,
            min: [1, "Quantity must be at least 1"],
        },
        priceAtPurchase: {
            type: Number,
            required: true,
        },
        basePrice: Number,
        discountPercentage: Number,
    },
    { _id: true },
);

const cartSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        items: [cartItemSchema],
        totalPrice: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    },
);

cartSchema.pre("save", function (next) {
    let total = 0;
    this.items.forEach((item) => {
        total += item.priceAtPurchase * item.quantity;
    });
    this.totalPrice = total;
    next();
});

const Cart = mongoose.model("Cart", cartSchema);
export default Cart;
