// scripts/seedShippingRates.js
// One-time setup script — run this once after connecting to a fresh database
// so checkout has something to work with (ShippingRate.find() otherwise
// returns nothing and every checkout fails with "Shipping rate configuration
// not found"). Values below are just a starting point (per the owner's
// 70/100/130/170 scheme) — adjust them anytime from the admin panel afterward
// (PUT /api/v1/admin/shipping/rates/:id), no need to re-run this script.
//
// Usage:
//   node scripts/seedShippingRates.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../config/database.js";
import { ShippingRate } from "../models/ShippingConfig.js";

dotenv.config();

// locationType/deliveryType combinations that are actually reachable per the
// business rules in checkoutController.js / orderController.js:
//   - dhaka_inside and dhaka_sub are ALWAYS "Home Delivery" (Courier isn't offered)
//   - outside_dhaka can be either "Home Delivery" or "Courier"
const defaultRates = [
    { locationType: "dhaka_inside", deliveryType: "Home Delivery", baseCharge: 70 },
    { locationType: "dhaka_sub", deliveryType: "Home Delivery", baseCharge: 100 },
    { locationType: "outside_dhaka", deliveryType: "Home Delivery", baseCharge: 170 },
    { locationType: "outside_dhaka", deliveryType: "Courier", baseCharge: 130 },
];

const run = async () => {
    await connectDB();

    for (const rate of defaultRates) {
        const exists = await ShippingRate.findOne({
            locationType: rate.locationType,
            deliveryType: rate.deliveryType,
        });
        if (exists) {
            console.log(`⏭  Skipping (already exists): ${rate.locationType} / ${rate.deliveryType}`);
            continue;
        }
        await ShippingRate.create({
            ...rate,
            codChargeType: "fixed",
            codChargeValue: 20,
            isActive: true,
        });
        console.log(`✅ Created: ${rate.locationType} / ${rate.deliveryType} → ৳${rate.baseCharge}`);
    }

    console.log("\nDone. Adjust these anytime from the admin panel.");
    await mongoose.connection.close();
    process.exit(0);
};

run().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
});
