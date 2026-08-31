// scripts/seedProducts.js
//
// Seeds a stationery catalogue: 15 products across the categories and
// subcategories created by seedStorefront.js.
//
//   node scripts/seedStorefront.js     # run this FIRST, it creates categories
//   node scripts/seedProducts.js       # then this
//   node scripts/seedProducts.js --reset   # delete seeded products, then recreate
//
// IDEMPOTENT: products are matched on `sku`, so re-running updates in place
// rather than creating duplicates. --reset removes only products carrying a
// seed SKU prefix, never anything you added by hand in the admin panel.
//
// Photography comes from scripts/seedImages.js — read the header there before
// changing any image. It is development imagery and must be replaced with real
// product shots before launch.
//
// Prices are in BDT and roughly realistic for Dhaka retail.

import mongoose from "mongoose";
import dotenv from "dotenv";

import Product from "../models/Product.js";
import Category from "../models/Category.js";
import { photo } from "./seedImages.js";

dotenv.config();

const RESET = process.argv.includes("--reset");
const SKU_PREFIX = "ELM-";

/**
 * Two DIFFERENT photos per gallery, so the card hover swap and the PDP gallery
 * both have something real to show, and one dead link cannot blank a product.
 *
 * `photo()` throws on an unknown key, so a typo fails the seed loudly instead
 * of writing an undefined url into Mongo.
 */
const shots = (keys, alt) =>
    keys.map((key, index) => ({
        url: photo(key),
        alt: index === 0 ? alt : `${alt}, view ${index + 1}`,
    }));

// ─── Variants ────────────────────────────────────────────────────────────────
//
// EVERY product here has variants, deliberately: the storefront's variant
// matrix, the option-matching stock deduction and the "which image group does
// this option show" wiring are all code paths that only run when a product has
// them, and a catalogue of plain products left all three untested.
//
// ⚠️ Two rules the Product model enforces, and one it does not.
//
//   1. `variantSchema` is `{ _id: false }`. A variant is identified ONLY by its
//      `options: [{name, value}]` pairs. orderController.updateProductStock
//      matches an order line back to a variant by comparing those pairs, and a
//      mismatch does NOT throw — it logs a warning and leaves stock alone. So
//      the option names and values below must match `variantOptions` exactly,
//      character for character. "0.5mm" and "0.5 mm" are different variants.
//
//   2. A variant with no discount of its own inherits the product's
//      discountType/discountValue in the pre-save hook, and `price` is computed
//      there for the product and every variant. Never set `price` here.
//
//   3. Not enforced anywhere: `imageGroupName` is a free string. If it does not
//      match an `imageGroups[].name` the storefront just falls back to the
//      first group, silently. Both are spelled out below rather than shared
//      through a constant, because that is how the admin panel writes them too.
//
// Parent `stock` is left at 0 throughout: it is not read for a product that has
// variants, and giving it a plausible-looking number invites someone to trust it.

/**
 * Build the cartesian product of one or two option axes.
 *
 * Written out rather than using Product.generateAllVariants, because that
 * static gives every combination the same price and stock, and the useful thing
 * about seed data is that the numbers differ: something low, something out of
 * stock, something priced above its siblings.
 */
const variant = (options, { price, stock, sku, imageGroupName }) => ({
    options,
    basePrice: price,
    stock,
    sku,
    ...(imageGroupName ? { imageGroupName } : {}),
});

/**
 * category  = parent slug, subCategory = child slug. Both are resolved to ids
 * before saving; a product whose category is missing is skipped with a warning
 * rather than failing the whole run.
 */
const PRODUCTS = [
    // ── Notebooks & Journals ────────────────────────────────────────────
    {
        sku: "ELM-NB-001",
        name: "Leuchtturm1917 Hardcover Notebook",
        brand: "Leuchtturm1917",
        category: "notebooks-and-journals",
        subCategory: "hardcover-notebooks",
        description:
            "Hardbound, with numbered pages, a blank index and two ribbon markers. The 80gsm paper takes fountain ink without feathering or bleed.",
        bulletPoints: ["80gsm ink proof paper", "Numbered pages", "Two ribbon markers", "Expandable back pocket"],
        basePrice: 2450,
        discountType: "percentage",
        discountValue: 12,
        stock: 0,
        lowStockAlert: 5,
        weight: 250,
        dimensions: { length: 21, width: 14.8, height: 1.6 },
        attributes: [
            { key: "Paper", value: "80gsm" },
            { key: "Binding", value: "Hardcover, thread bound" },
        ],
        isFeatured: true,
        hasVariants: true,
        variantOptions: [
            { name: "Ruling", values: ["Dotted", "Ruled", "Plain"] },
            { name: "Size", values: ["A5", "A6"] },
        ],
        variants: [
            variant([{ name: "Ruling", value: "Dotted" }, { name: "Size", value: "A5" }], { price: 2450, stock: 9, sku: "ELM-NB-001-A5D" }),
            variant([{ name: "Ruling", value: "Ruled" }, { name: "Size", value: "A5" }], { price: 2450, stock: 7, sku: "ELM-NB-001-A5R" }),
            variant([{ name: "Ruling", value: "Plain" }, { name: "Size", value: "A5" }], { price: 2450, stock: 4, sku: "ELM-NB-001-A5P" }),
            variant([{ name: "Ruling", value: "Dotted" }, { name: "Size", value: "A6" }], { price: 2050, stock: 6, sku: "ELM-NB-001-A6D" }),
            variant([{ name: "Ruling", value: "Ruled" }, { name: "Size", value: "A6" }], { price: 2050, stock: 3, sku: "ELM-NB-001-A6R" }),
            // Out of stock on purpose: the PDP has to disable exactly one cell.
            variant([{ name: "Ruling", value: "Plain" }, { name: "Size", value: "A6" }], { price: 2050, stock: 0, sku: "ELM-NB-001-A6P" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["leuchtturmA", "leuchtturmB"], "Leuchtturm1917 hardcover notebook") },
        ],
    },
    {
        sku: "ELM-NB-002",
        name: "Moleskine Classic Ruled Notebook",
        brand: "Moleskine",
        category: "notebooks-and-journals",
        subCategory: "hardcover-notebooks",
        description:
            "The notebook that started the revival. Rounded corners, elastic closure and an expandable pocket inside the back cover.",
        bulletPoints: ["Elastic closure", "Acid free paper", "Rounded corners"],
        basePrice: 1890,
        stock: 0,
        weight: 220,
        dimensions: { length: 21, width: 13, height: 1.5 },
        attributes: [
            { key: "Paper", value: "70gsm" },
            { key: "Ruling", value: "Ruled" },
        ],
        hasVariants: true,
        variantOptions: [
            { name: "Size", values: ["Pocket", "Large"] },
            { name: "Cover", values: ["Hard", "Soft"] },
        ],
        variants: [
            variant([{ name: "Size", value: "Pocket" }, { name: "Cover", value: "Hard" }], { price: 1690, stock: 12, sku: "ELM-NB-002-PH" }),
            variant([{ name: "Size", value: "Pocket" }, { name: "Cover", value: "Soft" }], { price: 1590, stock: 8, sku: "ELM-NB-002-PS" }),
            variant([{ name: "Size", value: "Large" }, { name: "Cover", value: "Hard" }], { price: 1890, stock: 6, sku: "ELM-NB-002-LH" }),
            variant([{ name: "Size", value: "Large" }, { name: "Cover", value: "Soft" }], { price: 1790, stock: 5, sku: "ELM-NB-002-LS" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["moleskineA", "moleskineB"], "Moleskine classic ruled notebook") },
        ],
    },
    {
        sku: "ELM-NB-003",
        name: "Field Notes Pocket Memo Books, Three Pack",
        brand: "Field Notes",
        category: "notebooks-and-journals",
        subCategory: "softcover-and-pocket",
        description:
            "Three staple bound memo books that live in a back pocket. 48 pages each, in the ruling of your choice.",
        bulletPoints: ["Three books per pack", "48 pages each", "Fits a shirt pocket"],
        basePrice: 890,
        discountType: "percentage",
        discountValue: 10,
        stock: 0,
        weight: 90,
        dimensions: { length: 14, width: 8.9, height: 1 },
        attributes: [{ key: "Pack size", value: "3" }],
        hasVariants: true,
        variantOptions: [{ name: "Ruling", values: ["Graph", "Ruled", "Plain"] }],
        variants: [
            variant([{ name: "Ruling", value: "Graph" }], { price: 890, stock: 16, sku: "ELM-NB-003-G" }),
            variant([{ name: "Ruling", value: "Ruled" }], { price: 890, stock: 14, sku: "ELM-NB-003-R" }),
            variant([{ name: "Ruling", value: "Plain" }], { price: 890, stock: 10, sku: "ELM-NB-003-P" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["fieldNotesA", "fieldNotesB"], "Field Notes pocket memo books") },
        ],
    },
    {
        sku: "ELM-NB-004",
        name: "Strathmore Hardbound Sketchbook",
        brand: "Strathmore",
        category: "notebooks-and-journals",
        subCategory: "sketchbooks",
        description:
            "Heavyweight 190gsm cartridge paper with a light tooth, bound flat so it opens without fighting you.",
        bulletPoints: ["190gsm cartridge paper", "Lies flat when open", "96 sheets"],
        basePrice: 2100,
        stock: 0,
        lowStockAlert: 4,
        weight: 620,
        dimensions: { length: 29.7, width: 21, height: 2 },
        attributes: [
            { key: "Paper", value: "190gsm" },
            { key: "Sheets", value: "96" },
        ],
        hasVariants: true,
        variantOptions: [{ name: "Size", values: ["A5", "A4", "A3"] }],
        variants: [
            variant([{ name: "Size", value: "A5" }], { price: 1500, stock: 8, sku: "ELM-NB-004-A5" }),
            variant([{ name: "Size", value: "A4" }], { price: 2100, stock: 5, sku: "ELM-NB-004-A4" }),
            variant([{ name: "Size", value: "A3" }], { price: 2900, stock: 2, sku: "ELM-NB-004-A3" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["sketchbookA", "sketchbookB"], "Strathmore hardbound sketchbook") },
        ],
    },
    {
        sku: "ELM-NB-005",
        name: "Rhodia Webnotebook A5",
        brand: "Rhodia",
        category: "notebooks-and-journals",
        subCategory: "hardcover-notebooks",
        description:
            "Italian leatherette cover over 90gsm Clairefontaine paper, the smoothest surface a fountain pen will meet.",
        bulletPoints: ["90gsm Clairefontaine paper", "Leatherette cover", "Ribbon marker"],
        basePrice: 2950,
        stock: 0,
        lowStockAlert: 5,
        weight: 300,
        dimensions: { length: 21, width: 14.8, height: 1.7 },
        attributes: [{ key: "Paper", value: "90gsm" }],
        hasVariants: true,
        variantOptions: [
            { name: "Ruling", values: ["Dotted", "Lined"] },
            { name: "Cover", values: ["Black", "Orange"] },
        ],
        // Deliberately the thinnest stock in the catalogue: this is the product
        // that exercises the low stock badge and the sold out state together.
        variants: [
            variant([{ name: "Ruling", value: "Dotted" }, { name: "Cover", value: "Black" }], { price: 2950, stock: 3, sku: "ELM-NB-005-DB" }),
            variant([{ name: "Ruling", value: "Dotted" }, { name: "Cover", value: "Orange" }], { price: 2950, stock: 2, sku: "ELM-NB-005-DO" }),
            variant([{ name: "Ruling", value: "Lined" }, { name: "Cover", value: "Black" }], { price: 2950, stock: 1, sku: "ELM-NB-005-LB" }),
            variant([{ name: "Ruling", value: "Lined" }, { name: "Cover", value: "Orange" }], { price: 2950, stock: 0, sku: "ELM-NB-005-LO" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["rhodiaA", "rhodiaB"], "Rhodia Webnotebook A5") },
        ],
    },

    // ── Writing Instruments ─────────────────────────────────────────────
    {
        sku: "ELM-PEN-001",
        name: "LAMY Safari Fountain Pen",
        brand: "LAMY",
        category: "writing-instruments",
        subCategory: "fountain-pens",
        description:
            "The workhorse starter fountain pen. Moulded grip, sprung steel clip and a nib that writes out of the box.",
        bulletPoints: ["Steel nib", "Moulded grip section", "Takes LAMY cartridges or a converter"],
        basePrice: 3200,
        stock: 0,
        weight: 17,
        dimensions: { length: 13.9, width: 1.3, height: 1.3 },
        attributes: [
            { key: "Nib material", value: "Steel" },
            { key: "Filling", value: "Cartridge or converter" },
        ],
        isFeatured: true,
        hasVariants: true,
        variantOptions: [
            { name: "Colour", values: ["Charcoal", "Red"] },
            { name: "Nib", values: ["Fine", "Medium"] },
        ],
        // The only product whose colour axis has its own photography, which is
        // why it is the only one setting imageGroupName.
        variants: [
            variant([{ name: "Colour", value: "Charcoal" }, { name: "Nib", value: "Fine" }], { price: 3200, stock: 8, sku: "ELM-PEN-001-CF", imageGroupName: "Charcoal" }),
            variant([{ name: "Colour", value: "Charcoal" }, { name: "Nib", value: "Medium" }], { price: 3200, stock: 5, sku: "ELM-PEN-001-CM", imageGroupName: "Charcoal" }),
            variant([{ name: "Colour", value: "Red" }, { name: "Nib", value: "Fine" }], { price: 3350, stock: 2, sku: "ELM-PEN-001-RF", imageGroupName: "Red" }),
            variant([{ name: "Colour", value: "Red" }, { name: "Nib", value: "Medium" }], { price: 3350, stock: 0, sku: "ELM-PEN-001-RM", imageGroupName: "Red" }),
        ],
        imageGroups: [
            { name: "Charcoal", images: shots(["lamyCharcoalA", "lamyCharcoalB"], "LAMY Safari in charcoal") },
            { name: "Red", images: shots(["lamyRedA", "lamyRedB"], "LAMY Safari in red") },
        ],
    },
    {
        sku: "ELM-PEN-002",
        name: "Pilot Metropolitan Fountain Pen",
        brand: "Pilot",
        category: "writing-instruments",
        subCategory: "fountain-pens",
        description:
            "Brass barrel, satisfying weight, and one of the most reliable steel nibs made at any price.",
        bulletPoints: ["Brass barrel", "Japanese steel nib", "Converter included"],
        basePrice: 2800,
        discountType: "fixed",
        discountValue: 300,
        stock: 0,
        weight: 27,
        dimensions: { length: 13.7, width: 1.1, height: 1.1 },
        attributes: [
            { key: "Nib material", value: "Steel" },
            { key: "Barrel", value: "Brass" },
        ],
        hasVariants: true,
        variantOptions: [{ name: "Nib", values: ["Fine", "Medium"] }],
        variants: [
            variant([{ name: "Nib", value: "Fine" }], { price: 2800, stock: 9, sku: "ELM-PEN-002-F" }),
            variant([{ name: "Nib", value: "Medium" }], { price: 2800, stock: 5, sku: "ELM-PEN-002-M" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["pilotMetroA", "pilotMetroB"], "Pilot Metropolitan fountain pen") },
        ],
    },
    {
        sku: "ELM-PEN-003",
        name: "BIC Cristal Ballpoint Pens, Twelve Pack",
        brand: "BIC",
        category: "writing-instruments",
        subCategory: "ballpoint-and-gel",
        description:
            "The pen everyone has borrowed and nobody has returned. Hexagonal barrel, 1.0mm medium point.",
        bulletPoints: ["Twelve pens per box", "1.0mm medium point", "Roughly 3km of writing each"],
        basePrice: 420,
        stock: 0,
        weight: 70,
        dimensions: { length: 17.5, width: 8, height: 2 },
        attributes: [
            { key: "Point size", value: "1.0mm" },
            { key: "Pack size", value: "12" },
        ],
        hasVariants: true,
        variantOptions: [{ name: "Ink colour", values: ["Blue", "Black", "Red"] }],
        variants: [
            variant([{ name: "Ink colour", value: "Blue" }], { price: 420, stock: 40, sku: "ELM-PEN-003-BLU" }),
            variant([{ name: "Ink colour", value: "Black" }], { price: 420, stock: 28, sku: "ELM-PEN-003-BLK" }),
            variant([{ name: "Ink colour", value: "Red" }], { price: 440, stock: 18, sku: "ELM-PEN-003-RED" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["bicA", "bicB"], "BIC Cristal ballpoint pens") },
        ],
    },
    {
        sku: "ELM-PEN-004",
        name: "Pilot G2 Gel Pens, Five Pack",
        brand: "Pilot",
        category: "writing-instruments",
        subCategory: "ballpoint-and-gel",
        description:
            "Smooth gel ink with a comfortable rubber grip. The default pen of every exam hall for a reason.",
        bulletPoints: ["Refillable", "Contoured rubber grip", "Five pens per pack"],
        basePrice: 780,
        discountType: "percentage",
        discountValue: 15,
        stock: 0,
        weight: 60,
        attributes: [{ key: "Pack size", value: "5" }],
        isFeatured: true,
        hasVariants: true,
        variantOptions: [
            { name: "Ink colour", values: ["Black", "Blue", "Assorted"] },
            { name: "Point size", values: ["0.5mm", "0.7mm"] },
        ],
        variants: [
            variant([{ name: "Ink colour", value: "Black" }, { name: "Point size", value: "0.5mm" }], { price: 780, stock: 22, sku: "ELM-PEN-004-BLK05" }),
            variant([{ name: "Ink colour", value: "Black" }, { name: "Point size", value: "0.7mm" }], { price: 780, stock: 18, sku: "ELM-PEN-004-BLK07" }),
            variant([{ name: "Ink colour", value: "Blue" }, { name: "Point size", value: "0.5mm" }], { price: 780, stock: 15, sku: "ELM-PEN-004-BLU05" }),
            variant([{ name: "Ink colour", value: "Blue" }, { name: "Point size", value: "0.7mm" }], { price: 780, stock: 12, sku: "ELM-PEN-004-BLU07" }),
            variant([{ name: "Ink colour", value: "Assorted" }, { name: "Point size", value: "0.5mm" }], { price: 860, stock: 7, sku: "ELM-PEN-004-AST05" }),
            variant([{ name: "Ink colour", value: "Assorted" }, { name: "Point size", value: "0.7mm" }], { price: 860, stock: 4, sku: "ELM-PEN-004-AST07" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["g2A", "g2B", "gelPens"], "Pilot G2 gel pens") },
        ],
    },
    {
        sku: "ELM-PEN-005",
        name: "Rotring 600 Mechanical Pencil",
        brand: "Rotring",
        category: "writing-instruments",
        subCategory: "pencils",
        description:
            "Full metal hexagonal body with a knurled grip and a fixed guidance sleeve. Built like a drafting tool because it is one.",
        bulletPoints: ["Solid brass body", "Knurled metal grip", "Fixed lead sleeve"],
        basePrice: 4200,
        stock: 0,
        lowStockAlert: 4,
        weight: 22,
        dimensions: { length: 14.5, width: 0.9, height: 0.9 },
        attributes: [{ key: "Body", value: "Brass" }],
        hasVariants: true,
        variantOptions: [
            { name: "Lead size", values: ["0.5mm", "0.7mm"] },
            { name: "Body", values: ["Silver", "Black"] },
        ],
        variants: [
            variant([{ name: "Lead size", value: "0.5mm" }, { name: "Body", value: "Silver" }], { price: 4200, stock: 3, sku: "ELM-PEN-005-05S" }),
            variant([{ name: "Lead size", value: "0.5mm" }, { name: "Body", value: "Black" }], { price: 4200, stock: 2, sku: "ELM-PEN-005-05B" }),
            variant([{ name: "Lead size", value: "0.7mm" }, { name: "Body", value: "Silver" }], { price: 4200, stock: 4, sku: "ELM-PEN-005-07S" }),
            variant([{ name: "Lead size", value: "0.7mm" }, { name: "Body", value: "Black" }], { price: 4200, stock: 0, sku: "ELM-PEN-005-07B" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["rotringA", "rotringB"], "Rotring 600 mechanical pencil") },
        ],
    },
    {
        sku: "ELM-PEN-006",
        name: "Blackwing Pencils, Box of Twelve",
        brand: "Blackwing",
        category: "writing-instruments",
        subCategory: "pencils",
        description:
            "Graphite with a replaceable flat eraser, in three grades. Half the pressure and twice the speed, as the box has always claimed.",
        bulletPoints: ["Replaceable eraser", "Twelve per box", "Three graphite grades"],
        basePrice: 2300,
        stock: 0,
        weight: 110,
        attributes: [{ key: "Pack size", value: "12" }],
        hasVariants: true,
        variantOptions: [{ name: "Grade", values: ["602 Firm", "Pearl Balanced", "Matte Soft"] }],
        variants: [
            variant([{ name: "Grade", value: "602 Firm" }], { price: 2300, stock: 9, sku: "ELM-PEN-006-602" }),
            variant([{ name: "Grade", value: "Pearl Balanced" }], { price: 2300, stock: 6, sku: "ELM-PEN-006-PRL" }),
            variant([{ name: "Grade", value: "Matte Soft" }], { price: 2200, stock: 4, sku: "ELM-PEN-006-MAT" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["blackwingA", "blackwingB", "pencilsGraphite"], "Blackwing pencils") },
        ],
    },
    {
        sku: "ELM-INK-001",
        name: "Pelikan 4001 Fountain Pen Ink",
        brand: "Pelikan",
        category: "writing-instruments",
        subCategory: "inks-and-refills",
        description:
            "A well behaved everyday ink that dries fast and stays put. Safe in any fountain pen.",
        bulletPoints: ["Glass bottle", "Fast drying", "Safe for all fountain pens"],
        basePrice: 1150,
        stock: 0,
        weight: 180,
        attributes: [{ key: "Type", value: "Dye based, non permanent" }],
        hasVariants: true,
        variantOptions: [
            { name: "Colour", values: ["Royal Blue", "Brilliant Black", "Brilliant Green"] },
            { name: "Volume", values: ["30ml", "62ml"] },
        ],
        variants: [
            variant([{ name: "Colour", value: "Royal Blue" }, { name: "Volume", value: "30ml" }], { price: 780, stock: 20, sku: "ELM-INK-001-RB30" }),
            variant([{ name: "Colour", value: "Royal Blue" }, { name: "Volume", value: "62ml" }], { price: 1150, stock: 14, sku: "ELM-INK-001-RB62" }),
            variant([{ name: "Colour", value: "Brilliant Black" }, { name: "Volume", value: "30ml" }], { price: 780, stock: 16, sku: "ELM-INK-001-BB30" }),
            variant([{ name: "Colour", value: "Brilliant Black" }, { name: "Volume", value: "62ml" }], { price: 1150, stock: 11, sku: "ELM-INK-001-BB62" }),
            variant([{ name: "Colour", value: "Brilliant Green" }, { name: "Volume", value: "30ml" }], { price: 780, stock: 6, sku: "ELM-INK-001-BG30" }),
            variant([{ name: "Colour", value: "Brilliant Green" }, { name: "Volume", value: "62ml" }], { price: 1150, stock: 3, sku: "ELM-INK-001-BG62" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["inkA", "inkB"], "Pelikan 4001 fountain pen ink") },
        ],
    },

    // ── Desk & Office ───────────────────────────────────────────────────
    {
        sku: "ELM-DSK-001",
        name: "Walnut Desk Organiser Tray",
        brand: "Elmate",
        category: "desk-and-office",
        subCategory: "desk-organisers",
        description:
            "Solid hardwood, sized for pens, clips and the things that otherwise migrate across a desk.",
        bulletPoints: ["Solid hardwood", "Felt base", "Three or five compartments"],
        basePrice: 3400,
        stock: 0,
        lowStockAlert: 3,
        weight: 540,
        dimensions: { length: 24, width: 12, height: 5 },
        attributes: [{ key: "Finish", value: "Oiled" }],
        isFeatured: true,
        hasVariants: true,
        variantOptions: [
            { name: "Compartments", values: ["Three", "Five"] },
            { name: "Finish", values: ["Walnut", "Oak"] },
        ],
        variants: [
            variant([{ name: "Compartments", value: "Three" }, { name: "Finish", value: "Walnut" }], { price: 3400, stock: 4, sku: "ELM-DSK-001-3W" }),
            variant([{ name: "Compartments", value: "Three" }, { name: "Finish", value: "Oak" }], { price: 3200, stock: 3, sku: "ELM-DSK-001-3O" }),
            variant([{ name: "Compartments", value: "Five" }, { name: "Finish", value: "Walnut" }], { price: 4000, stock: 2, sku: "ELM-DSK-001-5W" }),
            variant([{ name: "Compartments", value: "Five" }, { name: "Finish", value: "Oak" }], { price: 3800, stock: 1, sku: "ELM-DSK-001-5O" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["organiserA", "organiserB"], "Walnut desk organiser tray") },
        ],
    },
    {
        sku: "ELM-DSK-002",
        name: "Washi Tape Set, Six Rolls",
        brand: "Elmate",
        category: "desk-and-office",
        subCategory: "tape-and-adhesives",
        description:
            "Six patterns in 15mm rolls. Tears by hand, repositions cleanly and does not tear paper on removal.",
        bulletPoints: ["Six rolls", "15mm wide", "Tears by hand"],
        basePrice: 640,
        discountType: "percentage",
        discountValue: 20,
        stock: 0,
        weight: 120,
        attributes: [
            { key: "Width", value: "15mm" },
            { key: "Rolls", value: "6" },
        ],
        hasVariants: true,
        variantOptions: [{ name: "Palette", values: ["Muted", "Bright", "Kraft"] }],
        variants: [
            variant([{ name: "Palette", value: "Muted" }], { price: 640, stock: 14, sku: "ELM-DSK-002-MUT" }),
            variant([{ name: "Palette", value: "Bright" }], { price: 640, stock: 11, sku: "ELM-DSK-002-BRT" }),
            variant([{ name: "Palette", value: "Kraft" }], { price: 590, stock: 8, sku: "ELM-DSK-002-KFT" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["washiA", "washiB"], "Washi tape set") },
        ],
    },
    {
        sku: "ELM-DSK-003",
        name: "Kraft Document Box with Lid",
        brand: "Elmate",
        category: "desk-and-office",
        subCategory: "filing-and-storage",
        description:
            "Rigid board box with a lid. Flat packed, assembles without glue, and stacks four high without sagging.",
        bulletPoints: ["Flat packed", "Stackable", "Assembles without glue"],
        basePrice: 520,
        stock: 0,
        weight: 300,
        dimensions: { length: 33, width: 24, height: 10 },
        attributes: [{ key: "Material", value: "Kraft board" }],
        hasVariants: true,
        variantOptions: [
            { name: "Size", values: ["A4", "A3"] },
            { name: "Pack size", values: ["1", "3"] },
        ],
        variants: [
            variant([{ name: "Size", value: "A4" }, { name: "Pack size", value: "1" }], { price: 520, stock: 20, sku: "ELM-DSK-003-A4X1" }),
            variant([{ name: "Size", value: "A4" }, { name: "Pack size", value: "3" }], { price: 1400, stock: 12, sku: "ELM-DSK-003-A4X3" }),
            variant([{ name: "Size", value: "A3" }, { name: "Pack size", value: "1" }], { price: 720, stock: 9, sku: "ELM-DSK-003-A3X1" }),
            variant([{ name: "Size", value: "A3" }, { name: "Pack size", value: "3" }], { price: 1950, stock: 5, sku: "ELM-DSK-003-A3X3" }),
        ],
        imageGroups: [
            { name: "Main", images: shots(["boxA", "boxB"], "Kraft document box") },
        ],
    },
];

/**
 * Catches the mistake that variant matching cannot: an option pair whose name
 * or value is not in `variantOptions`. orderController.updateProductStock
 * compares those strings to find the variant whose stock to deduct, and when it
 * cannot find one it logs a warning and moves on — the sale goes through and
 * the stock never drops. Cheaper to fail here.
 */
function validateVariants(definition) {
    const problems = [];
    if (!definition.hasVariants) return problems;

    const allowed = new Map(
        (definition.variantOptions ?? []).map((option) => [option.name, new Set(option.values)]),
    );
    const groups = new Set((definition.imageGroups ?? []).map((group) => group.name));
    const seen = new Set();

    for (const v of definition.variants ?? []) {
        const key = v.options.map((o) => `${o.name}=${o.value}`).sort().join(" / ");
        if (seen.has(key)) problems.push(`duplicate combination ${key}`);
        seen.add(key);

        if (v.options.length !== allowed.size) {
            problems.push(`${v.sku}: has ${v.options.length} options, variantOptions declares ${allowed.size}`);
        }
        for (const { name, value } of v.options) {
            if (!allowed.has(name)) problems.push(`${v.sku}: option "${name}" is not in variantOptions`);
            else if (!allowed.get(name).has(value)) problems.push(`${v.sku}: "${value}" is not a declared value of "${name}"`);
        }
        if (v.imageGroupName && !groups.has(v.imageGroupName)) {
            problems.push(`${v.sku}: imageGroupName "${v.imageGroupName}" matches no imageGroup`);
        }
    }

    const expected = [...allowed.values()].reduce((total, values) => total * values.size, 1);
    if (seen.size !== expected) {
        problems.push(`declares ${expected} combinations but defines ${seen.size}`);
    }
    return problems;
}

async function run() {
    // Validate before anything else. A typo in the data above needs neither a
    // database nor a .env to catch, and checking it first means the whole file
    // can be dry run with `MONGO_URI= node scripts/seedProducts.js`.
    const invalid = PRODUCTS.flatMap((definition) =>
        validateVariants(definition).map((problem) => `  ${definition.sku}  ${problem}`),
    );
    if (invalid.length) {
        console.error("Variant definitions are inconsistent:\n" + invalid.join("\n") + "\n");
        process.exit(1);
    }
    console.log(
        `${PRODUCTS.length} products, ` +
            `${PRODUCTS.reduce((n, p) => n + (p.variants?.length ?? 0), 0)} variants, definitions consistent.`,
    );

    if (!process.env.MONGO_URI) {
        console.error("MONGO_URI is not set. Check your .env file.");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected.${RESET ? "  MODE: --reset" : ""}\n`);

    try {
        // Resolve every category slug once.
        const categories = await Category.find({}).select("slug name").lean();
        const idBySlug = new Map(categories.map((c) => [c.slug, c._id]));

        if (idBySlug.size === 0) {
            console.error("No categories found. Run: node scripts/seedStorefront.js first.\n");
            process.exit(1);
        }

        if (RESET) {
            const { deletedCount } = await Product.deleteMany({
                sku: { $regex: `^${SKU_PREFIX}` },
            });
            console.log(`  removed ${deletedCount} previously seeded products\n`);
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const definition of PRODUCTS) {
            const categoryId = idBySlug.get(definition.category);
            const subCategoryId = definition.subCategory
                ? idBySlug.get(definition.subCategory)
                : null;

            if (!categoryId) {
                console.warn(`  skip      ${definition.sku}  (category "${definition.category}" not found)`);
                skipped++;
                continue;
            }

            // Match on SKU so a re-run updates rather than duplicates.
            let product = await Product.findOne({ sku: definition.sku });
            const isNew = !product;
            if (!product) product = new Product();

            Object.assign(product, definition, {
                category: categoryId,
                subCategory: subCategoryId,
                currency: "BDT",
                isActive: true,
                // The pre-save hook only regenerates the slug when `name` is
                // modified, so assigning it every run keeps slugs in step with
                // any rename here.
                name: definition.name,
            });

            // Object.assign copies the array by reference onto an existing
            // document, and Mongoose will not always notice an in-place change
            // to a subdocument array. Marking it modified is what makes a
            // re-run actually persist edited variants instead of quietly
            // keeping the old ones.
            product.markModified("variants");
            product.markModified("imageGroups");

            // save(), not updateOne: the pre-save hooks generate the slug and
            // compute `price` for the product AND every variant, campaigns
            // included. An update query would skip all of that and leave
            // price at 0.
            await product.save();

            isNew ? created++ : updated++;
            const count = definition.variants?.length ?? 0;
            console.log(
                `  ${isNew ? "create  " : "update  "}  ${definition.sku.padEnd(15)} ${definition.name.padEnd(42)} ${count} variants`,
            );
        }

        console.log(`\nDone. ${created} created, ${updated} updated, ${skipped} skipped.`);
        console.log("Replace the seed photography with your own before launch — see scripts/seedImages.js.");
    } catch (error) {
        console.error("\nSeed failed:", error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

run();
