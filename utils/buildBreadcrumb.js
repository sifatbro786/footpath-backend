// Builds breadcrumb path for a category by walking up parentCategory.
import mongoose from "mongoose";
import Category from "../models/Category.js";

export const buildBreadcrumb = async (categoryId) => {
    if (!categoryId) return [];
    const path = [];
    let current = await Category.findById(categoryId).select("name slug parentCategory").lean();
    while (current) {
        path.push({ _id: current._id, name: current.name, slug: current.slug });
        if (!current.parentCategory) break;
        current = await Category.findById(current.parentCategory)
            .select("name slug parentCategory")
            .lean();
    }
    return path.reverse();
};
