import mongoose from "mongoose";
import Category from "../models/Category.js";

/**
 * Resolve a category filter (ObjectId or slug) to that category plus every
 * descendant id.
 *
 * WHY: products are filed under the most specific category (e.g. Mango >
 * Himsagar). Filtering by the parent used to match only products whose
 * category/subCategory WAS the parent, so browsing "Mango" showed nothing
 * filed under its children.
 *
 * The whole tree is loaded in one lean query and walked in memory. A store
 * has tens of categories, not thousands, so this is cheaper than a
 * $graphLookup and needs no index. Returns [] for an unknown category so the
 * caller matches nothing instead of silently dropping the filter.
 */
export const resolveCategorySubtreeIds = async (categoryParam) => {
    if (!categoryParam || typeof categoryParam !== "string") return [];

    const all = await Category.find({}, "_id slug parentCategory").lean();

    const root = mongoose.Types.ObjectId.isValid(categoryParam)
        ? all.find((c) => String(c._id) === categoryParam)
        : all.find((c) => c.slug === categoryParam);
    if (!root) return [];

    const childrenOf = new Map();
    for (const c of all) {
        if (!c.parentCategory) continue;
        const key = String(c.parentCategory);
        if (!childrenOf.has(key)) childrenOf.set(key, []);
        childrenOf.get(key).push(c._id);
    }

    const ids = [];
    const seen = new Set();
    const queue = [root._id];
    while (queue.length) {
        const id = queue.shift();
        const key = String(id);
        if (seen.has(key)) continue; // guards against a corrupted cyclic tree
        seen.add(key);
        ids.push(id);
        queue.push(...(childrenOf.get(key) || []));
    }
    return ids;
};

export const categoryFilterFor = async (categoryParam) => {
    const ids = await resolveCategorySubtreeIds(categoryParam);
    return [{ category: { $in: ids } }, { subCategory: { $in: ids } }];
};
