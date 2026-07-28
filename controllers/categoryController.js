import {
    deleteImageFile,
    getFilePathFromUrl,
    getImageUrl,
} from "../middlewares/uploadCategoryImage.js";
import Category from "../models/Category.js";
import { APIFeatures } from "../utils/apiFeatures.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// @desc    Get all categories with tree structure
// @route   GET /api/categories/tree
// @access  Public
export const getCategoryTree = asyncHandler(async (req, res) => {
    const {
        maxDepth = 4,
        includeInactive = "false",
        includeContent = "true",
        minimal = "false",
    } = req.query;

    //  Build select fields based on requirements
    let selectFields = "name slug description parentCategory displayOrder isActive _id";

    if (includeContent === "true") {
        selectFields += " image aplusContent metaTitle metaDescription metaKeywords";
    }

    if (minimal === "true") {
        selectFields = "name slug parentCategory _id";
    }

    //  Build filter
    const filter = {};
    if (includeInactive !== "true") {
        filter.isActive = true;
    }

    //  Get all categories
    const categories = await Category.find(filter)
        .select(selectFields)
        .sort({ displayOrder: 1, name: 1 })
        .lean();

    //  Function to limit aplusContent size (if too large)
    const optimizeCategoryData = (category) => {
        const optimized = { ...category };

        // Limit aplusContent size if too big
        if (optimized.aplusContent && optimized.aplusContent.length > 5000) {
            optimized.aplusContent = optimized.aplusContent.substring(0, 5000) + "...";
            optimized.aplusContentTruncated = true;
        }

        // Optimize image URL if needed
        if (optimized.image?.url && optimized.image.url.includes("cloudinary")) {
            // Add image optimization parameters
            optimized.image.thumbnail = optimized.image.url.replace(
                "/upload/",
                "/upload/w_300,h_300,c_fill/",
            );
        }

        return optimized;
    };

    //  Create a map for O(1) lookups
    const categoryMap = new Map();

    // First pass: create optimized entries
    categories.forEach((category) => {
        categoryMap.set(category._id.toString(), {
            ...optimizeCategoryData(category),
            children: [],
        });
    });

    //  Build tree efficiently
    const rootCategories = [];

    categories.forEach((category) => {
        const categoryObj = categoryMap.get(category._id.toString());

        if (category.parentCategory && categoryMap.has(category.parentCategory.toString())) {
            const parent = categoryMap.get(category.parentCategory.toString());
            parent.children.push(categoryObj);
        } else {
            rootCategories.push(categoryObj);
        }
    });

    //  Optional: Limit depth
    const limitDepth = (nodes, currentDepth = 0) => {
        if (currentDepth >= maxDepth) {
            return nodes.map((node) => {
                const { children, ...nodeWithoutChildren } = node;
                return {
                    ...nodeWithoutChildren,
                    children: [],
                    hasMoreChildren: children.length > 0,
                };
            });
        }

        return nodes.map((node) => ({
            ...node,
            children: limitDepth(node.children, currentDepth + 1),
        }));
    };

    const finalTree = maxDepth ? limitDepth(rootCategories) : rootCategories;

    res.status(200).json({
        success: true,
        count: categories.length,
        data: finalTree,
        maxDepth: parseInt(maxDepth),
        includeContent: includeContent === "true",
        optimized: true,
        timestamp: new Date().toISOString(),
    });
});

// @desc    Get all categories (flat list)
// @route   GET /api/categories
// @access  Public
export const getCategories = asyncHandler(async (req, res) => {
    const features = new APIFeatures(Category.find(), req.query)
        .filter()
        .search(["name", "description"])
        .sort()
        .limitFields()
        .paginate();
    const categories = await features.query
        .select("+aplusContent")
        .populate("parentCategory", "name slug");
    const total = await Category.countDocuments();
    res.status(200).json({
        success: true,
        count: categories.length,
        total,
        data: categories,
    });
});

// @desc    Get single category
// @route   GET /api/categories/:id
// @access  Public
export const getCategory = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id)
        .populate("parentCategory", "name slug")
        .populate("children");

    if (!category) {
        return res.status(404).json({
            success: false,
            error: "Category not found",
        });
    }

    res.status(200).json({
        success: true,
        data: category,
    });
});

// @desc    Create new category
// @route   POST /api/categories
// @access  Private/Admin
export const createCategory = asyncHandler(async (req, res) => {
    const categoryData = { ...req.body };

    if (req.file) {
        categoryData.image = {
            url: getImageUrl(req.file.filename),
            public_id: req.file.filename,
        };
    }

    const category = await Category.create(categoryData);

    res.status(201).json({
        success: true,
        data: category,
    });
});

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
export const updateCategory = asyncHandler(async (req, res) => {
    let category = await Category.findById(req.params.id);

    if (!category) {
        return res.status(404).json({
            success: false,
            error: "Category not found",
        });
    }

    const updateData = { ...req.body };

    if (req.file) {
        // Delete old image if exists
        if (category.image?.url) {
            const oldImagePath = getFilePathFromUrl(category.image.url);
            deleteImageFile(oldImagePath);
        }

        // Set new image
        updateData.image = {
            url: getImageUrl(req.file.filename),
            public_id: req.file.filename,
        };
    }

    category = await Category.findByIdAndUpdate(req.params.id, updateData, {
        new: true,
        runValidators: true,
    });

    res.status(200).json({
        success: true,
        data: category,
    });
});

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
export const deleteCategory = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        return res.status(404).json({ success: false, error: "Category not found" });
    }

    // Check if category has children
    const hasChildren = await Category.findOne({ parentCategory: req.params.id });
    if (hasChildren) {
        return res.status(400).json({
            success: false,
            error: "Cannot delete category with subcategories",
        });
    }

    if (category.image?.url) {
        const imagePath = getFilePathFromUrl(category.image.url);
        deleteImageFile(imagePath);
    }

    await category.deleteOne();

    res.status(200).json({
        success: true,
        data: {},
    });
});

// @desc    Get category path/breadcrumb
// @route   GET /api/categories/:id/path
// @access  Public
export const getCategoryPath = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        return res.status(404).json({
            success: false,
            error: "Category not found",
        });
    }

    const path = [];
    let current = category;

    while (current) {
        path.unshift({
            _id: current._id,
            name: current.name,
            slug: current.slug,
        });

        if (current.parentCategory) {
            current = await Category.findById(current.parentCategory);
        } else {
            current = null;
        }
    }

    res.status(200).json({
        success: true,
        data: path,
    });
});

// @desc    Delete category image
// @route   DELETE /api/categories/:id/image
// @access  Private/Admin
export const deleteCategoryImage = asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        return res.status(404).json({
            success: false,
            error: "Category not found",
        });
    }

    if (!category.image?.url) {
        return res.status(400).json({
            success: false,
            error: "No image to delete",
        });
    }

    // Delete image file
    const imagePath = getFilePathFromUrl(category.image.url);
    deleteImageFile(imagePath);

    // Remove image from database
    category.image = undefined;
    await category.save();

    res.status(200).json({
        success: true,
        message: "Image deleted successfully",
        data: category,
    });
});
