import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
    {
        url: { type: String, required: true },
        public_id: { type: String },
        filename: { type: String },
        alt: { type: String, trim: true },
        size: { type: Number },
        mimetype: { type: String },
    },
    { _id: false },
);

const optionSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            default: "Color",
        },
        values: [{ type: String, trim: true, required: true }],
    },
    { _id: false },
);

const variantSchema = new mongoose.Schema(
    {
        options: [
            {
                name: { type: String, trim: true, required: true },
                value: { type: String, trim: true, required: true },
                _id: false,
            },
        ],
        basePrice: { type: Number, min: 0 },
        discountType: {
            type: String,
            enum: ["none", "percentage", "fixed"],
            default: "none",
        },
        discountValue: {
            type: Number,
            default: 0,
            min: 0,
            validate: {
                validator: function (value) {
                    if (this.discountType === "percentage") {
                        return value <= 100;
                    }
                    return true;
                },
                message: "Percentage discount cannot exceed 100%",
            },
        },
        price: { type: Number, min: 0, default: 0 },
        stock: { type: Number, min: 0, default: 0 },
        imageGroupName: { type: String, trim: true },
        sku: { type: String, sparse: true },
        // Variant level ordering
        order: { type: Number, default: 0 },
    },
    { _id: false },
);

const productSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Product name is required"],
            trim: true,
            maxlength: [200, "Product name cannot exceed 200 characters"],
        },
        slug: {
            type: String,
            unique: true,
            lowercase: true,
            index: true,
        },
        description: { type: String, trim: true },
        aplusContentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AplusContent",
        },
        bulletPoints: [
            {
                type: String,
                trim: true,
                maxlength: [1700, "Bullet point cannot exceed 1700 characters"],
            },
        ],
        brand: { type: String, trim: true, default: "Generic" },
        sku: { type: String, unique: true, sparse: true },
        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            required: [true, "Category is required"],
        },
        subCategory: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
        basePrice: {
            type: Number,
            required: [true, "Base price is required"],
            min: [0, "Price cannot be negative"],
        },
        discountType: {
            type: String,
            enum: ["none", "percentage", "fixed"],
            default: "none",
        },
        discountValue: {
            type: Number,
            default: 0,
            min: 0,
            validate: {
                validator: function (value) {
                    if (this.discountType === "percentage") {
                        return value <= 100;
                    }
                    return true;
                },
                message: "Percentage discount cannot exceed 100%",
            },
        },
        price: { type: Number, min: 0 },
        currency: { type: String, default: "USD" },
        isUnderCampaign: {
            type: Boolean,
            default: false,
        },
        activeCampaignId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ProductCampaign",
            default: null,
        },
        campaignDiscount: {
            isActive: { type: Boolean, default: false },
            campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductCampaign" },
            campaignName: { type: String },
            discountType: { type: String, enum: ["percentage", "fixed", "none"], default: "none" },
            discountValue: { type: Number, default: 0 },
            campaignPrice: { type: Number },
            startDate: { type: Date },
            endDate: { type: Date },
        },
        originalDiscount: {
            discountType: { type: String, enum: ["percentage", "fixed", "none"], default: "none" },
            discountValue: { type: Number, default: 0 },
            price: { type: Number },
        },
        stock: {
            type: Number,
            required: [true, "Stock is required"],
            min: [0, "Stock cannot be negative"],
        },
        lowStockAlert: { type: Number, default: 5, min: 0 },
        isFeatured: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },

        // ============= ORDER SYSTEM ADDED =============
        // Product order/priority for display
        displayOrder: {
            type: Number,
            default: 0,
            index: true,
            description: "Higher number means higher priority in display",
        },

        // Manual ordering type
        orderType: {
            type: String,
            enum: ["manual", "newest", "price_asc", "price_desc", "popularity", "rating"],
            default: "manual",
            description: "Determines how products are ordered in listings",
        },

        // For popularity tracking
        viewCount: {
            type: Number,
            default: 0,
            min: 0,
        },

        purchaseCount: {
            type: Number,
            default: 0,
            min: 0,
        },

        // For category-specific ordering
        categoryDisplayOrder: {
            type: Map,
            of: Number,
            default: {},
            description: "Custom order per category - key: categoryId, value: order number",
        },

        // Priority boost (for featured products within normal listings)
        priorityBoost: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
            description: "Extra priority score that adds to order calculation",
        },

        // Time-based ordering support
        publishDate: {
            type: Date,
            default: Date.now,
            index: true,
        },

        // Custom sortable fields
        sortableFields: {
            type: Map,
            of: mongoose.Schema.Types.Mixed,
            default: {},
            description: "Custom sortable fields for dynamic ordering",
        },
        // ============= END ORDER SYSTEM =============

        imageGroups: [
            {
                name: { type: String, required: true, trim: true },
                images: [imageSchema],
            },
        ],
        videos: [{ url: String, public_id: String }],
        attributes: [
            {
                key: { type: String, required: true, trim: true },
                value: { type: String, required: true, trim: true },
            },
        ],
        variantOptions: [optionSchema],
        hasVariants: { type: Boolean, default: false },
        variants: [variantSchema],
        averageRating: { type: Number, default: 0, min: 0, max: 5 },
        numReviews: { type: Number, default: 0, min: 0 },
        reviews: [
            {
                user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                rating: { type: Number, required: true, min: 1, max: 5 },
                comment: { type: String, trim: true },
                createdAt: { type: Date, default: Date.now },
            },
        ],
        weight: { type: Number, default: 0, min: 0 },
        dimensions: {
            length: { type: Number, default: 0, min: 0 },
            width: { type: Number, default: 0, min: 0 },
            height: { type: Number, default: 0, min: 0 },
        },
        shippingClass: {
            type: String,
            default: "Standard",
            enum: ["Standard", "Express", "Overnight", "Free"],
        },
        metaTitle: { type: String, trim: true },
        metaDescription: { type: String, trim: true },
        metaKeywords: [{ type: String, trim: true }],
        extraData: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    },
);

// Virtual for A+ Content
productSchema.virtual("aplusContent", {
    ref: "AplusContent",
    localField: "aplusContentId",
    foreignField: "productId",
    justOne: true,
});

// Virtual for dynamic order score
productSchema.virtual("orderScore").get(function () {
    let score = 0;

    switch (this.orderType) {
        case "manual":
            score = this.displayOrder;
            break;
        case "newest":
            score = this.publishDate ? this.publishDate.getTime() : this.createdAt.getTime();
            break;
        case "price_asc":
            score = -this.price; // Negative for ascending
            break;
        case "price_desc":
            score = this.price;
            break;
        case "popularity":
            score = this.purchaseCount || 0;
            break;
        case "rating":
            score = (this.averageRating || 0) * 100;
            break;
        default:
            score = this.displayOrder;
    }

    // Add priority boost
    score += this.priorityBoost || 0;

    return score;
});

// Slug generation middleware
productSchema.pre("save", function (next) {
    if (this.isModified("name") && this.name) {
        this.slug = this.name
            .toLowerCase()
            .trim()
            .replace(/[^a-zA-Z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");

        if (!this.slug) {
            this.slug = "product-" + Date.now();
        }
    }

    // Set publish date if not set
    if (this.isNew && !this.publishDate) {
        this.publishDate = new Date();
    }

    // Set default display order for new products (put at the end)
    if (this.isNew && this.displayOrder === 0) {
        // We'll set this after save in a separate query
        // Or you can implement auto-increment logic here
    }

    next();
});

// Updated static method to use new discount fields
productSchema.statics.generateAllVariants = function (variantOptions, baseVariantData = {}) {
    if (!variantOptions || variantOptions.length === 0) return [];

    const generateCombinations = (options, currentIndex = 0, currentCombination = []) => {
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
            combinations.push(...generateCombinations(options, currentIndex + 1, newCombination));
        }

        return combinations;
    };

    const allCombinations = generateCombinations(variantOptions);

    return allCombinations.map((combination, index) => ({
        options: combination,
        basePrice: baseVariantData.basePrice || 0,
        discountType: baseVariantData.discountType || "none",
        discountValue: baseVariantData.discountValue || 0,
        stock: 0,
        imageGroupName: baseVariantData.imageGroupName || "",
        sku: baseVariantData.sku ? `${baseVariantData.sku}-${index + 1}` : `VAR-${index + 1}`,
        order: index, // Add order to variants
    }));
};

// Pricing Calculation Middleware
function calculatePrice(basePrice, discountType, discountValue) {
    if (discountType === "percentage") {
        return Math.max(0, basePrice - (basePrice * discountValue) / 100);
    } else if (discountType === "fixed") {
        return Math.max(0, basePrice - discountValue);
    }
    return basePrice;
}

// Main pre-save hook for price calculation
productSchema.pre("save", function (next) {
    // Main product price calculation
    if (this.discountType !== "none" && this.discountValue > 0) {
        this.price = calculatePrice(this.basePrice, this.discountType, this.discountValue);
    } else {
        this.price = this.basePrice;
    }

    // Variant price calculation - IMPORTANT
    if (this.hasVariants && this.variants && this.variants.length > 0) {
        this.variants = this.variants.map((variant, idx) => {
            const variantBasePrice = variant.basePrice || this.basePrice;
            let variantPrice = variantBasePrice; // Default price

            // Use variant discount if available
            if (
                variant.discountType &&
                variant.discountType !== "none" &&
                variant.discountValue > 0
            ) {
                variantPrice = calculatePrice(
                    variantBasePrice,
                    variant.discountType,
                    variant.discountValue,
                );
            }
            // Otherwise use product discount if available
            else if (this.discountType !== "none" && this.discountValue > 0) {
                variantPrice = calculatePrice(
                    variantBasePrice,
                    this.discountType,
                    this.discountValue,
                );
            }

            // Set default order if not set
            if (!variant.order && variant.order !== 0) {
                variant.order = idx;
            }

            // Return variant with calculated price
            return {
                ...variant,
                price: variantPrice,
            };
        });

        // Sort variants by order
        this.variants.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    next();
});

// ============= ORDER SYSTEM STATIC METHODS =============

// Get products with custom ordering
productSchema.statics.getOrderedProducts = async function (filters = {}, options = {}) {
    const {
        orderBy = "displayOrder",
        orderDirection = "desc",
        categoryId = null,
        limit = 50,
        skip = 0,
        includeInactive = false,
    } = options;

    let query = { ...filters };

    if (!includeInactive) {
        query.isActive = true;
    }

    if (categoryId) {
        query.category = categoryId;
    }

    let sortQuery = {};

    switch (orderBy) {
        case "displayOrder":
            sortQuery = { displayOrder: orderDirection === "desc" ? -1 : 1, createdAt: -1 };
            break;
        case "newest":
            sortQuery = { publishDate: orderDirection === "desc" ? -1 : 1, createdAt: -1 };
            break;
        case "price":
            sortQuery = { price: orderDirection === "desc" ? -1 : 1 };
            break;
        case "popularity":
            sortQuery = { purchaseCount: orderDirection === "desc" ? -1 : 1 };
            break;
        case "rating":
            sortQuery = { averageRating: orderDirection === "desc" ? -1 : 1 };
            break;
        case "sales":
            sortQuery = { purchaseCount: orderDirection === "desc" ? -1 : 1 };
            break;
        default:
            sortQuery = { displayOrder: -1, createdAt: -1 };
    }

    return this.find(query).sort(sortQuery).skip(skip).limit(limit).lean();
};

// Reorder products
productSchema.statics.reorderProducts = async function (productOrders) {
    // productOrders should be array of { productId, displayOrder }
    const bulkOps = productOrders.map((item) => ({
        updateOne: {
            filter: { _id: item.productId },
            update: { displayOrder: item.displayOrder },
        },
    }));

    return this.bulkWrite(bulkOps);
};

// Increment view count
productSchema.methods.incrementViewCount = async function () {
    this.viewCount = (this.viewCount || 0) + 1;
    return this.save();
};

// Increment purchase count
productSchema.methods.incrementPurchaseCount = async function (quantity = 1) {
    this.purchaseCount = (this.purchaseCount || 0) + quantity;
    return this.save();
};

// Get next available display order
productSchema.statics.getNextDisplayOrder = async function (categoryId = null) {
    let query = {};
    if (categoryId) {
        query.category = categoryId;
    }

    const maxOrder = await this.findOne(query)
        .sort({ displayOrder: -1 })
        .select("displayOrder")
        .lean();

    return (maxOrder?.displayOrder || 0) + 1;
};

// Bulk update display orders for category
productSchema.statics.bulkUpdateCategoryOrders = async function (categoryId, productOrders) {
    const bulkOps = productOrders.map((item, index) => ({
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

    return this.bulkWrite(bulkOps);
};

// Get products sorted by order score (virtual)
productSchema.statics.getProductsByOrderScore = async function (
    filters = {},
    limit = 50,
    skip = 0,
) {
    const products = await this.find(filters).skip(skip).limit(limit).lean();

    // Sort by orderScore virtual
    products.sort((a, b) => {
        const scoreA = this.prototype.orderScore.get
            ? this.prototype.orderScore.get.call(a)
            : a.displayOrder;
        const scoreB = this.prototype.orderScore.get
            ? this.prototype.orderScore.get.call(b)
            : b.displayOrder;
        return scoreB - scoreA;
    });

    return products;
};

// ============= END ORDER SYSTEM STATIC METHODS =============

productSchema.index({ name: "text", description: "text", brand: "text" });
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ price: 1, isActive: 1 });
productSchema.index({ isFeatured: 1, isActive: 1 });
// productSchema.index({ slug: 1 });
// productSchema.index({ sku: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ discountType: 1, discountValue: 1 });

// New indexes for order system
productSchema.index({ displayOrder: -1, createdAt: -1 });
productSchema.index({ purchaseCount: -1 });
productSchema.index({ viewCount: -1 });
productSchema.index({ publishDate: -1 });
productSchema.index({ category: 1, displayOrder: -1 });
productSchema.index({ isActive: 1, displayOrder: -1, createdAt: -1 });
productSchema.index({ categoryDisplayOrder: 1 });

// Text index with weights
productSchema.index(
    {
        name: "text",
        description: "text",
        brand: "text",
        slug: "text",
    },
    {
        weights: {
            name: 10,
            slug: 5,
            description: 2,
            brand: 3,
        },
    },
);

// Newly added pre-save hook for image URL transformation date: 11 january 2024
productSchema.pre("save", function (next) {
    if (this.imageGroups && this.imageGroups.length > 0) {
        this.imageGroups.forEach((group) => {
            if (group.images && group.images.length > 0) {
                group.images.forEach((image) => {
                    if (image.url && image.url.includes("cloudinary")) {
                        image.url = image.url.replace("/upload/", "/upload/w_200,h_200,c_fill/");
                    }
                });
            }
        });
    }
    next();
});

// Virtual fields
productSchema.virtual("discountAmount").get(function () {
    if (this.discountType === "percentage") {
        return (this.basePrice * this.discountValue) / 100;
    } else if (this.discountType === "fixed") {
        return this.discountValue;
    }
    return 0;
});

productSchema.virtual("isOnSale").get(function () {
    return this.discountType !== "none" && this.discountValue > 0;
});

// Final price calculation method (for manual use if needed)
productSchema.methods.calculateFinalPrice = function () {
    return calculatePrice(this.basePrice, this.discountType, this.discountValue);
};

// Variant final price calculation method
variantSchema.methods.calculateFinalPrice = function (productDiscountType, productDiscountValue) {
    const variantBasePrice = this.basePrice;

    if (this.discountType !== "none" && this.discountValue > 0) {
        return calculatePrice(variantBasePrice, this.discountType, this.discountValue);
    } else if (productDiscountType && productDiscountType !== "none" && productDiscountValue > 0) {
        return calculatePrice(variantBasePrice, productDiscountType, productDiscountValue);
    }

    return variantBasePrice;
};

export default mongoose.model("Product", productSchema);
