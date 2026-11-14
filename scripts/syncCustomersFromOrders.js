// One-off backfill: put every existing order's phone into the
// Customer book. Safe to re-run (upsert by phone; existing rows keep their
// name). ordersPlaced/lastOrderAt are recomputed from the orders.
// Usage: node scripts/syncCustomersFromOrders.js
import "dotenv/config";
import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import Order from "../models/Order.js";
import { normalizeBdPhone } from "../utils/phone.js";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
await mongoose.connect(uri);

const byPhone = new Map();
for await (const o of Order.find({}).select("shippingAddress guestEmail createdAt").lean().cursor()) {
    const a = o.shippingAddress || {};
    const phone = normalizeBdPhone(a.phone);
    if (!phone) continue;
    const cur = byPhone.get(phone) || { name: a.name, email: a.email || o.guestEmail, district: a.district, count: 0, last: null, source: "order" };
    cur.count += 1;
    if (!cur.last || o.createdAt > cur.last) cur.last = o.createdAt;
    byPhone.set(phone, cur);
}

const ops = [...byPhone].map(([phone, c]) => ({
    updateOne: {
        filter: { phone },
        update: {
            $setOnInsert: { phone, name: c.name || "", email: c.email, district: c.district, source: c.source },
            ...(c.count ? { $set: { ordersPlaced: c.count, lastOrderAt: c.last } } : {}),
        },
        upsert: true,
    },
}));
const r = ops.length ? await Customer.bulkWrite(ops, { ordered: false }) : { upsertedCount: 0, modifiedCount: 0 };
console.log(`Customers: ${r.upsertedCount} added, ${r.modifiedCount} updated, from ${byPhone.size} numbers.`);
await mongoose.disconnect();
