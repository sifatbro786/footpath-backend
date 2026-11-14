// controllers/admin/customerController.js
// Admin customer / lead book: list, manual add, edit, delete, CSV import, CSV export.
import crypto from "crypto";
import mongoose from "mongoose";
import { validationResult } from "express-validator";
import Customer, { CUSTOMER_SOURCES } from "../../models/Customer.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { normalizeBdPhone } from "../../utils/phone.js";

const MAX_IMPORT_ROWS = 2000; // per request; the admin UI sends chunks of 1000
const EDITABLE = ["name", "email", "district", "address", "note", "marketingOptIn"];

const badRequest = (res, errors) =>
    res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });

const cleanTags = (tags) => {
    const list = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(/[,;|]/) : [];
    return [...new Set(list.map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
};

const str = (v, max) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : undefined) || undefined;

const buildFilter = (q) => {
    const filter = {};
    if (typeof q.search === "string" && q.search.trim()) {
        const term = q.search.trim();
        const rx = new RegExp(escapeRegex(term), "i");
        const phone = normalizeBdPhone(term);
        filter.$or = [{ name: rx }, { phone: phone ? phone : rx }, { email: rx }, { district: rx }];
    }
    if (typeof q.tag === "string" && q.tag) filter.tags = q.tag.toLowerCase();
    if (CUSTOMER_SOURCES.includes(q.source)) filter.source = q.source;
    if (typeof q.district === "string" && q.district) filter.district = q.district;
    if (q.optIn === "true") filter.marketingOptIn = true;
    if (q.optIn === "false") filter.marketingOptIn = false;
    return filter;
};

const SORTS = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    name: { name: 1 },
    lastOrder: { lastOrderAt: -1, createdAt: -1 },
    orders: { ordersPlaced: -1, createdAt: -1 },
};

// @route GET /api/admin/customers?search&tag&source&district&optIn&sort&page&limit
// -> { success, customers, total, totalPages, currentPage, tags, sourceCounts }
export const getCustomers = async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const filter = buildFilter(req.query);
        const sort = SORTS[req.query.sort] || SORTS.newest;

        const [customers, total, tags, sources] = await Promise.all([
            Customer.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
            Customer.countDocuments(filter),
            Customer.distinct("tags"),
            Customer.aggregate([{ $group: { _id: "$source", count: { $sum: 1 } } }]),
        ]);

        res.status(200).json({
            success: true,
            customers,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            tags: tags.sort(),
            sourceCounts: Object.fromEntries(sources.map((s) => [s._id, s.count])),
        });
    } catch (error) {
        next(error);
    }
};

// @route POST /api/admin/customers  { name?, phone, email?, district?, address?, tags?, note?, marketingOptIn? }
// -> 201 { success, customer }
export const createCustomer = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return badRequest(res, errors);

        const phone = normalizeBdPhone(req.body.phone);
        if (!phone) return res.status(400).json({ success: false, message: "Enter a valid Bangladesh mobile number" });

        const existing = await Customer.findOne({ phone }).lean();
        if (existing) {
            return res.status(409).json({ success: false, message: "This number is already in the customer list", customer: existing });
        }

        const doc = { phone, source: "manual", tags: cleanTags(req.body.tags) };
        for (const k of EDITABLE) if (req.body[k] !== undefined) doc[k] = req.body[k];
        const customer = await Customer.create(doc);
        res.status(201).json({ success: true, customer });
    } catch (error) {
        next(error);
    }
};

// @route PATCH /api/admin/customers/:id  (same fields; phone may change) -> { success, customer }
export const updateCustomer = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return badRequest(res, errors);
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid customer id" });
        }
        const customer = await Customer.findById(req.params.id);
        if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

        if (req.body.phone !== undefined) {
            const phone = normalizeBdPhone(req.body.phone);
            if (!phone) return res.status(400).json({ success: false, message: "Enter a valid Bangladesh mobile number" });
            if (phone !== customer.phone && (await Customer.exists({ phone }))) {
                return res.status(409).json({ success: false, message: "Another customer already has this number" });
            }
            customer.phone = phone;
        }
        for (const k of EDITABLE) if (req.body[k] !== undefined) customer[k] = req.body[k];
        if (req.body.tags !== undefined) customer.tags = cleanTags(req.body.tags);

        await customer.save();
        res.status(200).json({ success: true, customer });
    } catch (error) {
        next(error);
    }
};

// @route DELETE /api/admin/customers/:id
export const deleteCustomer = async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Invalid customer id" });
        }
        const deleted = await Customer.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ success: false, message: "Customer not found" });
        res.status(200).json({ success: true, message: "Customer deleted" });
    } catch (error) {
        next(error);
    }
};

// @route POST /api/admin/customers/import
// body { rows: [{ name?, phone, email?, district?, address?, tags? }], tags?: [], mode?: "skip"|"update", batch? }
// The browser parses the CSV and maps columns; the server re-validates every row.
// "skip"   = existing numbers are left alone (only new tags are added).
// "update" = existing numbers get the non-empty name/district/email/address from the file.
// -> { success, batch, received, inserted, updated, unchanged, invalid, duplicatesInFile, errors: [{ row, phone, reason }] }
export const importCustomers = async (req, res, next) => {
    try {
        const { rows, mode = "skip" } = req.body;
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, message: "No rows to import" });
        }
        if (rows.length > MAX_IMPORT_ROWS) {
            return res.status(400).json({ success: false, message: `Send at most ${MAX_IMPORT_ROWS} rows per request` });
        }
        const batchTags = cleanTags(req.body.tags);
        const batch = str(req.body.batch, 80) || `import-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`;

        const errors = [];
        const seen = new Set();
        let duplicatesInFile = 0;
        const ops = [];

        rows.forEach((r, i) => {
            const rowNo = Number.isInteger(r?.rowNumber) ? r.rowNumber : i + 1;
            const phone = normalizeBdPhone(r?.phone);
            if (!phone) {
                if (errors.length < 300) errors.push({ row: rowNo, phone: str(r?.phone, 30) || "", reason: "Not a valid BD mobile number" });
                return;
            }
            if (seen.has(phone)) {
                duplicatesInFile += 1;
                return;
            }
            seen.add(phone);

            const fields = {
                name: str(r.name, 120),
                email: str(r.email, 160)?.toLowerCase(),
                district: str(r.district, 80),
                address: str(r.address, 300),
            };
            const present = Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
            const tags = [...new Set([...batchTags, ...cleanTags(r.tags)])];

            // A field cannot sit in both $set and $setOnInsert, so "update"
            // mode sets the file values for new and old rows alike.
            const update =
                mode === "update"
                    ? { $set: present, $setOnInsert: { phone, source: "import", importBatch: batch } }
                    : { $setOnInsert: { phone, source: "import", importBatch: batch, ...present } };
            if (tags.length) update.$addToSet = { tags: { $each: tags } };
            if (update.$set && !Object.keys(update.$set).length) delete update.$set;

            ops.push({ updateOne: { filter: { phone }, update, upsert: true } });
        });

        let inserted = 0;
        let updated = 0;
        let unchanged = 0;
        if (ops.length) {
            // ordered:false keeps going past a single bad row (e.g. a race on the unique index).
            const result = await Customer.bulkWrite(ops, { ordered: false });
            inserted = result.upsertedCount || 0;
            updated = result.modifiedCount || 0;
            unchanged = Math.max(0, (result.matchedCount || 0) - updated);
        }

        res.status(200).json({
            success: true,
            batch,
            received: rows.length,
            inserted,
            updated,
            unchanged,
            invalid: rows.length - seen.size - duplicatesInFile,
            duplicatesInFile,
            errors,
        });
    } catch (error) {
        next(error);
    }
};

// Spreadsheet apps execute cells starting with = + - @ (CSV injection).
// Prefixing a quote keeps names like "=HYPERLINK(...)" inert.
const csvCell = (v) => {
    let s = v === undefined || v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// @route GET /api/admin/customers/export?<same filters as list>  -> text/csv
// Opted-out numbers are excluded unless optIn=all, so a promo list never
// reaches people who asked to stop.
export const exportCustomers = async (req, res, next) => {
    try {
        const filter = buildFilter(req.query);
        if (req.query.optIn === undefined) filter.marketingOptIn = true;

        const head = ["name", "phone", "email", "district", "address", "tags", "source", "orders_placed", "last_order", "added"];
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`);
        // BOM so Excel opens Bangla names as UTF-8.
        res.write(`﻿${head.join(",")}\n`);

        const cursor = Customer.find(filter).sort({ createdAt: -1 }).lean().cursor();
        for await (const c of cursor) {
            res.write(
                `${[
                    c.name,
                    c.phone,
                    c.email,
                    c.district,
                    c.address,
                    (c.tags || []).join("; "),
                    c.source,
                    c.ordersPlaced || 0,
                    c.lastOrderAt ? new Date(c.lastOrderAt).toISOString().slice(0, 10) : "",
                    new Date(c.createdAt).toISOString().slice(0, 10),
                ]
                    .map(csvCell)
                    .join(",")}\n`,
            );
        }
        res.end();
    } catch (error) {
        if (res.headersSent) return res.end();
        next(error);
    }
};
