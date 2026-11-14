// controllers/admin/stockController.js
// Stock page: levels per product/variant, admin adjustments, movement history.
import mongoose from "mongoose";
import { validationResult } from "express-validator";
import Product from "../../models/Product.js";
import StockMovement, { MOVEMENT_TYPES } from "../../models/StockMovement.js";
import { adjustStock as adjust } from "../../services/stockLedger.js";
import { escapeRegex } from "../../utils/escapeRegex.js";

const firstImage = (p) => {
    const groups = p.imageGroups || [];
    const main = groups.find((g) => g.name === "Main") || groups[0];
    return main?.images?.[0]?.url || "";
};

// Which adjustment reasons each mode may carry (order types are system only).
const MODE_TYPES = { in: ["purchase", "return", "other"], out: ["damage", "other"], set: ["correction"] };

// @route GET /api/admin/stock?search&category&status=all|low|out&page&limit
// -> { success, items, total, totalPages, currentPage, summary: { products, lowStock, outOfStock } }
// One row per product; variant products carry `variants: [{options, label, sku, stock, price}]`.
// Also used by the phone order form as its product picker, hence price fields.
export const getStock = async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const match = {};
        if (typeof req.query.search === "string" && req.query.search.trim()) {
            const rx = new RegExp(escapeRegex(req.query.search.trim()), "i");
            match.$or = [{ name: rx }, { sku: rx }, { "variants.sku": rx }];
        }
        if (typeof req.query.category === "string" && mongoose.Types.ObjectId.isValid(req.query.category)) {
            const id = new mongoose.Types.ObjectId(req.query.category);
            match.$and = [{ $or: [{ category: id }, { subCategory: id }] }];
        }
        if (req.query.active === "true") match.isActive = true;

        // Effective stock = sum of variant stock for variant products. Low/out is
        // judged on that number against the product's own lowStockAlert, same as
        // the dashboard's low-stock widget.
        const effective = {
            $cond: [{ $eq: ["$hasVariants", true] }, { $sum: "$variants.stock" }, { $ifNull: ["$stock", 0] }],
        };
        const status = req.query.status;
        const statusMatch =
            status === "out"
                ? { effectiveStock: { $lte: 0 } }
                : status === "low"
                  ? { $expr: { $and: [{ $gt: ["$effectiveStock", 0] }, { $lte: ["$effectiveStock", { $ifNull: ["$lowStockAlert", 5] }] }] } }
                  : null;

        const pipeline = [
            { $match: match },
            { $addFields: { effectiveStock: effective } },
            ...(statusMatch ? [{ $match: statusMatch }] : []),
            {
                $facet: {
                    rows: [
                        { $sort: { effectiveStock: 1, name: 1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                        {
                            $project: {
                                name: 1, slug: 1, sku: 1, stock: 1, lowStockAlert: 1,
                                hasVariants: 1, variants: 1,
                                price: 1, basePrice: 1, isActive: 1, imageGroups: 1, effectiveStock: 1,
                            },
                        },
                    ],
                    total: [{ $count: "n" }],
                },
            },
        ];

        const [[agg], summaryAgg] = await Promise.all([
            Product.aggregate(pipeline),
            Product.aggregate([
                { $addFields: { effectiveStock: effective } },
                {
                    $group: {
                        _id: null,
                        products: { $sum: 1 },
                        outOfStock: { $sum: { $cond: [{ $lte: ["$effectiveStock", 0] }, 1, 0] } },
                        lowStock: {
                            $sum: {
                                $cond: [
                                    { $and: [{ $gt: ["$effectiveStock", 0] }, { $lte: ["$effectiveStock", { $ifNull: ["$lowStockAlert", 5] }] }] },
                                    1,
                                    0,
                                ],
                            },
                        },
                    },
                },
            ]),
        ]);

        const items = (agg?.rows || []).map((p) => ({
            _id: p._id,
            name: p.name,
            slug: p.slug,
            sku: p.sku,
            unit: "pcs",
            image: firstImage(p),
            isActive: p.isActive,
            price: p.price || p.basePrice || 0,
            lowStockAlert: p.lowStockAlert ?? 5,
            hasVariants: Boolean(p.hasVariants),
            stock: p.hasVariants ? p.effectiveStock : p.stock || 0,
            variants: p.hasVariants
                ? (p.variants || []).map((v) => ({
                      options: (v.options || []).map(({ name, value }) => ({ name, value })),
                      label: (v.options || []).map((o) => o.value).join(" / "),
                      sku: v.sku,
                      stock: v.stock || 0,
                      price: v.price || 0,
                  }))
                : [],
        }));
        const total = agg?.total?.[0]?.n || 0;

        res.status(200).json({
            success: true,
            items,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            summary: summaryAgg[0] ? { products: summaryAgg[0].products, lowStock: summaryAgg[0].lowStock, outOfStock: summaryAgg[0].outOfStock } : { products: 0, lowStock: 0, outOfStock: 0 },
        });
    } catch (error) {
        next(error);
    }
};

// @route POST /api/admin/stock/adjust
// body { productId, options?: [{name,value}], mode: in|out|set, quantity, type, note? }
// -> { success, before, after, movement }
export const adjustStock = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
        }
        const { productId, options, mode, quantity, note } = req.body;
        const type = req.body.type || MODE_TYPES[mode]?.[0];
        if (!MODE_TYPES[mode]?.includes(type)) {
            return res.status(400).json({ success: false, message: "That reason does not fit this kind of change" });
        }
        const result = await adjust({
            productId,
            options: Array.isArray(options) ? options.map((o) => ({ name: String(o.name), value: String(o.value) })) : [],
            mode,
            quantity,
            type,
            note: typeof note === "string" ? note.trim().slice(0, 500) : undefined,
            by: req.user._id,
        });
        if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
        res.status(200).json({ success: true, before: result.before, after: result.after, movement: result.movement });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/admin/stock/movements?product&type&from&to&page&limit
// -> { success, movements, total, totalPages, currentPage }
export const getMovements = async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 30));
        const filter = {};
        if (mongoose.Types.ObjectId.isValid(req.query.product)) filter.product = req.query.product;
        if (MOVEMENT_TYPES.includes(req.query.type)) filter.type = req.query.type;
        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;
        if ((from && !isNaN(from)) || (to && !isNaN(to))) {
            filter.createdAt = {};
            if (from && !isNaN(from)) filter.createdAt.$gte = from;
            if (to && !isNaN(to)) filter.createdAt.$lte = to;
        }

        const [movements, total] = await Promise.all([
            StockMovement.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .populate("by", "name")
                .lean(),
            StockMovement.countDocuments(filter),
        ]);
        res.status(200).json({ success: true, movements, total, totalPages: Math.ceil(total / limit), currentPage: page });
    } catch (error) {
        next(error);
    }
};
