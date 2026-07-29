// scripts/seedDistricts.js
//
// One-off bulk loader for the District collection from data/districts.js
// (62 districts, ~575 upazilas with correct shippingZone values already
// assigned). Safe to re-run: existing districts (matched by name) are
// upserted — their upazilas are replaced with the file's version, not
// duplicated. New districts are inserted.
//
// Run from the project root:
//   node scripts/seedDistricts.js
//   node scripts/seedDistricts.js --dry-run   (prints a summary, writes nothing)
//
// Requires MONGO_URI in .env (same variable config/database.js uses).

import mongoose from "mongoose";
import dotenv from "dotenv";
import { District } from "../models/ShippingConfig.js";
import { districtsData } from "../data/districts.js";

dotenv.config();

const isDryRun = process.argv.includes("--dry-run");

const run = async () => {
    if (!process.env.MONGO_URI) {
        console.error("❌ MONGO_URI is not set in .env");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected to MongoDB at: ${mongoose.connection.host}`);
    console.log(
        `Seeding ${districtsData.length} district(s), ` +
            `${districtsData.reduce((n, d) => n + d.upazilas.length, 0)} upazila(s) total` +
            (isDryRun ? " [dry run — no writes]" : ""),
    );

    let created = 0;
    let updated = 0;
    const errors = [];

    for (const d of districtsData) {
        try {
            const existing = await District.findOne({ name: d.name });

            if (isDryRun) {
                existing ? updated++ : created++;
                continue;
            }

            if (existing) {
                // Replace upazilas wholesale from the file — this is a re-seed of
                // known-good data, not a merge. Any upazilas an admin added by hand
                // through the UI (not present in districts.js) would be lost; check
                // the summary below before running against a DB with manual edits.
                existing.upazilas = d.upazilas;
                await existing.save();
                updated++;
            } else {
                await District.create({ name: d.name, upazilas: d.upazilas, isActive: true });
                created++;
            }
        } catch (err) {
            errors.push({ district: d.name, message: err.message });
        }
    }

    console.log("──────────────────────────────");
    console.log(`✅ Created: ${created}`);
    console.log(`♻️  Updated: ${updated}`);
    if (errors.length) {
        console.log(`❌ Failed: ${errors.length}`);
        errors.forEach((e) => console.log(`   - ${e.district}: ${e.message}`));
    }
    console.log("──────────────────────────────");

    await mongoose.disconnect();
    process.exit(errors.length ? 1 : 0);
};

run().catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
});
