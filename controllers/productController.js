import { validationResult } from "express-validator";
import mongoose from "mongoose";
import AplusContent from "../models/AplusContent.js";
import DynamicSection from "../models/DynamicSection.js";
import Product from "../models/Product.js";
import { escapeRegex } from "../utils/escapeRegex.js";

import { deleteImageFile } from "../middlewares/upload.js";

const calculatePrice = (basePrice, discountType, discountValue) => {
    const base = parseFloat(basePrice) || 0;
    const discount = parseFloat(discountValue) || 0;

    if (discountType === "percentage") {
        return Math.max(0, base - (base * discount) / 100);
    } else if (discountType === "fixed") {
        return Math.max(0, base - discount);
    }
    return base;
};

/**
 * Canonical campaign-pricing resolver. THE single source of truth for turning a
 * plain product object into its storefront pricing fields. `getProducts`,
 * `getProductBySlug`, `getFeaturedProducts` and `getHomepageSections` all route
 * through this so the same product can never show one price on the homepage and
 * another on the catalogue (the bug this replaces).
 *
 * Accepts a plain object (`.toObject()` or `.lean()`), never a live Mongoose
 * doc. Requires `basePrice`, `price`, `discountType`, `discountValue`, and —
 * for campaign awareness — `isUnderCampaign` + the embedded `campaignDiscount`
 * subdoc, so the caller's projection MUST select those two fields. Returns the
 * enrichment fields only; spread them onto the product object at the call site.
 */
export const resolveCampaignPricing = (productObj) => {
    let isUnderValidCampaign = false;
    let campaignPrice = null;
    let campaignInfo = null;
    let finalPrice = productObj.price;
    let finalDiscountType = productObj.discountType;
    let finalDiscountValue = productObj.discountValue;

    if (productObj.isUnderCampaign && productObj.campaignDiscount?.isActive) {
        const now = new Date();
        const campaignStart = productObj.campaignDiscount.startDate
            ? new Date(productObj.campaignDiscount.startDate)
            : null;
        const campaignEnd = productObj.campaignDiscount.endDate
            ? new Date(productObj.campaignDiscount.endDate)
            : null;

        if ((!campaignStart || campaignStart <= now) && (!campaignEnd || campaignEnd >= now)) {
            isUnderValidCampaign = true;
            campaignPrice = productObj.campaignDiscount.campaignPrice;
            campaignInfo = {
                campaignId: productObj.campaignDiscount.campaignId,
                campaignName: productObj.campaignDiscount.campaignName,
                discountType: productObj.campaignDiscount.discountType,
                discountValue: productObj.campaignDiscount.discountValue,
                campaignPrice: campaignPrice,
                startDate: productObj.campaignDiscount.startDate,
                endDate: productObj.campaignDiscount.endDate,
            };

            finalPrice = campaignPrice;
            finalDiscountType = productObj.campaignDiscount.discountType;
            finalDiscountValue = productObj.campaignDiscount.discountValue;
        }
    }

    let discountAmount = 0;
    if (finalDiscountType === "percentage" && finalDiscountValue > 0) {
        discountAmount = (productObj.basePrice * finalDiscountValue) / 100;
    } else if (finalDiscountType === "fixed" && finalDiscountValue > 0) {
        discountAmount = finalDiscountValue;
    }

    if (isUnderValidCampaign && campaignPrice) {
        discountAmount = productObj.basePrice - campaignPrice;
    }

    return {
        finalPrice,
        isUnderValidCampaign,
        campaignInfo,
        discountAmount,
        isOnSale:
            (finalDiscountType !== "none" && finalDiscountValue > 0) || isUnderValidCampaign,
    };
};

export const createProduct = async (req, res) => {
    try {
        console.log("Received product data:", req.body);
        const errors = validationResult(req);
        if (req.file) {
            req.body.mainImage = `${process.env.BASE_URL || "http://localhost:5010"}/uploads/products/${req.file.filename}`;
        }
        if (req.files) {
            const uploadedImages = req.files.map(
                (file) =>
                    `${process.env.BASE_URL || "http://localhost:5010"}/uploads/products/${file.filename}`,
            );
            req.body.images = uploadedImages;
        }

        if (!errors.isEmpty()) {
            console.log("Validation errors:", errors.array());
            return res.status(400).json({
                success: false,
                message: "Validation errors",
                errors: errors.array(),
            });
        }

        // Ensure category is a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(req.body.category)) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID",
            });
        }

        // Handle subCategory if provided
        if (req.body.subCategory && !mongoose.Types.ObjectId.isValid(req.body.subCategory)) {
            return res.status(400).json({
                success: false,
                message: "Invalid subCategory ID",
            });
        }

        // Parse numeric fields with new discount system
        const productData = {
            ...req.body,
            basePrice: parseFloat(req.body.basePrice) || 0,
            discountType: req.body.discountType || "none",
            discountValue: parseFloat(req.body.discountValue) || 0,
            stock: parseInt(req.body.stock) || 0,
            lowStockAlert: parseInt(req.body.lowStockAlert) || 5,
            weight: parseFloat(req.body.weight) || 0,
            // aplusContent: req.body.aplusContent || '',
            bulletPoints: Array.isArray(req.body.bulletPoints) ? req.body.bulletPoints : [],
        };

        // Validate discount value based on type
        if (productData.discountType === "percentage" && productData.discountValue > 100) {
            return res.status(400).json({
                success: false,
                message: "Percentage discount cannot exceed 100%",
            });
        }

        // Parse dimensions
        if (req.body.dimensions) {
            productData.dimensions = {
                length: parseFloat(req.body.dimensions.length) || 0,
                width: parseFloat(req.body.dimensions.width) || 0,
                height: parseFloat(req.body.dimensions.height) || 0,
            };
        }

        // UNIVERSAL VARIANT HANDLING - ANY PRODUCT TYPE
        if (
            req.body.hasVariants &&
            req.body.variantOptions &&
            Array.isArray(req.body.variantOptions)
        ) {
            productData.hasVariants = true;
            productData.variantOptions = req.body.variantOptions;

            // Function to generate all possible combinations for ANY variant options
            const generateAllVariants = (variantOptions, baseData = {}) => {
                if (!variantOptions || variantOptions.length === 0) return [];

                // Recursive function to generate combinations
                const generateCombinations = (
                    options,
                    currentIndex = 0,
                    currentCombination = [],
                ) => {
                    if (currentIndex === options.length) {
                        return [currentCombination];
                    }

                    const currentOption = options[currentIndex];
                    const combinations = [];

                    for (const value of currentOption.values) {
                        const newCombination = [
                            ...currentCombination,
                            { name: currentOption.name, value: value },
                        ];
                        combinations.push(
                            ...generateCombinations(options, currentIndex + 1, newCombination),
                        );
                    }

                    return combinations;
                };

                const allCombinations = generateCombinations(variantOptions);

                console.log(`Generated ${allCombinations.length} variant combinations`);

                // Convert to variant objects with universal defaults
                return allCombinations.map((combination, index) => {
                    // Find if this combination already exists in manually provided variants
                    const existingVariant = req.body.variants?.find((manualVariant) => {
                        if (
                            !manualVariant.options ||
                            manualVariant.options.length !== combination.length
                        ) {
                            return false;
                        }
                        return combination.every((combOpt) =>
                            manualVariant.options.some(
                                (manualOpt) =>
                                    manualOpt.name === combOpt.name &&
                                    manualOpt.value === combOpt.value,
                            ),
                        );
                    });

                    // Use existing variant data if available, otherwise use defaults
                    return {
                        options: combination,
                        basePrice:
                            existingVariant?.basePrice ||
                            baseData.basePrice ||
                            productData.basePrice ||
                            0,
                        discountType:
                            existingVariant?.discountType ||
                            baseData.discountType ||
                            productData.discountType ||
                            "none",
                        discountValue:
                            existingVariant?.discountValue ||
                            baseData.discountValue ||
                            productData.discountValue ||
                            0,
                        stock: existingVariant?.stock || 0, // Default stock 0 for new variants
                        imageGroupName: existingVariant?.imageGroupName || "",
                        sku: existingVariant?.sku || `${productData.sku || "PROD"}-${index + 1}`,
                    };
                });
            };

            // CASE 1: Manual variants provided - use them as they are
            if (
                req.body.variants &&
                Array.isArray(req.body.variants) &&
                req.body.variants.length > 0
            ) {
                console.log("Using manually provided variants");
                productData.variants = req.body.variants.map((variant) => {
                    // Validate variant discount value
                    if (variant.discountType === "percentage" && variant.discountValue > 100) {
                        throw new Error(`Variant percentage discount cannot exceed 100%`);
                    }

                    const variantBasePrice =
                        parseFloat(variant.basePrice) || parseFloat(productData.basePrice) || 0;
                    const variantDiscountType =
                        variant.discountType || productData.discountType || "none";
                    const variantDiscountValue = parseFloat(variant.discountValue) || 0;

                    // Calculate price for variant
                    let variantPrice = variantBasePrice;
                    if (variantDiscountType !== "none" && variantDiscountValue > 0) {
                        variantPrice = calculatePrice(
                            variantBasePrice,
                            variantDiscountType,
                            variantDiscountValue,
                        );
                    } else if (
                        productData.discountType !== "none" &&
                        productData.discountValue > 0
                    ) {
                        variantPrice = calculatePrice(
                            variantBasePrice,
                            productData.discountType,
                            productData.discountValue,
                        );
                    }

                    return {
                        options: Array.isArray(variant.options)
                            ? variant.options.map((opt) => ({
                                  name: opt.name,
                                  value: opt.value,
                              }))
                            : [],

                        basePrice: variantBasePrice,
                        discountType: variantDiscountType,
                        discountValue: variantDiscountValue,
                        price: variantPrice, //  calculated price
                        stock: parseInt(variant.stock) || 0,
                        imageGroupName: variant.imageGroupName || "",
                        sku: variant.sku || "",
                    };
                });
            } else {
                console.log("Auto-generating all variant combinations");
                productData.variants = generateAllVariants(req.body.variantOptions, {
                    basePrice: productData.basePrice,
                    discountType: productData.discountType,
                    discountValue: productData.discountValue,
                });

                // Auto-generated variants- price calculate
                productData.variants = productData.variants.map((variant) => {
                    const variantBasePrice = variant.basePrice || productData.basePrice || 0;
                    const variantDiscountType =
                        variant.discountType || productData.discountType || "none";
                    const variantDiscountValue =
                        variant.discountValue || productData.discountValue || 0;

                    let variantPrice = variantBasePrice;
                    if (variantDiscountType !== "none" && variantDiscountValue > 0) {
                        variantPrice = calculatePrice(
                            variantBasePrice,
                            variantDiscountType,
                            variantDiscountValue,
                        );
                    } else if (
                        productData.discountType !== "none" &&
                        productData.discountValue > 0
                    ) {
                        variantPrice = calculatePrice(
                            variantBasePrice,
                            productData.discountType,
                            productData.discountValue,
                        );
                    }

                    return {
                        ...variant,
                        price: variantPrice,
                    };
                });
            }
        } else {
            // No variants - simple product
            productData.hasVariants = false;
            productData.variantOptions = [];
            productData.variants = [];
        }

        // Handle image groups
        if (req.body.imageGroups && Array.isArray(req.body.imageGroups)) {
            productData.imageGroups = req.body.imageGroups.map((group) => ({
                name: group.name,
                images: group.images || [],
            }));
        } else {
            // Default image group
            productData.imageGroups = [
                {
                    name: "Main",
                    images: [],
                },
            ];
        }

        // Handle videos
        if (req.body.videos && Array.isArray(req.body.videos)) {
            productData.videos = req.body.videos;
        }

        // Handle attributes
        if (req.body.attributes && Array.isArray(req.body.attributes)) {
            productData.attributes = req.body.attributes;
        }

        // Handle meta keywords
        if (req.body.metaKeywords && Array.isArray(req.body.metaKeywords)) {
            productData.metaKeywords = req.body.metaKeywords;
        }

        console.log("Processed product data:", productData);
        console.log(
            `Variant Info: hasVariants=${productData.hasVariants}, variantCount=${productData.variants?.length || 0}`,
        );

        // Create product
        const product = new Product(productData);
        const savedProduct = await product.save();

        // Populate category and subCategory for response
        await savedProduct.populate("category subCategory");

        res.status(201).json({
            success: true,
            message: "Product created successfully",
            product: savedProduct,
        });
    } catch (error) {
        console.error("Error creating product:", error);

        if (req.file) {
            deleteImageFile("products", req.file.filename);
        }
        if (req.files) {
            req.files.forEach((file) => {
                deleteImageFile("products", file.filename);
            });
        }

        if (error.code === 11000) {
            // Duplicate key error
            const duplicateField = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `Product with this ${duplicateField} already exists`,
            });
        }

        if (error.name === "ValidationError") {
            const validationErrors = {};
            Object.keys(error.errors).forEach((key) => {
                validationErrors[key] = error.errors[key].message;
            });

            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: validationErrors,
            });
        }

        // Custom error message handling
        if (error.message.includes("Percentage discount cannot exceed 100%")) {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }

        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === "development" ? error.message : "Something went wrong",
        });
    }
};

// ################ version 2 optimized product fetch performance and filtering with existing rolebase access ################
export const getProducts = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 12,
            search,
            category,
            minPrice,
            maxPrice,
            inStock,
            onSale,
            sortBy = "displayOrder",
            sortOrder = "asc",
            discountType,
            // PHASE 3: attribute facets and rating were only reachable through
            // getProductsByMultipleAttributes, which supports attributes and
            // pagination and NOTHING else — no category, price, stock, sort or
            // search, and no campaign pricing. That made "Colour: Blue under
            // ৳500, newest first" impossible to express in one request.
            // Both are now first-class filters here so the catalogue can combine
            // every facet. /filter/multiple-attributes is left untouched for
            // backwards compatibility.
            attributes,
            minRating,
        } = req.query;

        const limitInt = parseInt(limit);
        const pageInt = parseInt(page);
        const skip = (pageInt - 1) * limitInt;

        let filter = { isActive: true };

        if (category) {
            filter.$or = [{ category: category }, { subCategory: category }];
        }

        if (minPrice || maxPrice) {
            filter.price = {};
            if (minPrice) filter.price.$gte = parseFloat(minPrice);
            if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
        }

        if (inStock === "true") {
            filter.stock = { $gt: 0 };
        }

        if (onSale === "true") {
            filter.discountType = { $ne: "none" };
            filter.discountValue = { $gt: 0 };
        }

        if (discountType && discountType !== "all") {
            filter.discountType = discountType;
        }

        // ─── Attribute facets (PHASE 3) ──────────────────────────────────────
        // Accepts a JSON object: ?attributes={"Colour":"Blue","Size":"A5"}
        // An array value multi-selects within one facet:
        //   {"Colour":["Blue","Black"]}  ->  Colour is Blue OR Black
        // Different keys AND together, values within a key OR together, which is
        // how shoppers expect facets to behave.
        //
        // Malformed JSON is ignored rather than answered with a 400: this value
        // comes from a URL the user may have edited or truncated, and dropping
        // one bad facet is friendlier than failing the whole listing.
        if (attributes) {
            let parsedAttributes = null;
            try {
                parsedAttributes =
                    typeof attributes === "string" ? JSON.parse(attributes) : attributes;
            } catch {
                parsedAttributes = null;
            }

            if (parsedAttributes && typeof parsedAttributes === "object") {
                const clauses = Object.entries(parsedAttributes)
                    .filter(([key, value]) => key && value != null && value !== "")
                    .map(([key, value]) => ({
                        attributes: {
                            $elemMatch: {
                                key,
                                value: Array.isArray(value) ? { $in: value } : value,
                            },
                        },
                    }));

                if (clauses.length > 0) {
                    // `category` above may already own filter.$or; $and is a
                    // separate key, so the two never collide.
                    filter.$and = [...(filter.$and || []), ...clauses];
                }
            }
        }

        // ─── Rating floor (PHASE 3) ──────────────────────────────────────────
        // averageRating is denormalised onto Product by the review controller,
        // so this is a plain field comparison rather than an aggregation.
        const minRatingValue = parseFloat(minRating);
        if (Number.isFinite(minRatingValue) && minRatingValue > 0) {
            filter.averageRating = { $gte: minRatingValue };
        }

        let sortOptions = {};

        // Enhanced sorting based on sortBy parameter
        switch (sortBy) {
            case "displayOrder":
                sortOptions = { displayOrder: sortOrder === "asc" ? 1 : -1, createdAt: -1 };
                break;
            case "newest":
                sortOptions = { publishDate: sortOrder === "asc" ? 1 : -1, createdAt: -1 };
                break;
            case "price_asc":
                sortOptions = { price: 1 };
                break;
            case "price_desc":
                sortOptions = { price: -1 };
                break;
            case "popularity":
                sortOptions = { purchaseCount: sortOrder === "asc" ? 1 : -1 };
                break;
            case "rating":
                sortOptions = { averageRating: sortOrder === "asc" ? 1 : -1 };
                break;
            default:
                sortOptions = { displayOrder: -1, createdAt: -1 };
        }

        if (search) {
            filter.$text = { $search: search };
            sortOptions.score = { $meta: "textScore" };
        }

        const totalProducts = await Product.countDocuments(filter);
        const totalPages = Math.ceil(totalProducts / limitInt);

        const products = await Product.find(filter)
            .select(
                "name slug price basePrice discountType discountValue imageGroups averageRating numReviews stock hasVariants category subCategory isUnderCampaign activeCampaignId campaignDiscount originalDiscount displayOrder publishDate purchaseCount viewCount",
            )
            .populate({
                path: "category",
                select: "name slug parentCategory",
                populate: {
                    path: "parentCategory",
                    select: "name slug parentCategory",
                    populate: { path: "parentCategory", select: "name slug" },
                },
            })
            .populate({
                path: "subCategory",
                select: "name slug parentCategory",
                populate: {
                    path: "parentCategory",
                    select: "name slug parentCategory",
                    populate: { path: "parentCategory", select: "name slug" },
                },
            })
            .populate({
                path: "activeCampaignId",
                select: "name discountType discountValue startDate endDate",
            })
            .sort(sortOptions)
            .skip(skip)
            .limit(limitInt);

        // Calculate discount amount for each product with campaign consideration
        const productsWithCampaign = products.map((product) => {
            const productObj = product.toObject();
            return { ...productObj, ...resolveCampaignPricing(productObj) };
        });

        res.status(200).json({
            success: true,
            products: productsWithCampaign,
            total: totalProducts,
            totalPages: totalPages,
            currentPage: pageInt,
            limit: limitInt,
            sortBy: sortBy,
            sortOrder: sortOrder,
        });
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching products",
            error: error.message,
        });
    }
};

export const getAdminProducts = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search,
            category,
            sortBy = "displayOrder",
            sortOrder = "asc", //  changed from "desc" to "asc"
            discountType,
        } = req.query;

        let filter = {};

        if (search) {
            const searchRegex = new RegExp(escapeRegex(search), "i");
            filter.$or = [{ name: { $regex: searchRegex } }, { sku: { $regex: searchRegex } }];
        }

        if (category) {
            filter.category = category;
        }

        if (discountType && discountType !== "all") {
            filter.discountType = discountType;
        }

        let sortOptions = {};

        switch (sortBy) {
            case "displayOrder":
                //  ascending - 1 means smallest first
                sortOptions = { displayOrder: sortOrder === "asc" ? 1 : -1 };
                break;
            case "purchaseCount":
                sortOptions = { purchaseCount: sortOrder === "asc" ? 1 : -1 };
                break;
            case "viewCount":
                sortOptions = { viewCount: sortOrder === "asc" ? 1 : -1 };
                break;
            case "name":
                sortOptions = { name: sortOrder === "asc" ? 1 : -1 };
                break;
            case "price":
                sortOptions = { price: sortOrder === "asc" ? 1 : -1 };
                break;
            case "newest":
                sortOptions = { createdAt: sortOrder === "asc" ? 1 : -1 };
                break;
            default:
                sortOptions = { displayOrder: 1 }; //  ascending by default
        }

        const products = await Product.find(filter)
            //  added isActive so the admin product list can show real active/inactive status
            .select(
                "name price stock sku isFeatured isActive imageGroups category discountType discountValue createdAt displayOrder purchaseCount viewCount",
            )
            .populate({
                path: "category",
                select: "name",
            })
            .populate({
                path: "subCategory",
                select: "name",
            })
            .sort(sortOptions)
            .limit(parseInt(limit))
            .skip((page - 1) * limit)
            .lean();

        const total = await Product.countDocuments(filter);

        res.status(200).json({
            success: true,
            products,
            totalPages: Math.ceil(total / limit),
            currentPage: Number(page),
            total,
        });
    } catch (error) {
        console.error("Error fetching admin products:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching products",
            error: error.message,
        });
    }
};

export const getAdminProductsOptimized = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search,
            category,
            sortBy = "createdAt",
            sortOrder = "desc",
        } = req.query;

        // Minimal projection
        const projection = {
            _id: 1,
            name: 1,
            sku: 1,
            price: 1,
            stock: 1,
            isFeatured: 1,
            isActive: 1, //  added so admin list can show real active/inactive status
            discountType: 1,
            discountValue: 1,
            createdAt: 1,
            "imageGroups.0.images.0.url": 1, //  শুধু প্রথম ইমেজ
            category: 1,
            subCategory: 1,
        };

        const filter = {};
        if (search) {
            filter.$or = [
                { name: { $regex: escapeRegex(search), $options: "i" } },
                { sku: { $regex: escapeRegex(search), $options: "i" } },
            ];
        }

        if (category) filter.category = category;

        const [products, total] = await Promise.all([
            Product.find(filter, projection)
                .populate("category", "name")
                .populate("subCategory", "name")
                .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
                .limit(parseInt(limit))
                .skip((parseInt(page) - 1) * parseInt(limit))
                .lean(),
            Product.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            products,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit)),
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ################ version 3 updated for new discount system ################
// export const updateProduct = async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({
//         success: false,
//         errors: errors.array()
//       });
//     }

//     const existingProduct = await Product.findById(req.params.id);

//     // Image handling code (unchanged)
//     if (req.file) {
//       if (existingProduct.mainImage) {
//         const oldFilename = existingProduct.mainImage.split('/').pop();
//         deleteImageFile('products', oldFilename);
//       }
//       req.body.mainImage = `${process.env.BASE_URL || "http://localhost:5010"}/uploads/products/${req.file.filename}`;
//     }

//     let finalImages = existingProduct.images || [];
//     if (req.body.existingImages) {
//       const keptImages = Array.isArray(req.body.existingImages)
//         ? req.body.existingImages
//         : JSON.parse(req.body.existingImages);

//       const imagesToDelete = existingProduct.images.filter(img => !keptImages.includes(img));

//       imagesToDelete.forEach(imgUrl => {
//         const filename = imgUrl.split('/').pop();
//         deleteImageFile('products', filename);
//       });

//       finalImages = keptImages;
//     }

//     if (req.files && req.files.length > 0) {
//       const newUploadedImages = req.files.map(file =>
//         `${process.env.BASE_URL || "http://localhost:5010"}/uploads/products/${file.filename}`
//       );
//       finalImages = [...finalImages, ...newUploadedImages];
//     }

//     req.body.images = finalImages;

//     let bulletPoints = [];
//     if (req.body.bulletPoints) {
//       if (Array.isArray(req.body.bulletPoints)) {
//         bulletPoints = req.body.bulletPoints;
//       } else if (typeof req.body.bulletPoints === 'string') {
//         try {
//           bulletPoints = JSON.parse(req.body.bulletPoints);
//         } catch (error) {
//           bulletPoints = req.body.bulletPoints.split(',').map(item => item.trim()).filter(item => item);
//         }
//       }
//     } else {

//       bulletPoints = existingProduct.bulletPoints || [];
//     }

//     const productData = {
//       ...req.body,
//       bulletPoints: bulletPoints,
//       basePrice: parseFloat(req.body.basePrice) || 0,
//       discountType: req.body.discountType || "none",
//       discountValue: parseFloat(req.body.discountValue) || 0,
//       stock: parseInt(req.body.stock) || 0,
//       lowStockAlert: parseInt(req.body.lowStockAlert) || 5,
//       weight: parseFloat(req.body.weight) || 0,
//       // aplusContent: req.body.aplusContent || '',
//     };

//     if (productData.discountType === "percentage" && productData.discountValue > 100) {
//       return res.status(400).json({
//         success: false,
//         message: 'Percentage discount cannot exceed 100%'
//       });
//     }

//     if (req.body.dimensions) {
//       productData.dimensions = {
//         length: parseFloat(req.body.dimensions.length) || 0,
//         width: parseFloat(req.body.dimensions.width) || 0,
//         height: parseFloat(req.body.dimensions.height) || 0
//       };
//     }

//     if (req.body.hasVariants && req.body.variantOptions && Array.isArray(req.body.variantOptions)) {
//       productData.hasVariants = true;
//       productData.variantOptions = req.body.variantOptions;

//       // Function to generate all possible combinations for ANY variant options
//       const generateAllVariants = (variantOptions, baseData = {}) => {
//         if (!variantOptions || variantOptions.length === 0) return [];

//         const generateCombinations = (options, currentIndex = 0, currentCombination = []) => {
//           if (currentIndex === options.length) {
//             return [currentCombination];
//           }

//           const currentOption = options[currentIndex];
//           const combinations = [];

//           for (const value of currentOption.values) {
//             const newCombination = [
//               ...currentCombination,
//               { name: currentOption.name, value: value }
//             ];
//             combinations.push(...generateCombinations(options, currentIndex + 1, newCombination));
//           }

//           return combinations;
//         };

//         const allCombinations = generateCombinations(variantOptions);

//         return allCombinations.map((combination, index) => {
//           const existingVariant = req.body.variants?.find(manualVariant => {
//             if (!manualVariant.options || manualVariant.options.length !== combination.length) {
//               return false;
//             }
//             return combination.every(combOpt =>
//               manualVariant.options.some(manualOpt =>
//                 manualOpt.name === combOpt.name && manualOpt.value === combOpt.value
//               )
//             );
//           });

//           return {
//             options: combination,
//             basePrice: existingVariant?.basePrice || baseData.basePrice || productData.basePrice || 0,
//             discountType: existingVariant?.discountType || baseData.discountType || productData.discountType || "none",
//             discountValue: existingVariant?.discountValue || baseData.discountValue || productData.discountValue || 0,
//             stock: existingVariant?.stock || 0,
//             imageGroupName: existingVariant?.imageGroupName || '',
//             sku: existingVariant?.sku || `${productData.sku || 'PROD'}-${index + 1}`
//           };
//         });
//       };

//       // CASE 1: Manual variants provided - use them as they are
//       if (req.body.variants && Array.isArray(req.body.variants) && req.body.variants.length > 0) {
//         console.log('Using manually provided variants');
//         productData.variants = req.body.variants.map(variant => {
//           if (variant.discountType === "percentage" && variant.discountValue > 100) {
//             throw new Error(`Variant percentage discount cannot exceed 100%`);
//           }
//           const variantBasePrice = parseFloat(variant.basePrice) || parseFloat(productData.basePrice) || 0;
//           const variantDiscountType = variant.discountType || productData.discountType || "none";
//           const variantDiscountValue = parseFloat(variant.discountValue) || 0;

//           let variantPrice = variantBasePrice;
//           if (variantDiscountType !== "none" && variantDiscountValue > 0) {
//             variantPrice = calculatePrice(variantBasePrice, variantDiscountType, variantDiscountValue);
//           } else if (productData.discountType !== "none" && productData.discountValue > 0) {
//             variantPrice = calculatePrice(variantBasePrice, productData.discountType, productData.discountValue);
//           }
//           return {
//             options: Array.isArray(variant.options) ? variant.options.map(opt => ({
//               name: opt.name,
//               value: opt.value,
//             })) : [],

//             basePrice: variantBasePrice,
//             discountType: variantDiscountType,
//             discountValue: variantDiscountValue,
//             price: variantPrice,
//             stock: parseInt(variant.stock) || 0,
//             imageGroupName: variant.imageGroupName || '',
//             sku: variant.sku || ''
//           };
//         });
//       }
//       // CASE 2: No manual variants - auto-generate ALL possible combinations
//       else {
//         console.log('Auto-generating all variant combinations');
//         productData.variants = generateAllVariants(req.body.variantOptions, {
//           basePrice: productData.basePrice,
//           discountType: productData.discountType,
//           discountValue: productData.discountValue
//         });
//         productData.variants = productData.variants.map(variant => {
//           const variantBasePrice = variant.basePrice || productData.basePrice || 0;
//           const variantDiscountType = variant.discountType || productData.discountType || "none";
//           const variantDiscountValue = variant.discountValue || productData.discountValue || 0;

//           let variantPrice = variantBasePrice;
//           if (variantDiscountType !== "none" && variantDiscountValue > 0) {
//             variantPrice = calculatePrice(variantBasePrice, variantDiscountType, variantDiscountValue);
//           } else if (productData.discountType !== "none" && productData.discountValue > 0) {
//             variantPrice = calculatePrice(variantBasePrice, productData.discountType, productData.discountValue);
//           }
//           return {
//             ...variant,
//             price: variantPrice
//           };
//         });
//       }
//     } else {
//       productData.hasVariants = false;
//       productData.variantOptions = [];
//       productData.variants = [];
//     }

//     console.log('Updating product with data:', productData);
//     console.log('Bullet Points:', productData.bulletPoints); //  লগ যোগ করুন
//     console.log(`Variant Info: hasVariants=${productData.hasVariants}, variantCount=${productData.variants?.length || 0}`);

//     const product = await Product.findByIdAndUpdate(
//       req.params.id,
//       productData,
//       { new: true, runValidators: true }
//     ).populate("category subCategory");

//     if (!product) {
//       return res.status(404).json({
//         success: false,
//         message: "Product not found"
//       });
//     }

//     res.status(200).json({
//       success: true,
//       message: "Product updated successfully",
//       product
//     });
//   } catch (error) {
//     console.error('Error updating product:', error);

//     if (req.file) {
//       deleteImageFile('products', req.file.filename);
//     }
//     if (req.files) {
//       req.files.forEach(file => {
//         deleteImageFile('products', file.filename);
//       });
//     }

//     if (error.name === "CastError") {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid product ID"
//       });
//     }
//     if (error.code === 11000) {
//       return res.status(400).json({
//         success: false,
//         message: "Product with this SKU or slug already exists"
//       });
//     }

//     // Custom error message handling
//     if (error.message.includes('Percentage discount cannot exceed 100%')) {
//       return res.status(400).json({
//         success: false,
//         message: error.message
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: "Error updating product",
//       error: error.message
//     });
//   }
// };

export const updateProduct = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array(),
            });
        }

        const existingProduct = await Product.findById(req.params.id);

        if (req.body.imageGroups && typeof req.body.imageGroups === "string") {
            try {
                req.body.imageGroups = JSON.parse(req.body.imageGroups);
            } catch (error) {
                console.error("Error parsing imageGroups:", error);
            }
        }

        if (req.files && req.files.length > 0) {
            const newImages = req.files.map((file) => ({
                url: `${process.env.BASE_URL || "http://localhost:5010"}/uploads/products/${file.filename}`,
                filename: file.filename,
                alt: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
            }));

            if (
                !req.body.imageGroups ||
                (Array.isArray(req.body.imageGroups) && req.body.imageGroups.length === 0)
            ) {
                req.body.imageGroups = [
                    {
                        name: "Main",
                        images: newImages,
                    },
                ];
            } else {
                const imageGroups = Array.isArray(req.body.imageGroups) ? req.body.imageGroups : [];
                if (imageGroups.length > 0) {
                    imageGroups[0].images = [...(imageGroups[0].images || []), ...newImages];
                    req.body.imageGroups = imageGroups;
                } else {
                    req.body.imageGroups = [
                        {
                            name: "Main",
                            images: newImages,
                        },
                    ];
                }
            }
        }

        if (
            req.body.imageGroups &&
            Array.isArray(req.body.imageGroups) &&
            existingProduct.imageGroups
        ) {
            const newImageUrls = new Set();

            req.body.imageGroups.forEach((group) => {
                if (group.images && Array.isArray(group.images)) {
                    group.images.forEach((img) => {
                        if (img.url) newImageUrls.add(img.url);
                    });
                }
            });

            existingProduct.imageGroups.forEach((oldGroup) => {
                if (oldGroup.images && Array.isArray(oldGroup.images)) {
                    oldGroup.images.forEach((oldImg) => {
                        if (oldImg.url && !newImageUrls.has(oldImg.url)) {
                            const filename = oldImg.url.split("/").pop();
                            if (filename && !filename.includes("cloudinary")) {
                                deleteImageFile("products", filename);
                            }
                        }
                    });
                }
            });
        }

        let bulletPoints = [];
        if (req.body.bulletPoints) {
            if (Array.isArray(req.body.bulletPoints)) {
                bulletPoints = req.body.bulletPoints;
            } else if (typeof req.body.bulletPoints === "string") {
                try {
                    bulletPoints = JSON.parse(req.body.bulletPoints);
                } catch (error) {
                    bulletPoints = req.body.bulletPoints
                        .split(",")
                        .map((item) => item.trim())
                        .filter((item) => item);
                }
            }
        } else {
            bulletPoints = existingProduct.bulletPoints || [];
        }

        const productData = {
            ...req.body,
            bulletPoints: bulletPoints,
            basePrice: parseFloat(req.body.basePrice) || 0,
            discountType: req.body.discountType || "none",
            discountValue: parseFloat(req.body.discountValue) || 0,
            stock: parseInt(req.body.stock) || 0,
            lowStockAlert: parseInt(req.body.lowStockAlert) || 5,
            weight: parseFloat(req.body.weight) || 0,
        };

        if (productData.discountType === "percentage" && productData.discountValue > 100) {
            return res.status(400).json({
                success: false,
                message: "Percentage discount cannot exceed 100%",
            });
        }

        if (req.body.dimensions) {
            productData.dimensions = {
                length: parseFloat(req.body.dimensions.length) || 0,
                width: parseFloat(req.body.dimensions.width) || 0,
                height: parseFloat(req.body.dimensions.height) || 0,
            };
        }

        if (
            req.body.hasVariants &&
            req.body.variantOptions &&
            Array.isArray(req.body.variantOptions)
        ) {
            productData.hasVariants = true;
            productData.variantOptions = req.body.variantOptions;

            const generateAllVariants = (variantOptions, baseData = {}) => {
                if (!variantOptions || variantOptions.length === 0) return [];

                const generateCombinations = (
                    options,
                    currentIndex = 0,
                    currentCombination = [],
                ) => {
                    if (currentIndex === options.length) {
                        return [currentCombination];
                    }

                    const currentOption = options[currentIndex];
                    const combinations = [];

                    for (const value of currentOption.values) {
                        const newCombination = [
                            ...currentCombination,
                            { name: currentOption.name, value: value },
                        ];
                        combinations.push(
                            ...generateCombinations(options, currentIndex + 1, newCombination),
                        );
                    }

                    return combinations;
                };

                const allCombinations = generateCombinations(variantOptions);

                return allCombinations.map((combination, index) => {
                    const existingVariant = req.body.variants?.find((manualVariant) => {
                        if (
                            !manualVariant.options ||
                            manualVariant.options.length !== combination.length
                        ) {
                            return false;
                        }
                        return combination.every((combOpt) =>
                            manualVariant.options.some(
                                (manualOpt) =>
                                    manualOpt.name === combOpt.name &&
                                    manualOpt.value === combOpt.value,
                            ),
                        );
                    });

                    return {
                        options: combination,
                        basePrice:
                            existingVariant?.basePrice ||
                            baseData.basePrice ||
                            productData.basePrice ||
                            0,
                        discountType:
                            existingVariant?.discountType ||
                            baseData.discountType ||
                            productData.discountType ||
                            "none",
                        discountValue:
                            existingVariant?.discountValue ||
                            baseData.discountValue ||
                            productData.discountValue ||
                            0,
                        stock: existingVariant?.stock || 0,
                        imageGroupName: existingVariant?.imageGroupName || "",
                        sku: existingVariant?.sku || `${productData.sku || "PROD"}-${index + 1}`,
                    };
                });
            };

            if (
                req.body.variants &&
                Array.isArray(req.body.variants) &&
                req.body.variants.length > 0
            ) {
                console.log("Using manually provided variants");
                productData.variants = req.body.variants.map((variant) => {
                    if (variant.discountType === "percentage" && variant.discountValue > 100) {
                        throw new Error(`Variant percentage discount cannot exceed 100%`);
                    }
                    const variantBasePrice =
                        parseFloat(variant.basePrice) || parseFloat(productData.basePrice) || 0;
                    const variantDiscountType =
                        variant.discountType || productData.discountType || "none";
                    const variantDiscountValue = parseFloat(variant.discountValue) || 0;

                    let variantPrice = variantBasePrice;
                    if (variantDiscountType !== "none" && variantDiscountValue > 0) {
                        variantPrice = calculatePrice(
                            variantBasePrice,
                            variantDiscountType,
                            variantDiscountValue,
                        );
                    } else if (
                        productData.discountType !== "none" &&
                        productData.discountValue > 0
                    ) {
                        variantPrice = calculatePrice(
                            variantBasePrice,
                            productData.discountType,
                            productData.discountValue,
                        );
                    }
                    return {
                        options: Array.isArray(variant.options)
                            ? variant.options.map((opt) => ({
                                  name: opt.name,
                                  value: opt.value,
                              }))
                            : [],
                        basePrice: variantBasePrice,
                        discountType: variantDiscountType,
                        discountValue: variantDiscountValue,
                        price: variantPrice,
                        stock: parseInt(variant.stock) || 0,
                        imageGroupName: variant.imageGroupName || "",
                        sku: variant.sku || "",
                    };
                });
            } else {
                console.log("Auto-generating all variant combinations");
                productData.variants = generateAllVariants(req.body.variantOptions, {
                    basePrice: productData.basePrice,
                    discountType: productData.discountType,
                    discountValue: productData.discountValue,
                });
                productData.variants = productData.variants.map((variant) => {
                    const variantBasePrice = variant.basePrice || productData.basePrice || 0;
                    const variantDiscountType =
                        variant.discountType || productData.discountType || "none";
                    const variantDiscountValue =
                        variant.discountValue || productData.discountValue || 0;

                    let variantPrice = variantBasePrice;
                    if (variantDiscountType !== "none" && variantDiscountValue > 0) {
                        variantPrice = calculatePrice(
                            variantBasePrice,
                            variantDiscountType,
                            variantDiscountValue,
                        );
                    } else if (
                        productData.discountType !== "none" &&
                        productData.discountValue > 0
                    ) {
                        variantPrice = calculatePrice(
                            variantBasePrice,
                            productData.discountType,
                            productData.discountValue,
                        );
                    }
                    return {
                        ...variant,
                        price: variantPrice,
                    };
                });
            }
        } else {
            productData.hasVariants = false;
            productData.variantOptions = [];
            productData.variants = [];
        }

        // SKU
        if (productData.sku) {
            const duplicateSKU = await Product.findOne({
                sku: productData.sku,
                _id: { $ne: req.params.id },
            });
            if (duplicateSKU) {
                return res.status(400).json({
                    success: false,
                    message: "এই SKU অন্য একটি প্রোডাক্টে ইতিমধ্যে ব্যবহার করা হয়েছে।",
                });
            }
        }

        // Slug
        if (productData.slug) {
            const duplicateSlug = await Product.findOne({
                slug: productData.slug,
                _id: { $ne: req.params.id },
            });
            if (duplicateSlug) {
                return res.status(400).json({
                    success: false,
                    message: "এই Slug অন্য একটি প্রোডাক্টে ইতিমধ্যে ব্যবহার করা হয়েছে।",
                });
            }
        }

        // Variant SKU
        if (productData.hasVariants && productData.variants) {
            for (const variant of productData.variants) {
                if (variant.sku) {
                    const duplicateVariantSKU = await Product.findOne({
                        "variants.sku": variant.sku,
                        _id: { $ne: req.params.id },
                    });
                    if (duplicateVariantSKU) {
                        return res.status(400).json({
                            success: false,
                            message: `ভ্যারিয়েন্ট SKU '${variant.sku}' ইতিমধ্যে অন্য প্রোডাক্টে ব্যবহার করা হয়েছে।`,
                        });
                    }
                }
            }
        }

        console.log("Updating product with data:", productData);
        console.log("Bullet Points:", productData.bulletPoints);
        console.log(
            `Variant Info: hasVariants=${productData.hasVariants}, variantCount=${productData.variants?.length || 0}`,
        );

        const product = await Product.findByIdAndUpdate(req.params.id, productData, {
            new: true,
            runValidators: true,
        }).populate("category subCategory");

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Product updated successfully",
            product,
        });
    } catch (error) {
        console.error("Error updating product:", error);

        if (req.file) {
            deleteImageFile("products", req.file.filename);
        }
        if (req.files) {
            req.files.forEach((file) => {
                deleteImageFile("products", file.filename);
            });
        }

        if (error.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid product ID",
            });
        }
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Product with this SKU or slug already exists",
            });
        }

        if (error.message.includes("Percentage discount cannot exceed 100%")) {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }

        res.status(500).json({
            success: false,
            message: "Error updating product",
            error: error.message,
        });
    }
};

export const getProductById = async (req, res) => {
    try {
        const {
            fields = "name,slug,description,basePrice,price,discountType,discountValue,stock,sku,imageGroups,category,subCategory,variants,variantOptions,createdAt,updatedAt,brand,weight,dimensions,shippingClass,attributes,hasVariants,bulletPoints,aplusContent,currency,lowStockAlert,isFeatured,isActive,metaTitle,metaDescription,metaKeywords,extraData",
            includeReviews = "false",
            includeAplus = "false",
        } = req.query;

        // Build select fields dynamically
        let selectFields = fields.split(",");

        selectFields = selectFields.filter((field) => field !== "aplusContentId");
        // Always include essential fields
        const essentialFields = [
            "name",
            "slug",
            "basePrice",
            "price",
            "stock",
            "hasVariants",
            "variants",
            "variantOptions",
        ];

        essentialFields.forEach((field) => {
            if (!selectFields.includes(field)) {
                selectFields.push(field);
            }
        });

        // Remove duplicates
        selectFields = [...new Set(selectFields)];

        // Remove unwanted fields if not requested
        if (includeAplus !== "true" && selectFields.includes("aplusContent")) {
            selectFields = selectFields.filter((field) => field !== "aplusContent");
        }

        console.log("Selecting fields:", selectFields.join(" "));

        // Create query with proper field selection
        const query = Product.findById(req.params.id)
            .select(selectFields.join(" "))
            .populate({
                path: "category",
                select: "name slug _id parentCategory",
            })
            .populate({
                path: "subCategory",
                select: "name slug _id parentCategory",
            });

        // Execute query
        const product = await query.lean();

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        if (includeAplus === "true") {
            const aplusContent = await AplusContent.findOne({
                productId: product._id,
                isActive: true,
            })
                .select("-__v -metaData")
                .lean();

            if (aplusContent) {
                product.aplusContent = aplusContent;
            }
        }

        // Ensure variantOptions is included
        if (
            product.hasVariants &&
            (!product.variantOptions || product.variantOptions.length === 0)
        ) {
            console.log("Variant options missing for variant product, fetching separately...");

            // Fetch variantOptions separately if not included
            const productWithOptions = await Product.findById(req.params.id)
                .select("variantOptions")
                .lean();

            if (productWithOptions && productWithOptions.variantOptions) {
                product.variantOptions = productWithOptions.variantOptions;
            } else {
                product.variantOptions = [];
            }
        }

        // Ensure variants are properly formatted
        if (product.variants && Array.isArray(product.variants)) {
            // Make sure each variant has all required fields
            product.variants = product.variants.map((variant) => ({
                ...variant,
                options: variant.options || [],
                basePrice: variant.basePrice || product.basePrice || 0,
                discountType: variant.discountType || product.discountType || "none",
                discountValue: variant.discountValue || 0,
                price: variant.price || variant.basePrice || product.basePrice || 0,
                stock: variant.stock || 0,
                imageGroupName: variant.imageGroupName || "",
                sku: variant.sku || "",
                _id: variant._id || new mongoose.Types.ObjectId(),
            }));
        }

        // Ensure bulletPoints is an array
        if (product.bulletPoints && !Array.isArray(product.bulletPoints)) {
            if (typeof product.bulletPoints === "string") {
                try {
                    product.bulletPoints = JSON.parse(product.bulletPoints);
                } catch {
                    product.bulletPoints = [product.bulletPoints];
                }
            } else {
                product.bulletPoints = [];
            }
        }

        // Ensure metaKeywords is an array
        if (product.metaKeywords && !Array.isArray(product.metaKeywords)) {
            if (typeof product.metaKeywords === "string") {
                product.metaKeywords = product.metaKeywords
                    .split(",")
                    .map((k) => k.trim())
                    .filter((k) => k);
            } else {
                product.metaKeywords = [];
            }
        }

        // Ensure dimensions object has all properties
        if (!product.dimensions) {
            product.dimensions = {
                length: 0,
                width: 0,
                height: 0,
            };
        } else {
            product.dimensions = {
                length: product.dimensions.length || 0,
                width: product.dimensions.width || 0,
                height: product.dimensions.height || 0,
            };
        }

        // Optimize image groups
        if (product.imageGroups && Array.isArray(product.imageGroups)) {
            product.imageGroups = product.imageGroups.map((group) => ({
                _id: group._id,
                name: group.name || "Main",
                images: (group.images || []).map((img) => ({
                    url: img.url,
                    filename: img.filename,
                    alt: img.alt || group.name,
                })),
            }));
        }

        // Calculate discount
        let discountAmount = 0;
        if (product.discountType === "percentage") {
            discountAmount = (product.basePrice * product.discountValue) / 100;
        } else if (product.discountType === "fixed") {
            discountAmount = product.discountValue;
        }

        product.discountAmount = discountAmount;
        product.isOnSale = product.discountType !== "none" && product.discountValue > 0;
        product.finalPrice = (product.basePrice || 0) - discountAmount;

        // Fetch reviews separately if needed
        if (includeReviews === "true") {
            const reviewsData = await Product.findById(req.params.id)
                .select("reviews averageRating numReviews")
                .populate({
                    path: "reviews.user",
                    select: "name email",
                })
                .lean();
            product.reviews = reviewsData?.reviews || [];
            product.averageRating = reviewsData?.averageRating || 0;
            product.numReviews = reviewsData?.numReviews || 0;
        }

        // Add timestamp and metadata
        product.retrievedAt = new Date().toISOString();
        product.fieldsIncluded = selectFields;

        res.status(200).json({
            success: true,
            product,
            meta: {
                optimized: true,
                timestamp: new Date().toISOString(),
                hasVariants: product.hasVariants || false,
                variantCount: product.variants?.length || 0,
                variantOptionsCount: product.variantOptions?.length || 0,
            },
        });
    } catch (error) {
        console.error("Error in getProductById:", error);

        if (error.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid product ID",
            });
        }

        res.status(500).json({
            success: false,
            message: "Error fetching product",
            error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
        });
    }
};

export const getProductBySlug = async (req, res) => {
    try {
        const { includeAplus = "false" } = req.query;

        const product = await Product.findOne({ slug: req.params.slug })
            .select("-aplusContentId -__v")
            .populate("category subCategory")
            .populate("reviews.user", "name email");

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        let aplusContent = null;
        if (includeAplus === "true") {
            try {
                aplusContent = await AplusContent.findOne({
                    productId: product._id,
                    isActive: true,
                })
                    .select("-__v -metaData")
                    .lean();
            } catch (aplusError) {
                console.log("Error fetching A+ Content:", aplusError.message);
            }
        }

        const productObj = product.toObject();

        // ── Regular (non-campaign) discount ──
        let discountAmount = 0;
        if (productObj.discountType === "percentage") {
            discountAmount = (productObj.basePrice * productObj.discountValue) / 100;
        } else if (productObj.discountType === "fixed") {
            discountAmount = productObj.discountValue;
        }

        let finalPrice = (productObj.basePrice || 0) - discountAmount;
        let isOnSale = productObj.discountType !== "none" && productObj.discountValue > 0;
        let isUnderValidCampaign = false;
        let campaignInfo = null;

        // ── Active campaign discount (takes priority) ──
        const camp = productObj.campaignDiscount;
        if (camp && camp.isActive) {
            const now = new Date();
            const startOk = !camp.startDate || new Date(camp.startDate) <= now;
            const endOk = !camp.endDate || new Date(camp.endDate) >= now;

            if (startOk && endOk) {
                const campaignPrice =
                    camp.campaignPrice !== undefined && camp.campaignPrice !== null
                        ? camp.campaignPrice
                        : camp.discountType === "percentage"
                          ? Math.max(
                                0,
                                productObj.basePrice -
                                    (productObj.basePrice * camp.discountValue) / 100,
                            )
                          : camp.discountType === "fixed"
                            ? Math.max(0, productObj.basePrice - camp.discountValue)
                            : productObj.basePrice;

                finalPrice = campaignPrice;
                isOnSale = true;
                isUnderValidCampaign = true;
                discountAmount = productObj.basePrice - campaignPrice;

                campaignInfo = {
                    campaignId: camp.campaignId,
                    campaignName: camp.campaignName,
                    discountType: camp.discountType,
                    discountValue: camp.discountValue,
                    campaignPrice,
                    startDate: camp.startDate,
                    endDate: camp.endDate,
                };
            }
        }

        productObj.discountAmount = discountAmount;
        productObj.isOnSale = isOnSale;
        productObj.finalPrice = finalPrice;
        productObj.isUnderValidCampaign = isUnderValidCampaign;
        productObj.campaignInfo = campaignInfo;

        if (aplusContent) {
            productObj.aplusContent = aplusContent;
        }

        res.status(200).json({
            success: true,
            product: productObj,
        });
    } catch (error) {
        console.error("Error fetching product by slug:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching product",
            error: error.message,
        });
    }
};
// Delete a product
export const deleteProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        if (product.imageGroups && product.imageGroups.length > 0) {
            product.imageGroups.forEach((group) => {
                if (group.images && group.images.length > 0) {
                    group.images.forEach((image) => {
                        if (image.url) {
                            const filename = image.url.split("/").pop();
                            deleteImageFile("products", filename);
                        }
                    });
                }
            });
        }

        if (product.videos && product.videos.length > 0) {
            product.videos.forEach((video) => {
                if (video.url) {
                    const filename = video.url.split("/").pop();
                    deleteImageFile("products", filename);
                }
            });
        }
        await Product.findByIdAndDelete(req.params.id);

        res.status(200).json({
            success: true,
            message: "Product and all associated files deleted successfully",
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid product ID",
            });
        }
        res.status(500).json({
            success: false,
            message: "Error deleting product",
            error: error.message,
        });
    }
};

// Add review to a product
export const addReview = async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const userId = req.user._id;

        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        // Check if user already reviewed this product
        const alreadyReviewed = product.reviews.find(
            (review) => review.user.toString() === userId.toString(),
        );

        if (alreadyReviewed) {
            return res.status(400).json({
                success: false,
                message: "You have already reviewed this product",
            });
        }

        // Add review
        product.reviews.push({
            user: userId,
            rating,
            comment,
        });

        // Update average rating and number of reviews
        product.numReviews = product.reviews.length;
        product.averageRating =
            product.reviews.reduce((acc, item) => item.rating + acc, 0) / product.reviews.length;

        await product.save();
        await product.populate("reviews.user", "name email");

        res.status(201).json({
            success: true,
            message: "Review added successfully",
            product,
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid product ID",
            });
        }
        res.status(500).json({
            success: false,
            message: "Error adding review",
            error: error.message,
        });
    }
};

// Get featured products
// @desc    Products at or below their own low stock threshold
// @route   GET /api/admin/products/low-stock
// @access  Private/Admin
//
// PHASE 9: getAdminProducts filters by search, category and discountType but has
// no stock filter, and this comparison cannot be expressed as one anyway: the
// threshold is per product (`lowStockAlert`), so it is a field-to-field
// comparison that needs $expr rather than a literal value.
//
// Variants complicate it. A product with variants carries its sellable stock on
// each variant row, and the parent `stock` is often 0 and meaningless. So the
// effective stock is the SUM of variant stock when variants exist, and the
// parent stock otherwise.
export const getLowStockProducts = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

        const products = await Product.aggregate([
            { $match: { isActive: true } },
            {
                $addFields: {
                    effectiveStock: {
                        $cond: [
                            { $and: [{ $eq: ["$hasVariants", true] }, { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] }] },
                            { $sum: "$variants.stock" },
                            { $ifNull: ["$stock", 0] },
                        ],
                    },
                    threshold: { $ifNull: ["$lowStockAlert", 5] },
                },
            },
            { $match: { $expr: { $lte: ["$effectiveStock", "$threshold"] } } },
            // Out of stock first, then closest to running out.
            { $sort: { effectiveStock: 1, name: 1 } },
            { $limit: limit },
            {
                $project: {
                    name: 1,
                    slug: 1,
                    sku: 1,
                    effectiveStock: 1,
                    threshold: 1,
                    hasVariants: 1,
                    imageGroups: { $slice: ["$imageGroups", 1] },
                },
            },
        ]);

        res.status(200).json({
            success: true,
            count: products.length,
            products,
        });
    } catch (error) {
        console.error("Low stock query error:", error.message);
        res.status(500).json({
            success: false,
            message: "Error fetching low stock products",
        });
    }
};

export const getFeaturedProducts = async (req, res) => {
    try {
        const products = await Product.find({
            isFeatured: true,
            isActive: true,
        })
            .populate("category subCategory")
            .limit(10);

        // Campaign-aware pricing, same resolver as getProducts, so a featured
        // product inside a live campaign shows its campaign price here too.
        const productsWithDiscount = products.map((product) => {
            const productObj = product.toObject();
            return { ...productObj, ...resolveCampaignPricing(productObj) };
        });

        res.status(200).json({
            success: true,
            products: productsWithDiscount,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching featured products",
            error: error.message,
        });
    }
};

// Update product stock
export const updateStock = async (req, res) => {
    try {
        const { quantity } = req.body;
        const qty = parseInt(quantity);

        const filter = { _id: req.params.id };
        if (qty < 0) filter.stock = { $gte: -qty }; // block oversell on decrements

        const product = await Product.findOneAndUpdate(
            filter,
            { $inc: { stock: qty } },
            { new: true },
        );

        if (!product) {
            const exists = await Product.exists({ _id: req.params.id });
            return res.status(exists ? 400 : 404).json({
                success: false,
                message: exists ? "Insufficient stock" : "Product not found",
            });
        }
        res.status(200).json({
            success: true,
            message: "Stock updated successfully",
            product,
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(400).json({
                success: false,
                message: "Invalid product ID",
            });
        }
        res.status(500).json({
            success: false,
            message: "Error updating stock",
            error: error.message,
        });
    }
};

// Get products by dynamic attributes
export const getProductsByAttributes = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 12,
            search,
            category,
            minPrice,
            maxPrice,
            inStock,
            onSale,
            sortBy = "createdAt",
            sortOrder = "desc",
        } = req.query;

        // Attributes ফিল্টার - query parameters থেকে attributes পড়া
        const attributesFilter = {};
        Object.keys(req.query).forEach((key) => {
            if (key.startsWith("attr_")) {
                const attributeKey = key.replace("attr_", "");
                attributesFilter[`attributes.key`] = attributeKey;
                attributesFilter[`attributes.value`] = req.query[key];
            }
        });

        const limitInt = parseInt(limit);
        const pageInt = parseInt(page);
        const skip = (pageInt - 1) * limitInt;

        // ১. ফিল্টার অবজেক্ট তৈরি
        let filter = { isActive: true };

        // Attributes ফিল্টার প্রয়োগ
        if (Object.keys(attributesFilter).length > 0) {
            filter["attributes"] = {
                $elemMatch: {
                    key: attributesFilter[`attributes.key`],
                    value: attributesFilter[`attributes.value`],
                },
            };
        }

        // অন্যান্য ফিল্টার
        if (category) {
            filter.$or = [{ category: category }, { subCategory: category }];
        }

        if (minPrice || maxPrice) {
            filter.price = {};
            if (minPrice) filter.price.$gte = parseFloat(minPrice);
            if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
        }

        if (inStock === "true") {
            filter.stock = { $gt: 0 };
        }

        // Updated onSale filter
        if (onSale === "true") {
            filter.discountType = { $ne: "none" };
            filter.discountValue = { $gt: 0 };
        }

        // ২. সার্চ অপটিমাইজেশন
        let sortOptions = {};
        if (sortBy && sortOrder) {
            sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;
        }

        if (search) {
            filter.$text = { $search: search };
            sortOptions.score = { $meta: "textScore" };
        }

        // ৩. মোট প্রোডাক্ট সংখ্যা গণনা
        const totalProducts = await Product.countDocuments(filter);
        const totalPages = Math.ceil(totalProducts / limitInt);

        // ৪. কোয়েরি চালানো এবং প্রোজেকশন
        const products = await Product.find(filter)
            .select(
                "name slug price basePrice discountType discountValue imageGroups averageRating numReviews stock hasVariants category subCategory attributes",
            )
            .populate({
                path: "category",
                select: "name slug parentCategory",
                populate: {
                    path: "parentCategory",
                    select: "name slug parentCategory",
                    populate: { path: "parentCategory", select: "name slug" },
                },
            })
            .populate({
                path: "subCategory",
                select: "name slug parentCategory",
                populate: {
                    path: "parentCategory",
                    select: "name slug parentCategory",
                    populate: { path: "parentCategory", select: "name slug" },
                },
            })
            .sort(sortOptions)
            .skip(skip)
            .limit(limitInt);

        // Calculate discount amounts
        const productsWithDiscount = products.map((product) => {
            const productObj = product.toObject();

            let discountAmount = 0;
            if (productObj.discountType === "percentage") {
                discountAmount = (productObj.basePrice * productObj.discountValue) / 100;
            } else if (productObj.discountType === "fixed") {
                discountAmount = productObj.discountValue;
            }

            productObj.discountAmount = discountAmount;
            productObj.isOnSale =
                productObj.discountType !== "none" && productObj.discountValue > 0;

            return productObj;
        });

        // ৫. রেসপন্স পাঠানো
        res.status(200).json({
            success: true,
            products: productsWithDiscount,
            total: totalProducts,
            totalPages: totalPages,
            currentPage: pageInt,
            limit: limitInt,
            filter: Object.keys(attributesFilter).length > 0 ? attributesFilter : null,
        });
    } catch (error) {
        console.error("Error fetching products by attributes:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching products",
            error: error.message,
        });
    }
};

// Get available attribute keys and values for filtering
export const getProductAttributes = async (req, res) => {
    try {
        const activeProducts = await Product.find({ isActive: true }).select("attributes").lean();

        const attributesMap = {};

        activeProducts.forEach((product) => {
            if (product.attributes && Array.isArray(product.attributes)) {
                product.attributes.forEach((attr) => {
                    if (attr.key && attr.value) {
                        if (!attributesMap[attr.key]) {
                            attributesMap[attr.key] = new Set();
                        }
                        attributesMap[attr.key].add(attr.value);
                    }
                });
            }
        });

        // Convert Sets to Arrays
        const attributes = {};
        Object.keys(attributesMap).forEach((key) => {
            attributes[key] = Array.from(attributesMap[key]);
        });

        res.status(200).json({
            success: true,
            attributes,
            totalAttributes: Object.keys(attributes).length,
        });
    } catch (error) {
        console.error("Error fetching product attributes:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching product attributes",
            error: error.message,
        });
    }
};

// Get products by multiple attributes (advanced filtering)
export const getProductsByMultipleAttributes = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 12,
            attributes = "{}", // JSON string
        } = req.query;

        let attributesFilter;
        try {
            attributesFilter = JSON.parse(attributes);
        } catch (error) {
            return res.status(400).json({
                success: false,
                message: "Invalid attributes format. Please provide valid JSON.",
            });
        }

        const limitInt = parseInt(limit);
        const pageInt = parseInt(page);
        const skip = (pageInt - 1) * limitInt;

        let filter = { isActive: true };

        if (attributesFilter && Object.keys(attributesFilter).length > 0) {
            filter.$and = Object.keys(attributesFilter).map((key) => ({
                attributes: {
                    $elemMatch: {
                        key: key,
                        value: attributesFilter[key],
                    },
                },
            }));
        }

        const totalProducts = await Product.countDocuments(filter);
        const totalPages = Math.ceil(totalProducts / limitInt);

        const products = await Product.find(filter)
            .select(
                "name slug price basePrice discountType discountValue imageGroups averageRating numReviews stock hasVariants category subCategory attributes",
            )
            .populate({
                path: "category",
                select: "name slug",
            })
            .populate({
                path: "subCategory",
                select: "name slug",
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitInt);

        // Calculate discount amounts
        const productsWithDiscount = products.map((product) => {
            const productObj = product.toObject();

            let discountAmount = 0;
            if (productObj.discountType === "percentage") {
                discountAmount = (productObj.basePrice * productObj.discountValue) / 100;
            } else if (productObj.discountType === "fixed") {
                discountAmount = productObj.discountValue;
            }

            productObj.discountAmount = discountAmount;
            productObj.isOnSale =
                productObj.discountType !== "none" && productObj.discountValue > 0;

            return productObj;
        });

        res.status(200).json({
            success: true,
            products: productsWithDiscount,
            total: totalProducts,
            totalPages: totalPages,
            currentPage: pageInt,
            limit: limitInt,
            appliedFilters: attributesFilter,
        });
    } catch (error) {
        console.error("Error fetching products by multiple attributes:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching products",
            error: error.message,
        });
    }
};

// Get products for dynamic section
export const getProductsForDynamicSection = async (req, res) => {
    try {
        const { sectionId } = req.params;

        // Find the section
        const section = await DynamicSection.findById(sectionId);

        if (!section) {
            return res.status(404).json({
                success: false,
                message: "Section not found",
            });
        }

        if (!section.isActive) {
            return res.status(200).json({
                success: true,
                section: {
                    _id: section._id,
                    title: section.title,
                    description: section.description,
                    isActive: false,
                },
                products: [],
            });
        }

        // Build filter based on section configuration
        let filter = {
            isActive: true,
        };

        // Attribute based filtering
        if (section.sectionType === "attribute-based") {
            filter["attributes"] = {
                $elemMatch: {
                    key: section.attributeKey,
                    value: section.attributeValue,
                },
            };
        }

        // Sort options
        const sortOptions = {};
        sortOptions[section.sortBy] = section.sortOrder === "asc" ? 1 : -1;

        // Execute query
        const products = await Product.find(filter)
            .select(
                "name slug price basePrice discountType discountValue imageGroups averageRating numReviews stock hasVariants",
            )
            .populate("category", "name slug")
            .populate("subCategory", "name slug")
            .sort(sortOptions)
            .limit(section.productLimit);

        // Calculate discount amounts
        const productsWithDiscount = products.map((product) => {
            const productObj = product.toObject();

            let discountAmount = 0;
            if (productObj.discountType === "percentage") {
                discountAmount = (productObj.basePrice * productObj.discountValue) / 100;
            } else if (productObj.discountType === "fixed") {
                discountAmount = productObj.discountValue;
            }

            productObj.discountAmount = discountAmount;
            productObj.isOnSale =
                productObj.discountType !== "none" && productObj.discountValue > 0;

            return productObj;
        });

        res.status(200).json({
            success: true,
            section: {
                _id: section._id,
                title: section.title,
                description: section.description,
                backgroundColor: section.backgroundColor,
                textColor: section.textColor,
                productLimit: section.productLimit,
            },
            products: productsWithDiscount,
            totalProducts: products.length,
        });
    } catch (error) {
        console.error("Error fetching dynamic section products:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching section products",
            error: error.message,
        });
    }
};

// Get all active sections for homepage
export const getHomepageSections = async (req, res) => {
    try {
        console.log("Fetching homepage sections...");

        const sections = await DynamicSection.find({
            isActive: true,
            showInHomepage: true,
        })
            .sort({ displayOrder: 1, createdAt: -1 })
            .select(
                "title description attributeKey attributeValue productLimit backgroundColor textColor sectionType sortBy sortOrder isActive displayOrder showInHomepage",
            )
            .lean();

        console.log("Found sections:", sections.length);

        // Get products for each section
        const sectionsWithProducts = await Promise.all(
            sections.map(async (section) => {
                let filter = { isActive: true };

                console.log(
                    `Processing section: ${section.title} - ${section.attributeKey}=${section.attributeValue}, Active: ${section.isActive}`,
                );

                if (section.sectionType === "attribute-based") {
                    filter["attributes"] = {
                        $elemMatch: {
                            key: section.attributeKey,
                            value: section.attributeValue,
                        },
                    };
                }

                const sortOptions = {};
                sortOptions[section.sortBy || "createdAt"] =
                    (section.sortOrder || "desc") === "asc" ? 1 : -1;

                const products = await Product.find(filter)
                    .select(
                        "name slug price basePrice discountType discountValue imageGroups averageRating numReviews stock hasVariants isUnderCampaign campaignDiscount",
                    )
                    .populate("category", "name slug")
                    .populate("subCategory", "name slug")
                    .sort(sortOptions)
                    .limit(section.productLimit || 8)
                    .lean();

                // Campaign-aware pricing, same resolver as getProducts, so a
                // section product inside a live campaign shows its campaign price.
                const productsWithDiscount = products.map((product) => ({
                    ...product,
                    ...resolveCampaignPricing(product),
                }));

                console.log(`Found ${products.length} products for section: ${section.title}`);

                return {
                    ...section,
                    products: productsWithDiscount,
                    totalProducts: products.length,
                    isActive: section.isActive !== undefined ? section.isActive : true,
                };
            }),
        );

        console.log(
            "Sending response with sections:",
            sectionsWithProducts.map((s) => ({
                title: s.title,
                isActive: s.isActive,
                products: s.products.length,
            })),
        );

        res.status(200).json({
            success: true,
            sections: sectionsWithProducts,
        });
    } catch (error) {
        console.error("Error fetching homepage sections:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching homepage sections",
            error: error.message,
        });
    }
};

// CRUD operations for dynamic sections
export const createDynamicSection = async (req, res) => {
    try {
        const {
            title,
            description,
            attributeKey,
            attributeValue,
            productLimit = 8,
            sortBy = "createdAt",
            sortOrder = "desc",
            displayOrder = 0,
            backgroundColor = "#ffffff",
            textColor = "#000000",
        } = req.body;

        // Check if a section with the same attribute pair already exists.
        // FIX: previously only guarded against active duplicates — an inactive
        // section with the same key/value let a second (active) twin be
        // created, producing duplicate homepage sections once re-enabled.
        const existingSection = await DynamicSection.findOne({
            attributeKey,
            attributeValue,
        });

        if (existingSection) {
            return res.status(400).json({
                success: false,
                message: existingSection.isActive
                    ? "A section with this attribute already exists"
                    : "A deactivated section with this attribute already exists — edit or reactivate it instead",
            });
        }

        const section = new DynamicSection({
            title,
            description,
            attributeKey,
            attributeValue,
            productLimit,
            sortBy,
            sortOrder,
            displayOrder,
            backgroundColor,
            textColor,
            createdBy: req.user._id,
        });

        const savedSection = await section.save();

        res.status(201).json({
            success: true,
            message: "Dynamic section created successfully",
            section: savedSection,
        });
    } catch (error) {
        console.error("Error creating dynamic section:", error);
        res.status(500).json({
            success: false,
            message: "Error creating dynamic section",
            error: error.message,
        });
    }
};

export const updateDynamicSection = async (req, res) => {
    try {
        const { sectionId } = req.params;

        const section = await DynamicSection.findByIdAndUpdate(
            sectionId,
            { ...req.body },
            { new: true, runValidators: true },
        );

        if (!section) {
            return res.status(404).json({
                success: false,
                message: "Section not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Section updated successfully",
            section,
        });
    } catch (error) {
        console.error("Error updating dynamic section:", error);
        res.status(500).json({
            success: false,
            message: "Error updating dynamic section",
            error: error.message,
        });
    }
};

export const deleteDynamicSection = async (req, res) => {
    try {
        const { sectionId } = req.params;

        const section = await DynamicSection.findByIdAndDelete(sectionId);

        if (!section) {
            return res.status(404).json({
                success: false,
                message: "Section not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "Section deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting dynamic section:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting dynamic section",
            error: error.message,
        });
    }
};

export const getAllDynamicSections = async (req, res) => {
    try {
        const { page = 1, limit = 10, isActive } = req.query;

        const filter = {};
        if (isActive !== undefined) {
            filter.isActive = isActive === "true";
        }

        const sections = await DynamicSection.find(filter)
            .populate("createdBy", "name email")
            .sort({ displayOrder: 1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();

        const total = await DynamicSection.countDocuments(filter);

        // Attach the live matched-product count per section so the admin list
        // can show "N products" without an N+1 round-trip from the client.
        // Mirrors the exact filter the storefront uses in
        // getProductsForDynamicSection (attribute-based → attributes elemMatch).
        const sectionsWithCount = await Promise.all(
            sections.map(async (section) => {
                const productFilter = { isActive: true };
                if (section.sectionType === "attribute-based") {
                    productFilter.attributes = {
                        $elemMatch: {
                            key: section.attributeKey,
                            value: section.attributeValue,
                        },
                    };
                } else if (section.sectionType === "manual") {
                    productFilter._id = { $in: section.customProducts || [] };
                }
                const matchedProducts = await Product.countDocuments(productFilter);
                return { ...section, matchedProducts };
            }),
        );

        res.status(200).json({
            success: true,
            sections: sectionsWithCount,
            totalPages: Math.ceil(total / limit),
            currentPage: Number(page),
            total,
        });
    } catch (error) {
        console.error("Error fetching dynamic sections:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching dynamic sections",
            error: error.message,
        });
    }
};

export const toggleSectionStatus = async (req, res) => {
    try {
        const { sectionId } = req.params;

        const section = await DynamicSection.findById(sectionId);

        if (!section) {
            return res.status(404).json({
                success: false,
                message: "Section not found",
            });
        }

        section.isActive = !section.isActive;
        await section.save();

        res.status(200).json({
            success: true,
            message: `Section ${section.isActive ? "activated" : "deactivated"} successfully`,
            section,
        });
    } catch (error) {
        console.error("Error toggling section status:", error);
        res.status(500).json({
            success: false,
            message: "Error toggling section status",
            error: error.message,
        });
    }
};

export const searchProductsForAdmin = async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) {
        return res.status(200).json({ success: true, products: [] });
    }
    try {
        // FIX: `q` is user input and was interpolated into a regex unescaped,
        // unlike every other search in this file. That allows both a
        // catastrophic-backtracking DoS and unintended matching. escapeRegex is
        // already imported at the top and used by getAdminProducts.
        const safe = escapeRegex(q);
        const products = await Product.find({
            $or: [
                { name: { $regex: safe, $options: "i" } },
                { sku: { $regex: safe, $options: "i" } },
            ],
        })
            .select(
                "_id name basePrice discountType discountValue price variants hasVariants imageGroups mainImage sku",
            )
            .limit(20);

        // Calculate discount amounts
        const productsWithDiscount = products.map((product) => {
            const productObj = product.toObject();

            let discountAmount = 0;
            if (productObj.discountType === "percentage") {
                discountAmount = (productObj.basePrice * productObj.discountValue) / 100;
            } else if (productObj.discountType === "fixed") {
                discountAmount = productObj.discountValue;
            }

            productObj.discountAmount = discountAmount;
            productObj.isOnSale =
                productObj.discountType !== "none" && productObj.discountValue > 0;
            return productObj;
        });

        res.status(200).json({ success: true, products: productsWithDiscount });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error during product search" });
    }
};

// New: Bulk update product discounts
export const bulkUpdateDiscounts = async (req, res) => {
    try {
        const { productIds, discountType, discountValue } = req.body;

        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide product IDs",
            });
        }

        if (discountType === "percentage" && discountValue > 100) {
            return res.status(400).json({
                success: false,
                message: "Percentage discount cannot exceed 100%",
            });
        }

        // Update multiple products
        const result = await Product.updateMany(
            { _id: { $in: productIds } },
            {
                discountType: discountType || "none",
                discountValue: parseFloat(discountValue) || 0,
            },
        );

        res.status(200).json({
            success: true,
            message: `Discounts updated for ${result.modifiedCount} products`,
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        console.error("Error bulk updating discounts:", error);
        res.status(500).json({
            success: false,
            message: "Error bulk updating discounts",
            error: error.message,
        });
    }
};

// New: Get products with specific discount type
export const getProductsByDiscountType = async (req, res) => {
    try {
        const { discountType, page = 1, limit = 12 } = req.query;

        if (!discountType || !["percentage", "fixed"].includes(discountType)) {
            return res.status(400).json({
                success: false,
                message: "Invalid discount type. Must be 'percentage' or 'fixed'",
            });
        }

        const limitInt = parseInt(limit);
        const pageInt = parseInt(page);
        const skip = (pageInt - 1) * limitInt;

        const filter = {
            isActive: true,
            discountType: discountType,
            discountValue: { $gt: 0 },
        };

        const totalProducts = await Product.countDocuments(filter);
        const totalPages = Math.ceil(totalProducts / limitInt);

        const products = await Product.find(filter)
            .select(
                "name slug price basePrice discountType discountValue imageGroups averageRating numReviews stock hasVariants",
            )
            .populate("category", "name slug")
            .populate("subCategory", "name slug")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitInt);

        // Calculate discount amounts
        const productsWithDiscount = products.map((product) => {
            const productObj = product.toObject();

            let discountAmount = 0;
            if (productObj.discountType === "percentage") {
                discountAmount = (productObj.basePrice * productObj.discountValue) / 100;
            } else if (productObj.discountType === "fixed") {
                discountAmount = productObj.discountValue;
            }

            productObj.discountAmount = discountAmount;
            productObj.isOnSale = true;

            return productObj;
        });

        res.status(200).json({
            success: true,
            products: productsWithDiscount,
            total: totalProducts,
            totalPages: totalPages,
            currentPage: pageInt,
            limit: limitInt,
            discountType: discountType,
        });
    } catch (error) {
        console.error("Error fetching products by discount type:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching products",
            error: error.message,
        });
    }
};

// Get related products by category/tags getRelatedProducts function update
export const getRelatedProducts = async (req, res) => {
    try {
        const { productId, categoryId, limit = 4 } = req.query;
        let categoryObjectId = categoryId;

        if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
            if (categoryId.length === 24) {
                // MongoDB ObjectId length 24 characters
                categoryObjectId = new mongoose.Types.ObjectId(categoryId);
            }
        }

        if (productId && !categoryObjectId) {
            const product = await Product.findById(productId)
                .select("category subCategory attributes")
                .lean();

            if (product) {
                categoryObjectId = product.category;
            }
        }

        if (!categoryObjectId) {
            return res.status(400).json({
                success: false,
                message: "Category ID is required",
            });
        }

        const filter = {
            isActive: true,
            category: categoryObjectId,
        };

        if (productId) {
            filter._id = { $ne: productId };
        }

        const relatedProducts = await Product.find(filter)
            .select(
                "name slug price basePrice discountType discountValue thumbnail averageRating numReviews imageGroups",
            )
            .populate("category", "name slug")
            .limit(parseInt(limit))
            .sort({ isFeatured: -1, averageRating: -1, createdAt: -1 })
            .lean();

        const productsWithDiscount = relatedProducts.map((product) => {
            let discountAmount = 0;
            if (product.discountType === "percentage") {
                discountAmount = (product.basePrice * product.discountValue) / 100;
            } else if (product.discountType === "fixed") {
                discountAmount = product.discountValue;
            }

            return {
                ...product,
                discountAmount,
                isOnSale: product.discountType !== "none" && product.discountValue > 0,
                finalPrice: (product.basePrice || 0) - discountAmount,
            };
        });

        res.status(200).json({
            success: true,
            products: productsWithDiscount,
            total: productsWithDiscount.length,
        });
    } catch (error) {
        console.error("Error fetching related products:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching related products",
            error: error.message,
        });
    }
};

// Reorder products (Admin only)
export const reorderProducts = async (req, res) => {
    try {
        const { products } = req.body; // Array of { productId, displayOrder }

        if (!Array.isArray(products) || products.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide products array with productId and displayOrder",
            });
        }

        const bulkOps = products.map((item) => ({
            updateOne: {
                filter: { _id: item.productId },
                update: { displayOrder: item.displayOrder },
            },
        }));

        const result = await Product.bulkWrite(bulkOps);

        res.status(200).json({
            success: true,
            message: "Products reordered successfully",
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        console.error("Error reordering products:", error);
        res.status(500).json({
            success: false,
            message: "Error reordering products",
            error: error.message,
        });
    }
};

// Bulk update display orders by category
export const bulkUpdateCategoryOrders = async (req, res) => {
    try {
        const { categoryId, products } = req.body; // products array with productId and displayOrder

        if (!categoryId || !Array.isArray(products)) {
            return res.status(400).json({
                success: false,
                message: "Please provide categoryId and products array",
            });
        }

        const bulkOps = products.map((item, index) => ({
            updateOne: {
                filter: { _id: item.productId, category: categoryId },
                update: {
                    $set: {
                        displayOrder: item.displayOrder || index + 1,
                        [`categoryDisplayOrder.${categoryId}`]: item.displayOrder || index + 1,
                    },
                },
            },
        }));

        const result = await Product.bulkWrite(bulkOps);

        res.status(200).json({
            success: true,
            message: "Category products reordered successfully",
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        console.error("Error updating category orders:", error);
        res.status(500).json({
            success: false,
            message: "Error updating category orders",
            error: error.message,
        });
    }
};

// Increment view count when product is viewed
export const incrementProductView = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await Product.findByIdAndUpdate(
            id,
            { $inc: { viewCount: 1 } },
            { new: true },
        );

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        res.status(200).json({
            success: true,
            viewCount: product.viewCount,
        });
    } catch (error) {
        console.error("Error incrementing view count:", error);
        res.status(500).json({
            success: false,
            message: "Error incrementing view count",
            error: error.message,
        });
    }
};

// Get products with custom ordering
export const getOrderedProducts = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            orderBy = "displayOrder",
            orderDirection = "asc",
            categoryId = null,
            minPrice,
            maxPrice,
            inStock,
            onSale,
        } = req.query;

        let filter = { isActive: true };

        if (categoryId) {
            filter.category = categoryId;
        }

        if (minPrice || maxPrice) {
            filter.price = {};
            if (minPrice) filter.price.$gte = parseFloat(minPrice);
            if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
        }

        if (inStock === "true") {
            filter.stock = { $gt: 0 };
        }

        if (onSale === "true") {
            filter.discountType = { $ne: "none" };
            filter.discountValue = { $gt: 0 };
        }

        let sortOptions = {};

        switch (orderBy) {
            case "displayOrder":
                sortOptions = { displayOrder: orderDirection === "desc" ? -1 : 1, createdAt: -1 };
                break;
            case "newest":
                sortOptions = { publishDate: orderDirection === "desc" ? -1 : 1, createdAt: -1 };
                break;
            case "price":
                sortOptions = { price: orderDirection === "desc" ? -1 : 1 };
                break;
            case "popularity":
                sortOptions = { purchaseCount: orderDirection === "desc" ? -1 : 1 };
                break;
            case "rating":
                sortOptions = { averageRating: orderDirection === "desc" ? -1 : 1 };
                break;
            default:
                sortOptions = { displayOrder: -1, createdAt: -1 };
        }

        const limitInt = parseInt(limit);
        const pageInt = parseInt(page);
        const skip = (pageInt - 1) * limitInt;

        const products = await Product.find(filter)
            .sort(sortOptions)
            .skip(skip)
            .limit(limitInt)
            .select(
                "name slug price basePrice discountType discountValue imageGroups averageRating numReviews stock displayOrder purchaseCount",
            )
            .lean();

        const total = await Product.countDocuments(filter);

        // Calculate final prices
        const productsWithPrices = products.map((product) => {
            let discountAmount = 0;
            if (product.discountType === "percentage") {
                discountAmount = (product.basePrice * product.discountValue) / 100;
            } else if (product.discountType === "fixed") {
                discountAmount = product.discountValue;
            }

            return {
                ...product,
                discountAmount,
                isOnSale: product.discountType !== "none" && product.discountValue > 0,
                finalPrice: product.basePrice - discountAmount,
            };
        });

        res.status(200).json({
            success: true,
            products: productsWithPrices,
            total,
            page: pageInt,
            limit: limitInt,
            totalPages: Math.ceil(total / limitInt),
        });
    } catch (error) {
        console.error("Error fetching ordered products:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching products",
            error: error.message,
        });
    }
};

// Get next available display order for a category
export const getNextDisplayOrder = async (req, res) => {
    try {
        const { categoryId } = req.params;

        let query = {};
        if (categoryId && categoryId !== "null") {
            query.category = categoryId;
        }

        const maxOrder = await Product.findOne(query)
            .sort({ displayOrder: -1 })
            .select("displayOrder")
            .lean();

        const nextOrder = (maxOrder?.displayOrder || 0) + 1;

        res.status(200).json({
            success: true,
            nextDisplayOrder: nextOrder,
        });
    } catch (error) {
        console.error("Error getting next display order:", error);
        res.status(500).json({
            success: false,
            message: "Error getting next display order",
            error: error.message,
        });
    }
};
