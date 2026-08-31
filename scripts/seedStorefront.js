// scripts/seedStorefront.js
//
// Seeds the storefront's structural content: categories, the navbar, hero
// slides and hero background media.
//
//   node scripts/seedStorefront.js          # create what is missing
//   node scripts/seedStorefront.js --reset  # replace navbar + hero entirely
//
// IDEMPOTENT BY DEFAULT. Run it as often as you like: categories are matched on
// slug and hero slides on title, so re-running updates rather than duplicates.
// Only --reset deletes anything, and only navbar/hero (never categories, which
// products point at by id).
//
// This does NOT seed products. Run scripts/seedProducts.js for those.

import mongoose from "mongoose";
import dotenv from "dotenv";

import Category from "../models/Category.js";
import Product from "../models/Product.js";
import NavbarConfig from "../models/NavbarConfig.js";
import HeroItem from "../models/Hero.js";
import HeroContent from "../models/HeroContent.js";
import { makeSlug } from "../utils/makeSlug.js";
import { photo } from "./seedImages.js";

dotenv.config();

const RESET = process.argv.includes("--reset");

/**
 * Photography lives in scripts/seedImages.js, shared with seedProducts.js.
 *
 * ⚠️ Development imagery, not Elmate's own. Replace hero slides at
 * /admin/hero-items and category images at /admin/categories before launch.
 *
 * These are external URLs, so a photo can be withdrawn without warning. The
 * storefront falls back to the local placeholder when an image fails to load
 * (handleImageError in productMapper), so a dead link degrades tidily rather
 * than showing a broken-image icon.
 *
 * Widths are baked into the URLs in seedImages.js rather than appended here.
 * The previous version tacked `?w=1800` onto an Unsplash id; Wikimedia serves
 * only a fixed set of thumbnail widths and rejects anything else with a 400,
 * so a width parameter cannot be applied generically any more. Every URL is
 * pinned at a size that works for both a hero plate and a category tile.
 */
const heroImage = (key) => photo(key);
const categoryImage = (key) => photo(key);

/**
 * Category name to photo. Keyed by NAME because the slug is derived, and this
 * has to stay readable next to the category definitions above.
 *
 * Each tile shows the thing the category actually sells. That sounds obvious;
 * it is called out because the previous map did not — "Pencils" pointed at a
 * concert hall and "Inks & Refills" at a makeup palette, because the ids were
 * never checked. See the header of scripts/seedImages.js.
 */
const CATEGORY_PHOTOS = {
    "Notebooks & Journals": "notebookStack",
    "Writing Instruments": "deskPens",
    "Desk & Office": "shopInterior",
    "Hardcover Notebooks": "journalBlack",
    "Softcover & Pocket": "fieldNotesB",
    Sketchbooks: "sketchbookA",
    "Fountain Pens": "penNib",
    "Ballpoint & Gel": "bicA",
    Pencils: "pencilsColour",
    "Inks & Refills": "inkTrio",
    "Desk Organisers": "organiserB",
    "Tape & Adhesives": "washiA",
    "Filing & Storage": "filingFolders",
};


// ─── Categories ──────────────────────────────────────────────────────────────
// Slugs here MUST match the navbar targets below and the links in AboutPage.
const CATEGORIES = [
    {
        name: "Notebooks & Journals",
        description:
            "Bound notebooks, softcover journals and refillable covers, in paper chosen to take fountain ink without bleeding.",
        metaTitle: "Notebooks and Journals | Elmate Stationery",
        metaDescription:
            "Hardbound notebooks, dot grid journals and refillable leather covers. Paper that takes ink properly.",
    },
    {
        name: "Writing Instruments",
        description:
            "Fountain pens, rollerballs, mechanical pencils and the inks and refills that keep them running.",
        metaTitle: "Fountain Pens and Writing Instruments | Elmate Stationery",
        metaDescription:
            "Fountain pens, rollerballs, mechanical pencils, bottled inks and refills, stocked in Dhaka.",
    },
    {
        name: "Desk & Office",
        description:
            "Trays, organisers, tape, clips and the quiet pieces that keep a working desk usable.",
        metaTitle: "Desk and Office Supplies | Elmate Stationery",
        metaDescription:
            "Desk organisers, trays, washi tape, clips and filing. Everything that keeps a desk in order.",
    },
];

// ─── Hero slides ─────────────────────────────────────────────────────────────
// `title` supports the *asterisk* highlight convention that the storefront
// parses into a marigold underline (see parseHeroTitle in productMapper).
//
// Photography keys resolve through scripts/seedImages.js. See CATEGORY_PHOTOS above.
const HERO_SLIDES = [
    {
        title: "Paper worth *writing on*.",
        subtitle:
            "Hardbound journals and dot grid notebooks, in stock that takes fountain ink without a whisper of bleed.",
        buttonText: "Shop notebooks",
        mediaType: "image",
        mediaUrl: heroImage("leuchtturmA"),
        deviceType: "both",
        order: 0,
        duration: 6,
        isActive: true,
    },
    {
        title: "Brass, resin and *good nibs*.",
        subtitle:
            "Fountain pens and mechanical pencils that feel like instruments rather than disposables.",
        buttonText: "Shop pens",
        mediaType: "image",
        mediaUrl: heroImage("penWriting"),
        deviceType: "both",
        order: 1,
        duration: 6,
        isActive: true,
    },
    {
        title: "A desk that *works back*.",
        subtitle:
            "Trays, organisers and the small hardware that turns a cluttered table into somewhere you want to sit.",
        buttonText: "Shop desk",
        mediaType: "image",
        mediaUrl: heroImage("organiserA"),
        deviceType: "both",
        order: 2,
        duration: 6,
        isActive: true,
    },
];

// ─── Hero background media ───────────────────────────────────────────────────
// ⚠️ The public GET /api/hero endpoint maps these documents down to mediaUrl
// only, discarding title/subtitle/buttonText/buttonLink. The copy below exists
// to satisfy the schema's `required` validators, not because it is displayed
// anywhere. The storefront promo banner uses only the URLs.
const HERO_CONTENT = [
    {
        title: "Promo imagery",
        subtitle: "Background media for the storefront promo banner",
        mediaType: "image",
        mediaUrl: heroImage("gelPens"),
        deviceType: "desktop",
        order: 0,
        isActive: true,
    },
    {
        title: "Promo imagery",
        subtitle: "Background media for the storefront promo banner",
        mediaType: "image",
        mediaUrl: heroImage("rhodiaA"),
        deviceType: "desktop",
        order: 1,
        isActive: true,
    },
    {
        title: "Promo imagery",
        subtitle: "Background media for the storefront promo banner",
        mediaType: "image",
        mediaUrl: heroImage("pencilsGraphite"),
        deviceType: "mobile",
        order: 0,
        isActive: true,
    },
];

// Subcategories, keyed by their parent's NAME (not slug, which is derived).
// `level` and `path` are computed by the model's pre-save hook, which is why
// these go through save() rather than findOneAndUpdate — that bypasses hooks
// entirely and would leave every child at level 0 with an empty path.
const SUBCATEGORIES = {
    "Notebooks & Journals": [
        { name: "Hardcover Notebooks" },
        { name: "Softcover & Pocket" },
        { name: "Sketchbooks" },
    ],
    "Writing Instruments": [
        { name: "Fountain Pens" },
        { name: "Ballpoint & Gel" },
        { name: "Pencils" },
        { name: "Inks & Refills" },
    ],
    "Desk & Office": [
        { name: "Desk Organisers" },
        { name: "Tape & Adhesives" },
        { name: "Filing & Storage" },
    ],
};

/**
 * Is this category image one the seed wrote, and therefore ours to replace?
 *
 * True for an absent image too: a category with nothing on it wants a tile.
 */
const isSeedOwned = (image) => !image?.url || (image.public_id ?? "").startsWith("seed/");

/**
 * Upsert one category through save(), so the pre-save hook runs and sets
 * level and path correctly.
 */
async function upsertCategory(definition, parent = null) {
    // ⚠️ NEVER hardcode a category slug. Category has a pre("validate") hook
    // that regenerates it from the name with slugify, which turns "&" into
    // "and": "Softcover & Pocket" becomes "softcover-and-pocket", not
    // "softcover-pocket". Hardcoding meant the lookup missed the existing row,
    // the seed tried to insert a second one, and the unique index rejected it.
    // Deriving it with the same helper the model uses cannot drift.
    const slug = makeSlug(definition.name);

    let category = await Category.findOne({ slug });
    if (!category) category = new Category();

    Object.assign(category, definition, {
        isActive: true,
        parentCategory: parent?._id ?? null,
        // A real upload through the admin panel is never overwritten by a
        // re-run. A previous SEED image is always refreshed.
        //
        // The earlier rule here was "keep whatever url is already set", which
        // sounds safe and was not: an abandoned run had filled every category
        // with /uploads/seed/cat-*.svg files that were never generated, so all
        // thirteen tiles pointed at a 404 and no amount of re-seeding could
        // heal them. Ownership is what decides this, not emptiness — and
        // `public_id` is what records ownership. Anything the seed wrote starts
        // with `seed/`; a Cloudinary id or an /uploads/categories upload does
        // not, and is left alone.
        image: isSeedOwned(category.image)
            ? {
                  url: categoryImage(CATEGORY_PHOTOS[definition.name] ?? "notebookStack"),
                  public_id: `seed/${slug}`,
              }
            : category.image,
    });

    await category.save();
    return category;
}

async function seedCategories() {
    const bySlug = new Map();

    for (const definition of CATEGORIES) {
        const parent = await upsertCategory(definition);
        bySlug.set(parent.slug, parent);
        console.log(`  category  ${parent.slug}`);

        for (const child of SUBCATEGORIES[definition.name] ?? []) {
            const sub = await upsertCategory(
                {
                    ...child,
                    description: `${child.name} in the ${definition.name} range.`,
                },
                parent,
            );
            bySlug.set(sub.slug, sub);
            console.log(`    sub     ${sub.slug}  (level ${sub.level})`);
        }
    }

    await reportStaleCategories(bySlug);
    return bySlug;
}

/**
 * Find duplicate categories left behind by the hardcoded-slug era.
 *
 * "Notebooks & Journals" was once filed as `notebooks-journals`; makeSlug turns
 * "&" into "and", so the seed now writes `notebooks-and-journals` and the old
 * row survives — empty, but still listed in the category page and the navbar.
 *
 * The test is name based, not image based. A row whose NAME is one this seed
 * manages but whose SLUG is not what makeSlug derives from that name can only
 * be one of those leftovers; nothing else writes that combination. An earlier
 * version keyed off `image.public_id` starting with "seed/" and missed the
 * duplicate that had no image at all.
 *
 * Reporting rather than deleting is deliberate, and matches this file's
 * contract: only --reset removes anything. A category is referenced by id from
 * every product filed under it, so a delete that looks safe by slug can strand
 * a catalogue. Even under --reset, one holding products is kept and named.
 */
async function reportStaleCategories(bySlug) {
    const managed = [
        ...CATEGORIES.map((c) => c.name),
        ...Object.values(SUBCATEGORIES).flatMap((children) => children.map((c) => c.name)),
    ];

    const stale = (await Category.find({ name: { $in: managed } }).lean()).filter(
        (category) => category.slug !== makeSlug(category.name) && !bySlug.has(category.slug),
    );
    if (stale.length === 0) return;

    for (const category of stale) {
        const count = await Product.countDocuments({
            $or: [{ category: category._id }, { subCategory: category._id }],
        });

        if (count > 0) {
            console.log(`  stale     ${category.slug}  (${count} products — kept, move them first)`);
            continue;
        }
        if (!RESET) {
            console.log(`  stale     ${category.slug}  (empty — re-run with --reset to remove)`);
            continue;
        }
        await Category.deleteOne({ _id: category._id });
        console.log(`  removed   ${category.slug}  (stale empty seed category)`);
    }
}

async function seedNavbar(categoriesBySlug) {
    // Items are ordered exactly as they should appear in the header.
    //
    // Category items store BOTH the category ref and a slug path. The frontend
    // builds hrefs from the populated category slug (navbarItemSchema's
    // pre-save hook writes `path` as /category/<ObjectId>, which is unusable),
    // but a correct path is written anyway so the stored data is not misleading.
    // Category items are resolved by NAME, and their path is built from the
    // slug the model actually assigned. Hardcoding either breaks the moment a
    // name contains "&", because slugify turns that into "and".
    const byName = (name) => [...categoriesBySlug.values()].find((c) => c.name === name);

    const categoryItem = (name, order) => {
        const category = byName(name);
        return {
            name,
            type: "category",
            category: category?._id ?? null,
            path: category ? `/category/${category.slug}` : "/shop",
            order,
            isActive: true,
        };
    };

    const items = [
        { name: "Home", type: "link", path: "/", order: 0, isActive: true },
        categoryItem("Notebooks & Journals", 1),
        categoryItem("Writing Instruments", 2),
        categoryItem("Desk & Office", 3),
        {
            name: "Deals & Bundles",
            type: "custom",
            customUrl: "/shop?deal=active",
            path: "/shop?deal=active",
            order: 4,
            isActive: true,
        },
        { name: "About Us", type: "link", path: "/about", order: 5, isActive: true },
        { name: "Contact", type: "link", path: "/contact", order: 6, isActive: true },
    ];

    const existing = await NavbarConfig.findOne({ isActive: true });

    if (existing && !RESET) {
        existing.items = items;
        await existing.save();
        console.log(`  navbar    updated ${items.length} items on existing config`);
        return;
    }

    if (RESET) await NavbarConfig.deleteMany({});

    await NavbarConfig.create({
        logo: { url: "", public_id: "" },
        logoUrl: "/",
        items,
        cartIcon: true,
        searchIcon: true,
        userIcon: true,
        wishlistIcon: true,
        isActive: true,
    });
    console.log(`  navbar    created config with ${items.length} items`);
}

async function seedHero() {
    if (RESET) {
        await HeroItem.deleteMany({});
        await HeroContent.deleteMany({});
        console.log("  hero      cleared existing slides and media");
    }

    for (const slide of HERO_SLIDES) {
        // Matched on title so a re-run updates the same slide rather than
        // stacking duplicates into the carousel.
        await HeroItem.findOneAndUpdate(
            { title: slide.title },
            { $set: slide },
            { upsert: true, setDefaultsOnInsert: true },
        );
        console.log(`  slide     ${slide.title}`);
    }

    for (const media of HERO_CONTENT) {
        await HeroContent.findOneAndUpdate(
            { mediaUrl: media.mediaUrl, deviceType: media.deviceType },
            { $set: media },
            { upsert: true, setDefaultsOnInsert: true },
        );
        console.log(`  media     ${media.deviceType}  ${media.mediaUrl.slice(0, 58)}...`);
    }
}

async function run() {
    if (!process.env.MONGO_URI) {
        console.error("MONGO_URI is not set. Check your .env file.");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected.${RESET ? "  MODE: --reset" : ""}\n`);

    try {
        const categories = await seedCategories();
        await seedNavbar(categories);
        await seedHero();

        console.log("\nDone.");
        console.log("Next: add products at /admin/products and file them under these categories.");
        console.log("Replace the seed photography with your own before launch — see scripts/seedImages.js.");
    } catch (error) {
        console.error("\nSeed failed:", error.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

run();
