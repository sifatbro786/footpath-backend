// services/customerSync.js
// Keeps the Customer book filled from storefront activity. Best effort and
// never awaited by the caller's response path: a failure here must not fail
// an order or an inquiry that is already saved.
import Customer from "../models/Customer.js";
import { normalizeBdPhone } from "../utils/phone.js";

const upsert = async ({ phone, name, email, district, address, source, isOrder }) => {
    const p = normalizeBdPhone(phone);
    if (!p) return;
    const update = {
        // Existing rows keep the name/district the owner typed or imported.
        $setOnInsert: { phone: p, source, name: name || "", email, district, address },
    };
    if (isOrder) {
        update.$inc = { ordersPlaced: 1 };
        update.$set = { lastOrderAt: new Date() };
    }
    await Customer.updateOne({ phone: p }, update, { upsert: true });
};

export const recordCustomerFromOrder = (order) => {
    const a = order?.shippingAddress || {};
    upsert({
        phone: a.phone,
        name: a.name,
        email: a.email || order.guestEmail,
        district: a.district,
        address: [a.addressLine1, a.upazila].filter(Boolean).join(", ") || undefined,
        source: "order",
        isOrder: true,
    }).catch((e) => console.error("Customer sync (order) failed:", e.message));
};

export const recordCustomerFromInquiry = (inq) => {
    upsert({
        phone: inq?.phone,
        name: inq?.name,
        email: inq?.email,
        district: inq?.district,
        source: "inquiry",
    }).catch((e) => console.error("Customer sync (inquiry) failed:", e.message));
};
