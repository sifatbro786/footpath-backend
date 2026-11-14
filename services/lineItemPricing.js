// services/lineItemPricing.js
//
// THE server-side line pricer. Every place that turns "product + options +
// quantity" into money goes through here: checkout preview and order creation.
//
// WHY this exists: the old build priced guest orders from guestItems[].price,
// i.e. from localStorage, which anyone can edit (a guest could order anything
// for 1 BDT). The checkout preview did the same for every guest. Prices, stock
// and orderability are now resolved from the live Product document only.
//
// Client builds on this base add their own rules here (wholesale tiers,
// pre-booking, hidden prices: see the Aamkahon project), so keep it the only
// pricer.
import Product from "../models/Product.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Variant identity is the options array (variants are { _id: false }).
 * Same rule as orderController.updateProductStock, which decrements stock:
 * equal length and every {name, value} pair present. Keep the two identical,
 * a mismatch silently skips the stock decrement. (Equal length matters: with
 * `every()` alone an empty options array matched any variant.)
 */
export const findVariantByOptions = (product, options) => {
    if (!product?.hasVariants || !Array.isArray(options) || options.length === 0) return null;
    return (
        product.variants.find(
            (v) =>
                v.options.length === options.length &&
                options.every((o) =>
                    v.options.some((vo) => vo.name === o.name && vo.value === o.value),
                ),
        ) || null
    );
};

/** Unit price: variant.price / product.price, already campaign-aware (Product pre-save hook). */
export const unitPriceFor = (product, variant) => {
    const raw = variant && variant.price > 0 ? variant.price : product.price;
    return round2(Number(raw > 0 ? raw : product.basePrice) || 0);
};

/** Error string when the line cannot be bought, else null. */
export const orderabilityError = (product, variant, quantity, { stockCheck = true } = {}) => {
    if (!product || product.isActive === false) return "This product is no longer available";
    if (stockCheck) {
        const stock = variant ? variant.stock : product.stock;
        if (typeof stock === "number" && quantity > stock) {
            return stock > 0 ? `Only ${stock} of ${product.name} left in stock` : `${product.name} is out of stock`;
        }
    }
    return null;
};

const imageFor = (product, variant) => {
    const groups = product.imageGroups || [];
    if (variant?.imageGroupName) {
        const g = groups.find((x) => x.name === variant.imageGroupName);
        if (g?.images?.length) return g.images[0].url;
    }
    const main = groups.find((g) => g.name === "Main") || groups[0];
    return main?.images?.[0]?.url || "";
};

const PRICING_FIELDS =
    "name slug price basePrice stock isActive hasVariants variants imageGroups category weight codAllowed";

/**
 * Price a list of raw lines.
 * @param {Array<{productId?, product?, variant?: {options}, options?, quantity}>} rawItems
 * @returns {Promise<{ok:false,status,message,errors} | {ok:true, lines, itemsSubtotal, totalWeightKg, codAvailable}>}
 */
export const priceLines = async (rawItems, { session = null, stockCheck = true } = {}) => {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return { ok: false, status: 400, message: "No items to price", errors: [] };
    }

    const normalized = rawItems.map((it) => {
        const productRef = it.product && typeof it.product === "object" ? it.product._id : it.product;
        return {
            productId: String(it.productId || productRef || ""),
            options: it.variant?.options || it.options || [],
            quantity: parseInt(it.quantity, 10),
        };
    });

    const ids = [...new Set(normalized.map((n) => n.productId).filter((id) => /^[a-f\d]{24}$/i.test(id)))];
    const products = await Product.find({ _id: { $in: ids } })
        .select(PRICING_FIELDS)
        .session(session)
        .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const errors = [];
    const lines = [];
    for (const n of normalized) {
        const product = byId.get(n.productId);
        if (!product) {
            errors.push("A product in your cart no longer exists");
            continue;
        }
        if (!Number.isFinite(n.quantity) || n.quantity < 1) {
            errors.push(`Invalid quantity for ${product.name}`);
            continue;
        }
        let variant = null;
        if (product.hasVariants) {
            variant = findVariantByOptions(product, n.options);
            if (!variant) {
                errors.push(`Please choose a valid option for ${product.name}`);
                continue;
            }
        }
        const err = orderabilityError(product, variant, n.quantity, { stockCheck });
        if (err) {
            errors.push(err);
            continue;
        }

        const price = unitPriceFor(product, variant);
        const unitWeight = variant?.weight > 0 ? variant.weight : Number(product.weight) || 0;
        const displayName = variant ? variant.options.map((o) => o.value).join(" / ") : "";
        lines.push({
            product: product._id,
            name: displayName ? `${product.name} (${displayName})` : product.name,
            variant: variant
                ? { options: variant.options.map(({ name, value }) => ({ name, value })), displayName, sku: variant.sku }
                : undefined,
            quantity: n.quantity,
            price,
            retailPrice: price,
            lineTotal: round2(price * n.quantity),
            weightKg: round2(unitWeight * n.quantity),
            image: imageFor(product, variant),
            category: product.category,
            codAllowed: product.codAllowed !== false,
        });
    }

    if (errors.length) return { ok: false, status: 400, message: errors[0], errors };

    return {
        ok: true,
        lines,
        itemsSubtotal: round2(lines.reduce((a, l) => a + l.lineTotal, 0)),
        totalWeightKg: round2(lines.reduce((a, l) => a + l.weightKg, 0)),
        // COD needs every line to allow it (Product.codAllowed).
        codAvailable: lines.every((l) => l.codAllowed),
    };
};
