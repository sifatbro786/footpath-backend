import mongoose from "mongoose";

const upazilaSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        shippingZone: {
            type: String,
            required: true,
            enum: ["dhaka_city", "dhaka_sub", "dhaka_outside", "other_district"],
        },
    },
    { _id: true },
);

const districtSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, unique: true },
        upazilas: [upazilaSchema],
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
);

const courierBranchSchema = new mongoose.Schema(
    {
        district: { type: String, required: true },
        branches: [{ type: String }],
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
);

const shippingRateSchema = new mongoose.Schema(
    {
        locationType: {
            type: String,
            required: true,
            enum: ["dhaka_inside", "dhaka_sub", "outside_dhaka"],
        },
        deliveryType: {
            type: String,
            required: true,
            enum: ["Home Delivery", "Courier"],
        },
        baseCharge: { type: Number, required: true, default: 0 },
        codChargeType: {
            type: String,
            enum: ["fixed", "percentage"],
            default: "fixed",
        },
        codChargeValue: { type: Number, required: true, default: 187 },
        codCharge: { type: Number, default: 187 },
        freeShippingThreshold: { type: Number, default: null },
        reducedShippingThreshold: { type: Number, default: null },
        reducedShippingAmount: { type: Number, default: null },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
);

shippingRateSchema.index({ locationType: 1, deliveryType: 1 }, { unique: true });

shippingRateSchema.pre("save", function (next) {
    // `codCharge` is a legacy display mirror of codChargeValue — it is NOT the
    // resolved charge. Percentage rates only get resolved to an actual amount
    // at checkout, in pricingService.calculateCODCharge (codChargeValue/100 *
    // orderAmount). Do not read this field expecting a resolved percentage.
    this.codCharge = this.codChargeValue;
    next();
});

export const District = mongoose.model("District", districtSchema);
export const CourierBranch = mongoose.model("CourierBranch", courierBranchSchema);
export const ShippingRate = mongoose.model("ShippingRate", shippingRateSchema);
