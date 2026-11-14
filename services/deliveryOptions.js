// services/deliveryOptions.js
// Which delivery types a zone/district offers, decided by admin data only.
//
// The old build hard coded "Dhaka Inside / Dhaka Sub = Home Delivery only"
// (pricingService.isHomeDeliveryOnly), so a Dhaka courier branch added in
// admin was ignored by checkout. Now a type is offered when:
//   - an ACTIVE ShippingRate exists for (locationType, deliveryType), and
//   - for Courier, the district also has an active CourierBranch config with
//     at least one branch.
// Checkout preview, createOrder and validate-location all go through here,
// so what the shopper is offered and what the server accepts cannot drift.
import { CourierBranch, ShippingRate } from "../models/ShippingConfig.js";
import { escapeRegex } from "../utils/escapeRegex.js";

const TYPE_ORDER = ["Home Delivery", "Courier"];

export const findCourierRecord = (district) => {
    if (!district || typeof district !== "string") return null;
    return CourierBranch.findOne({
        district: { $regex: `^${escapeRegex(district.trim())}$`, $options: "i" },
        isActive: true,
    }).lean();
};

/** @returns {Promise<{ types: string[], branches: string[] }>} */
export const resolveDeliveryOptions = async ({ locationType, district }) => {
    const rates = await ShippingRate.find({ locationType, isActive: true }).select("deliveryType").lean();
    const types = new Set(rates.map((r) => r.deliveryType));

    let branches = [];
    if (types.has("Courier")) {
        const rec = await findCourierRecord(district);
        branches = (rec?.branches || []).map((b) => String(b).trim()).filter(Boolean);
        // A courier rate with nowhere to pick up from is not an option.
        if (!branches.length) types.delete("Courier");
    }

    return { types: TYPE_ORDER.filter((t) => types.has(t)), branches };
};

/**
 * Validate a requested delivery choice against what the area offers.
 * A missing deliveryType is accepted only when there is exactly one option.
 * @returns {Promise<{ ok: true, deliveryType: string } | { ok: false, message: string }>}
 */
export const checkDeliveryChoice = async ({ locationType, district, deliveryType, courierBranch }) => {
    const { types, branches } = await resolveDeliveryOptions({ locationType, district });
    if (!types.length) {
        return { ok: false, message: "Delivery is not available for this area yet." };
    }

    const chosen = deliveryType || (types.length === 1 ? types[0] : null);
    if (!chosen) return { ok: false, message: "Choose a delivery option." };
    if (!types.includes(chosen)) {
        return { ok: false, message: `${chosen} is not available for this area.` };
    }

    if (chosen === "Courier") {
        if (!courierBranch) return { ok: false, message: "Courier branch selection is required" };
        // Free text from the client: only accept a branch the admin configured,
        // otherwise any string ends up on the order and the parcel label.
        if (!branches.includes(String(courierBranch).trim())) {
            return { ok: false, message: "Choose a courier branch from the list." };
        }
    }
    return { ok: true, deliveryType: chosen };
};
