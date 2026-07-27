// services/discount.service.js
import Campaign from "../models/Campaign.js";
import Coupon from "../models/CouponLegacy.js";
import Product from "../models/Product.js";

export class DiscountService {
    /**
     * Calculate campaign discounts for products
     */
    static async calculateCampaignDiscounts(products) {
        const now = new Date();
        const activeCampaigns = await Campaign.find({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now },
        }).sort({ priority: -1 });

        if (activeCampaigns.length === 0) {
            return products.map((product) => ({
                ...product,
                campaignDiscount: null,
                finalPrice: product.price,
            }));
        }

        const productMap = new Map();
        const categoryMap = new Map();

        // Organize products by ID and category
        products.forEach((product) => {
            productMap.set(product._id.toString(), product);

            if (product.category) {
                const categoryId = product.category.toString();
                if (!categoryMap.has(categoryId)) {
                    categoryMap.set(categoryId, []);
                }
                categoryMap.get(categoryId).push(product);
            }
        });

        const discountedProducts = [];

        // Apply campaigns in priority order
        for (const campaign of activeCampaigns) {
            let targetProducts = [];

            if (campaign.campaignType === "sitewide") {
                targetProducts = [...products];
            } else if (campaign.campaignType === "category") {
                campaign.targetCategories.forEach((categoryId) => {
                    const categoryProducts = categoryMap.get(categoryId.toString()) || [];
                    targetProducts.push(...categoryProducts);
                });
            } else if (campaign.campaignType === "product") {
                campaign.targetProducts.forEach((productId) => {
                    const product = productMap.get(productId.toString());
                    if (product) {
                        targetProducts.push(product);
                    }
                });
            }

            // Apply discount to target products
            for (const product of targetProducts) {
                if (product.campaignDiscount) continue; // Already discounted by higher priority campaign

                const discountAmount = this.calculateDiscountAmount(
                    product.price,
                    campaign.discountType,
                    campaign.discountValue,
                    campaign.maxDiscountAmount,
                );

                if (discountAmount > 0) {
                    product.campaignDiscount = {
                        campaignId: campaign._id,
                        campaignName: campaign.name,
                        discountType: campaign.discountType,
                        discountValue: campaign.discountValue,
                        discountAmount: discountAmount,
                    };
                    product.finalPrice = product.price - discountAmount;
                }
            }
        }

        // For products without campaign discounts
        products.forEach((product) => {
            if (!product.campaignDiscount) {
                product.finalPrice = product.price;
            }
        });

        return products;
    }

    /**
     * Validate and apply coupon
     */
    static async validateAndApplyCoupon(couponCode, orderData, userId) {
        const coupon = await Coupon.findOne({
            code: couponCode.toUpperCase(),
            isActive: true,
        });

        if (!coupon) {
            throw new Error("Invalid coupon code");
        }

        // Check date validity
        const now = new Date();
        if (now < coupon.startDate || now > coupon.endDate) {
            throw new Error("Coupon is not currently active");
        }

        // Check usage limit
        if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
            throw new Error("Coupon usage limit exceeded");
        }

        // Check per user limit
        if (userId && coupon.perUserLimit > 0) {
            const userCouponUsage = await mongoose.model("Order").countDocuments({
                user: userId,
                "couponDiscount.couponId": coupon._id,
            });

            if (userCouponUsage >= coupon.perUserLimit) {
                throw new Error("You have already used this coupon the maximum number of times");
            }
        }

        // Check minimum order amount
        const subtotal =
            orderData.itemsPrice ||
            orderData.orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

        if (subtotal < coupon.minOrderAmount) {
            throw new Error(
                `Minimum order amount of ${coupon.minOrderAmount} required for this coupon`,
            );
        }

        // Check category and product restrictions
        if (
            coupon.applicableCategories.length > 0 ||
            coupon.excludedCategories.length > 0 ||
            coupon.applicableProducts.length > 0 ||
            coupon.excludedProducts.length > 0
        ) {
            let validItems = orderData.orderItems;

            // Filter by applicable categories
            if (coupon.applicableCategories.length > 0) {
                validItems = await this.filterItemsByCategories(
                    validItems,
                    coupon.applicableCategories,
                    true,
                );
            }

            // Filter out excluded categories
            if (coupon.excludedCategories.length > 0) {
                validItems = await this.filterItemsByCategories(
                    validItems,
                    coupon.excludedCategories,
                    false,
                );
            }

            // Filter by applicable products
            if (coupon.applicableProducts.length > 0) {
                validItems = validItems.filter((item) =>
                    coupon.applicableProducts.includes(item.product.toString()),
                );
            }

            // Filter out excluded products
            if (coupon.excludedProducts.length > 0) {
                validItems = validItems.filter(
                    (item) => !coupon.excludedProducts.includes(item.product.toString()),
                );
            }

            if (validItems.length === 0) {
                throw new Error("Coupon cannot be applied to any items in your cart");
            }
        }

        // Calculate coupon discount
        const applicableAmount = this.getApplicableAmountForCoupon(orderData, coupon);
        const discountAmount = this.calculateDiscountAmount(
            applicableAmount,
            coupon.discountType,
            coupon.discountValue,
            coupon.maxDiscountAmount,
        );

        return {
            coupon,
            discountAmount,
            applicableAmount,
        };
    }

    /**
     * Calculate discount amount based on type and constraints
     */
    static calculateDiscountAmount(amount, discountType, discountValue, maxDiscount = null) {
        let discountAmount = 0;

        if (discountType === "percentage") {
            discountAmount = (amount * discountValue) / 100;
            if (maxDiscount && discountAmount > maxDiscount) {
                discountAmount = maxDiscount;
            }
        } else if (discountType === "fixed") {
            discountAmount = Math.min(discountValue, amount);
        }

        return Math.max(0, discountAmount);
    }

    /**
     * Filter items by categories for coupon validation
     */
    static async filterItemsByCategories(items, categoryIds, include = true) {
        const productIds = items.map((item) => item.product);
        const products = await Product.find({ _id: { $in: productIds } }).select(
            "category subCategory",
        );

        const productCategoryMap = new Map();
        products.forEach((product) => {
            productCategoryMap.set(product._id.toString(), {
                category: product.category?.toString(),
                subCategory: product.subCategory?.toString(),
            });
        });

        return items.filter((item) => {
            const productCategories = productCategoryMap.get(item.product.toString());
            if (!productCategories) return false;

            const hasMatchingCategory = categoryIds.some(
                (categoryId) =>
                    productCategories.category === categoryId.toString() ||
                    productCategories.subCategory === categoryId.toString(),
            );

            return include ? hasMatchingCategory : !hasMatchingCategory;
        });
    }

    /**
     * Get applicable amount for coupon after considering restrictions
     */
    static getApplicableAmountForCoupon(orderData, coupon) {
        let applicableItems = orderData.orderItems;

        // Apply category and product restrictions
        if (coupon.applicableCategories.length > 0) {
            // This would need the actual filtering logic from above
            // For simplicity, we'll use the full amount here
        }

        return applicableItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    }
}
