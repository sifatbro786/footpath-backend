// controllers/admin/manualOrderController.js
// Phone orders: the owner talks to a customer, then enters the order here.
//
// Why this does not reuse createOrder: createOrder is the shopper path. It
// prices from the catalogue only and always goes to the gateway. A phone order
// is an ADMIN decision: bulk buyers negotiate the price on the call, payment
// happens outside the site (cash, personal bKash, bank), and there is no
// gateway. So:
//   - the catalogue price is the default, an admin may type a unit price per
//     line (flagged priceOverridden, retail kept for comparison);
//   - delivery uses the same zone rates (calculateShippingCharge) unless the
//     admin types a delivery charge;
//   - totals are still computed HERE, never taken from the browser: the form
//     calls /manual/preview to show them and /manual to save.
// Only admins reach this (protect + admin on the router).
import mongoose from "mongoose";
import Order from "../../models/Order.js";
import Product from "../../models/Product.js";
import { District } from "../../models/ShippingConfig.js";
import { shippingZoneToLocationType } from "../checkoutController.js";
import { STOCK_HELD_STATUSES, updateProductStock } from "../orderController.js";
import { recordCustomerFromOrder } from "../../services/customerSync.js";
import { checkDeliveryChoice } from "../../services/deliveryOptions.js";
import { findVariantByOptions, unitPriceFor } from "../../services/lineItemPricing.js";
import { calculateShippingCharge } from "../../services/pricingService.js";
import { normalizeBdPhone } from "../../utils/phone.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const INITIAL_STATUSES = ["Pending", "Confirmed"];
const PAY_METHODS = ["cash", "bkash", "nagad", "rocket", "bank", "card", "other"];
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

const imageFor = (product, variant) => {
    const groups = product.imageGroups || [];
    if (variant?.imageGroupName) {
        const g = groups.find((x) => x.name === variant.imageGroupName);
        if (g?.images?.length) return g.images[0].url;
    }
    const main = groups.find((g) => g.name === "Main") || groups[0];
    return main?.images?.[0]?.url || "";
};

/**
 * Validate and price everything. Pure apart from DB reads.
 * @returns {Promise<{ok:false,status,message} | {ok:true, ...}>}
 */
const buildOrder = async (body, { session = null } = {}) => {
    const fail = (message, status = 400) => ({ ok: false, status, message });
    const { customer = {}, address = {}, items, status = "Confirmed" } = body;

    // ── Customer ────────────────────────────────────────────────────────────
    const name = typeof customer.name === "string" ? customer.name.trim().slice(0, 120) : "";
    const phone = normalizeBdPhone(customer.phone);
    if (!name) return fail("Customer name is required");
    if (!phone) return fail("Enter a valid Bangladesh mobile number");
    const email = typeof customer.email === "string" && /\S+@\S+\.\S+/.test(customer.email) ? customer.email.trim().toLowerCase() : undefined;

    if (!INITIAL_STATUSES.includes(status)) return fail("Invalid order status");

    // ── Address -> zone -> delivery option (same rules as the storefront) ──
    const districtDoc = await District.findOne({ name: address.district, isActive: true }).session(session).lean();
    if (!districtDoc) return fail("Choose a district");
    const upazila = districtDoc.upazilas.find((u) => u.name === address.upazila);
    if (!upazila) return fail("Choose an upazila / area");
    const locationType = shippingZoneToLocationType(upazila.shippingZone);
    const delivery = await checkDeliveryChoice({
        locationType,
        district: address.district,
        deliveryType: body.deliveryType,
        courierBranch: body.courierBranch,
    });
    if (!delivery.ok) return fail(delivery.message);
    const deliveryType = delivery.deliveryType;
    const addressLine1 = typeof address.addressLine1 === "string" ? address.addressLine1.trim().slice(0, 300) : "";
    if (deliveryType !== "Courier" && !addressLine1) return fail("Street address is required for home delivery");

    // ── Lines ───────────────────────────────────────────────────────────────
    if (!Array.isArray(items) || items.length === 0) return fail("Add at least one product");
    if (items.length > 100) return fail("Too many lines");
    const ids = [...new Set(items.map((i) => String(i.productId || "")).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
    const products = await Product.find({ _id: { $in: ids } })
        .select("name price basePrice stock hasVariants variants imageGroups isActive weight")
        .session(session)
        .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const willHoldStock = STOCK_HELD_STATUSES.includes(status);

    const lines = [];
    const warnings = [];
    // Same product+variant twice would pass two separate stock checks: sum first.
    const wanted = new Map();
    for (const raw of items) {
        const product = byId.get(String(raw.productId));
        if (!product) return fail("A product in the order no longer exists");
        const quantity = parseInt(raw.quantity, 10);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) return fail(`Invalid quantity for ${product.name}`);

        let variant = null;
        if (product.hasVariants) {
            variant = findVariantByOptions(product, raw.options || raw.variant?.options || []);
            if (!variant) return fail(`Choose a size/option for ${product.name}`);
        }
        const listPrice = unitPriceFor(product, variant);
        const catalogue = { unitPrice: listPrice, retailPrice: listPrice };
        const override = num(raw.unitPrice);
        if (override !== null && (!Number.isFinite(override) || override < 0)) return fail(`Invalid price for ${product.name}`);

        const unitPrice = round2(override ?? catalogue.unitPrice);
        const priceOverridden = override !== null && round2(override) !== catalogue.unitPrice;
        const displayName = variant ? variant.options.map((o) => o.value).join(" / ") : "";
        const unitWeight = variant?.weight > 0 ? variant.weight : Number(product.weight) || 0;

        if (product.isActive === false) warnings.push(`${product.name} is hidden on the website`);

        const key = `${product._id}|${displayName}`;
        const prev = wanted.get(key) || { product, variant, qty: 0 };
        prev.qty += quantity;
        wanted.set(key, prev);

        lines.push({
            name: displayName ? `${product.name} (${displayName})` : product.name,
            product: product._id,
            variant: variant ? { options: variant.options.map(({ name: n, value }) => ({ name: n, value })), displayName, sku: variant.sku } : undefined,
            quantity,
            price: unitPrice,
            retailPrice: catalogue.retailPrice,
            priceOverridden,
            weightKg: round2(unitWeight * quantity),
            image: imageFor(product, variant),
            lineTotal: round2(unitPrice * quantity),
        });
    }

    // Stock only matters when this order takes stock now (Confirmed).
    if (willHoldStock) {
        for (const w of wanted.values()) {
            const stock = w.variant ? w.variant.stock || 0 : w.product.stock || 0;
            if (w.qty > stock) {
                const label = w.variant ? `${w.product.name} (${w.variant.options.map((o) => o.value).join(" / ")})` : w.product.name;
                return fail(stock > 0 ? `Only ${stock} of ${label} in stock` : `${label} is out of stock. Add stock first or save as Pending.`, 409);
            }
        }
    }

    // ── Money ───────────────────────────────────────────────────────────────
    const itemsSubtotal = round2(lines.reduce((a, l) => a + l.lineTotal, 0));
    const totalWeightKg = round2(lines.reduce((a, l) => a + l.weightKg, 0));
    const discountRaw = num(body.discount) ?? 0;
    if (!Number.isFinite(discountRaw) || discountRaw < 0) return fail("Invalid discount");
    const discountAmount = round2(Math.min(discountRaw, itemsSubtotal));
    const afterDiscount = round2(itemsSubtotal - discountAmount);

    const shipOverride = num(body.shippingCharge);
    let shippingPrice;
    let shippingBreakdown;
    if (shipOverride !== null) {
        if (!Number.isFinite(shipOverride) || shipOverride < 0) return fail("Invalid delivery charge");
        shippingPrice = round2(shipOverride);
        shippingBreakdown = { flatCharge: shippingPrice, totalWeightKg, totalShipping: shippingPrice };
    } else {
        const ship = await calculateShippingCharge({ locationType, deliveryType, orderAmountAfterDiscount: afterDiscount, totalWeightKg });
        if (ship.error) return fail(`${ship.error} Type a delivery charge instead.`);
        shippingPrice = ship.shippingPrice;
        shippingBreakdown = ship.breakdown;
    }
    const totalPrice = round2(afterDiscount + shippingPrice);

    // ── Payment taken outside the site ─────────────────────────────────────
    const pay = body.payment || {};
    const method = PAY_METHODS.includes(pay.method) ? pay.method : "cash";
    const paidRaw = num(pay.paidAmount) ?? 0;
    if (!Number.isFinite(paidRaw) || paidRaw < 0) return fail("Invalid paid amount");
    const paidAmount = round2(Math.min(paidRaw, totalPrice));
    const paymentStatus = paidAmount <= 0 ? "Pending" : paidAmount >= totalPrice ? "Paid" : "Partial";

    return {
        ok: true,
        warnings,
        order: {
            orderSource: "phone",
            isGuest: false,
            user: null,
            guestEmail: email,
            orderItems: lines.map(({ lineTotal: _l, ...rest }) => rest),
            shippingAddress: {
                name,
                phone,
                email,
                addressLine1: addressLine1 || undefined,
                addressLine2: typeof address.addressLine2 === "string" ? address.addressLine2.trim().slice(0, 300) : undefined,
                district: address.district,
                upazila: address.upazila,
                locationType,
                deliveryType,
                courierBranch: deliveryType === "Courier" ? body.courierBranch : undefined,
            },
            paymentMethod: "Manual",
            manualPayment: { method, reference: typeof pay.reference === "string" ? pay.reference.trim().slice(0, 120) : undefined, paidAmount },
            paymentStatus,
            paidAt: paymentStatus === "Paid" ? new Date() : undefined,
            shippingPrice,
            shippingBreakdown,
            taxPrice: 0,
            discountAmount,
            totalPrice,
            codCharge: 0,
            // Same split fields the rest of the app reads: what is in hand vs due.
            codOnlinePaymentAmount: paidAmount,
            remainingAmount: round2(totalPrice - paidAmount),
            totalWeightKg,
            orderStatus: status,
        },
        lines,
        totals: { itemsSubtotal, discountAmount, shippingPrice, totalPrice, paidAmount, dueAmount: round2(totalPrice - paidAmount), totalWeightKg, paymentStatus, locationType, deliveryType, shippingBreakdown },
    };
};

// @route POST /api/admin/orders/manual/preview  (same body as create)
// -> { success, totals, lines, warnings }
export const previewManualOrder = async (req, res, next) => {
    try {
        const built = await buildOrder(req.body);
        if (!built.ok) return res.status(built.status).json({ success: false, message: built.message });
        res.status(200).json({ success: true, totals: built.totals, lines: built.lines, warnings: built.warnings });
    } catch (error) {
        next(error);
    }
};

// @route POST /api/admin/orders/manual
// body { customer:{name, phone, email?}, address:{district, upazila, addressLine1?, addressLine2?},
//        deliveryType?, courierBranch?, items:[{productId, options?, quantity, unitPrice?}],
//        discount?, shippingCharge?, payment:{method, paidAmount?, reference?},
//        status: Pending|Confirmed, note? }
// -> 201 { success, order, warnings }
export const createManualOrder = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        let created;
        let warnings = [];
        await session.withTransaction(async () => {
            const built = await buildOrder(req.body, { session });
            if (!built.ok) {
                const err = new Error(built.message);
                err.statusCode = built.status;
                throw err;
            }
            warnings = built.warnings;
            const order = new Order(built.order);
            const note = typeof req.body.note === "string" ? req.body.note.trim().slice(0, 1000) : "";
            if (note) order.adminNotes.push({ note, addedBy: req.user._id });
            // pre-save adds "Pending / Order placed"; record who created it and the start status.
            await order.save({ session });
            order.statusHistory.push({
                status: order.orderStatus,
                note: `Phone order entered by admin${order.manualPayment?.paidAmount ? `, ${order.manualPayment.paidAmount} BDT received by ${order.manualPayment.method}` : ""}`,
                updatedBy: req.user._id,
                updatedAt: new Date(),
            });
            await order.save({ session });

            if (STOCK_HELD_STATUSES.includes(order.orderStatus)) {
                await updateProductStock(order.orderItems, "decrease", session, { order, by: req.user._id, note: "Phone order" });
            }
            created = order;
        });

        recordCustomerFromOrder(created);
        res.status(201).json({ success: true, order: created, warnings });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
        next(error);
    } finally {
        session.endSession();
    }
};
