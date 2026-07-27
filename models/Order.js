import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    // FIX (critical): was { name: String, value: String, sku: String } — a single
    // attribute pair. Any variant with more than one attribute (e.g. Color + Size)
    // silently lost every attribute after the first when the order was saved.
    // Now stores the full options array, matching the Cart item shape.
    variant: {
        options: [{ name: String, value: String, _id: false }],
        displayName: String,
        sku: String,
    },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    image: { type: String },
});

const shippingAddressSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        phone: { type: String, required: true },
        email: { type: String },
        addressLine1: {
            type: String,
            required: function () {
                const deliveryType = this.deliveryType;
                const locationType = this.locationType;
                return (
                    deliveryType === "Home Delivery" ||
                    locationType === "dhaka_inside" ||
                    locationType === "dhaka_sub"
                );
            },
        },
        addressLine2: { type: String },
        district: {
            type: String,
            required: function () {
                const deliveryType = this.deliveryType;
                const locationType = this.locationType;
                return (
                    deliveryType === "Home Delivery" ||
                    locationType === "dhaka_inside" ||
                    locationType === "dhaka_sub"
                );
            },
        },
        upazila: {
            type: String,
            required: function () {
                const deliveryType = this.deliveryType;
                const locationType = this.locationType;
                return (
                    deliveryType === "Home Delivery" ||
                    locationType === "dhaka_inside" ||
                    locationType === "dhaka_sub"
                );
            },
        },
        zipCode: { type: String },
        country: { type: String, default: "Bangladesh" },
        // FIX (critical): was ["inside_dhaka", "outside_dhaka"] — did not match the
        // "dhaka_inside" / "dhaka_sub" / "outside_dhaka" values that checkoutController.js
        // and orderController.js actually validate and send. Every order with a Dhaka
        // address would fail this enum check at save() time.
        locationType: {
            type: String,
            enum: ["dhaka_inside", "dhaka_sub", "outside_dhaka"],
            required: true,
        },
        deliveryType: {
            type: String,
            enum: ["Courier", "Home Delivery"],
            required: function () {
                const locationType = this.locationType;
                return locationType === "outside_dhaka";
            },
        },
        courierBranch: {
            type: String,
            required: function () {
                const deliveryType = this.deliveryType;
                return deliveryType === "Courier";
            },
        },
    },
    { _id: false },
);

const paymentResultSchema = new mongoose.Schema(
    {
        id: { type: String },
        status: { type: String },
        method: { type: String },
        update_time: { type: String },
        email_address: { type: String },
    },
    { _id: false },
);

const orderStatusHistorySchema = new mongoose.Schema(
    {
        status: { type: String, required: true },
        note: { type: String },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const shippingBreakdownSchema = new mongoose.Schema(
    {
        flatCharge: {
            type: Number,
            default: 0,
        },
        totalQuantity: {
            type: Number,
            default: 0,
        },
        totalShipping: {
            type: Number,
            default: 0,
        },
    },
    { _id: false },
);

const orderSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        isGuest: {
            type: Boolean,
            default: false,
        },
        guestEmail: {
            type: String,
        },
        orderNumber: {
            type: String,
            unique: true,
        },
        orderItems: [orderItemSchema],
        shippingAddress: shippingAddressSchema,
        paymentMethod: {
            type: String,
            required: true,
            enum: ["COD", "SSLCommerz"],
        },
        paymentResult: paymentResultSchema,
        shippingPrice: {
            type: Number,
            required: true,
            default: 0.0,
        },
        taxPrice: {
            type: Number,
            required: true,
            default: 0.0,
        },
        couponCode: {
            type: String,
            trim: true,
        },
        discountAmount: {
            type: Number,
            required: true,
            default: 0.0,
        },
        totalPrice: {
            type: Number,
            required: true,
            default: 0.0,
        },
        orderStatus: {
            type: String,
            required: true,
            enum: [
                "Pending",
                "Confirmed",
                "Processing",
                "Shipped",
                "Delivered",
                "Cancelled",
                "Refunded",
            ],
            default: "Pending",
        },
        paymentStatus: {
            type: String,
            enum: ["Pending", "Paid", "Failed", "Refunded"],
            default: "Pending",
        },
        statusHistory: [orderStatusHistorySchema],

        codCharge: {
            type: Number,
            default: 0,
        },
        codOnlinePaymentAmount: {
            type: Number,
            default: 0,
        },
        remainingAmount: {
            type: Number,
            default: 0,
        },

        adminNotes: [
            {
                note: String,
                addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                addedAt: { type: Date, default: Date.now },
            },
        ],

        trackingNumber: String,
        shippingBreakdown: shippingBreakdownSchema,
        carrier: String,
        paidAt: Date,
        deliveredAt: Date,
    },
    {
        timestamps: true,
    },
);

// Order Number Generate Middleware
orderSchema.pre("save", async function (next) {
    if (this.isNew) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const day = date.getDate().toString().padStart(2, "0");

        const count = await Order.countDocuments({
            createdAt: {
                $gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
                $lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
            },
        });

        this.orderNumber = `ORD${year}${month}${day}${(count + 1).toString().padStart(4, "0")}`;

        this.statusHistory.push({
            status: "Pending",
            note: "Order placed successfully",
            updatedAt: new Date(),
        });
    }
    next();
});

const Order = mongoose.model("Order", orderSchema);
export default Order;
