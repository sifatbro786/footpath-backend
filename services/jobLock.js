// services/jobLock.js
// Cross-process lock for scheduled jobs. The campaign cron runs every minute
// in every Node process; with pm2 cluster mode or two servers it applied the
// same campaign twice. Only the holder of the lock runs the job; a crashed
// holder's lock expires after ttlMs.
import crypto from "crypto";
import mongoose from "mongoose";

const HOLDER = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;

export const runExclusive = async (name, ttlMs, fn) => {
    const locks = mongoose.connection.collection("joblocks");
    const now = new Date();
    try {
        // Matches only a free (or expired) lock. If someone holds it, the
        // upsert tries to insert the same _id and fails with 11000: skip.
        await locks.findOneAndUpdate(
            { _id: name, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: { $exists: false } }] },
            { $set: { lockedUntil: new Date(now.getTime() + ttlMs), holder: HOLDER } },
            { upsert: true },
        );
    } catch (error) {
        if (error.code === 11000) return { skipped: true };
        throw error;
    }
    try {
        return await fn();
    } finally {
        await locks.updateOne({ _id: name, holder: HOLDER }, { $set: { lockedUntil: new Date(0) } }).catch(() => {});
    }
};
