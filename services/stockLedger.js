// services/stockLedger.js
// Writes StockMovement rows and does admin stock adjustments.
// Order-driven changes go through orderController.updateProductStock, which
// calls recordMovements; admin changes go through adjustStock below. Both
// update stock with a single atomic Mongo operation and read the value it
// replaced, so `before`/`after` are exact even with concurrent orders.
import Product from "../models/Product.js";
import StockMovement from "../models/StockMovement.js";
import { findVariantByOptions } from "./lineItemPricing.js";

const label = (options = []) => options.map((o) => o.value).join(" / ");

/** Best effort: a ledger write must never undo a stock change that already happened. */
export const recordMovements = async (rows, session = null) => {
    if (!rows.length) return;
    try {
        await StockMovement.insertMany(rows, session ? { session } : {});
    } catch (e) {
        console.error("Stock ledger write failed:", e.message);
    }
};

export const movementLabel = label;

/**
 * Admin adjustment.
 *  mode "in"  : add quantity (purchase / return)
 *  mode "out" : remove quantity, refused if it would go below 0 (damage)
 *  mode "set" : set to the counted value (correction)
 * @returns {Promise<{ok:true, before, after, movement} | {ok:false, status, message}>}
 */
export const adjustStock = async ({ productId, options = [], mode, quantity, type, note, by }) => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0 || (mode !== "set" && qty === 0) || !Number.isInteger(qty)) {
        return { ok: false, status: 400, message: "Quantity must be a whole number above 0" };
    }

    const product = await Product.findById(productId).select("name unit hasVariants variants stock").lean();
    if (!product) return { ok: false, status: 404, message: "Product not found" };

    let path = "stock";
    let variant = null;
    if (product.hasVariants) {
        variant = findVariantByOptions(product, options);
        if (!variant) return { ok: false, status: 400, message: "Choose a valid variant" };
        // Index from the options match; the atomic update below re-checks that
        // the same variant still sits at that index, so a concurrent variant
        // edit cannot make us write into the wrong slot.
        const idx = product.variants.findIndex((v) => v === variant);
        path = `variants.${idx}.stock`;
    }

    const filter = { _id: product._id };
    if (variant) {
        const idx = path.split(".")[1];
        filter[`variants.${idx}.options`] = { $size: variant.options.length };
        variant.options.forEach((o, i) => {
            filter[`variants.${idx}.options.${i}.name`] = o.name;
            filter[`variants.${idx}.options.${i}.value`] = o.value;
        });
    }

    let update;
    if (mode === "in") update = { $inc: { [path]: qty } };
    else if (mode === "out") {
        filter[path] = { $gte: qty };
        update = { $inc: { [path]: -qty } };
    } else if (mode === "set") update = { $set: { [path]: qty } };
    else return { ok: false, status: 400, message: "Invalid mode" };

    // new:false returns the document before the change = exact "before" value.
    const prev = await Product.findOneAndUpdate(filter, update, { new: false, projection: { stock: 1, variants: 1 } }).lean();
    if (!prev) {
        return mode === "out"
            ? { ok: false, status: 409, message: "Not enough stock to remove that much" }
            : { ok: false, status: 409, message: "The product changed while saving. Reload and try again." };
    }
    const before = variant ? prev.variants[Number(path.split(".")[1])].stock || 0 : prev.stock || 0;
    const after = mode === "in" ? before + qty : mode === "out" ? before - qty : qty;

    const movement = await StockMovement.create({
        product: product._id,
        productName: product.name,
        variantOptions: variant ? variant.options.map(({ name, value }) => ({ name, value })) : [],
        variantLabel: variant ? label(variant.options) : "",
        type,
        change: after - before,
        before,
        after,
        unit: product.unit,
        note,
        by,
    });
    return { ok: true, before, after, movement };
};

const optKey = (options = []) =>
    options
        .map((o) => `${String(o.name).trim().toLowerCase()}=${String(o.value).trim().toLowerCase()}`)
        .sort()
        .join("|");

/**
 * The product form writes stock as an absolute number. Record the difference
 * as a "correction" so the ledger still adds up. Variants are matched by their
 * options; a variant that appears or disappears counts from/to 0.
 */
export const recordProductEditDiff = async (before, after, by, note = "Edited in the product form") => {
    if (!before || !after) return;
    const rows = [];
    const base = { product: after._id, productName: after.name, type: "correction", unit: after.unit, by, note };
    if (after.hasVariants || before.hasVariants) {
        const old = new Map((before.hasVariants ? before.variants || [] : []).map((v) => [optKey(v.options), v.stock || 0]));
        const seen = new Set();
        for (const v of after.hasVariants ? after.variants || [] : []) {
            const k = optKey(v.options);
            seen.add(k);
            const b = old.get(k) ?? 0;
            const a = v.stock || 0;
            if (a !== b) {
                const options = v.options.map(({ name, value }) => ({ name, value }));
                rows.push({ ...base, variantOptions: options, variantLabel: label(options), change: a - b, before: b, after: a });
            }
        }
        for (const v of before.hasVariants ? before.variants || [] : []) {
            const k = optKey(v.options);
            if (!seen.has(k) && (v.stock || 0) !== 0) {
                const options = v.options.map(({ name, value }) => ({ name, value }));
                rows.push({ ...base, variantOptions: options, variantLabel: label(options), change: -(v.stock || 0), before: v.stock || 0, after: 0, note: "Variant removed in the product form" });
            }
        }
    } else if ((before.stock || 0) !== (after.stock || 0)) {
        rows.push({ ...base, change: (after.stock || 0) - (before.stock || 0), before: before.stock || 0, after: after.stock || 0 });
    }
    await recordMovements(rows);
};
