import Product from "../models/Product.js";
import ProductCampaign from "../models/ProductCampaign.js";

// Helper function for price calculation (copied from Product.js)
function calculatePrice(basePrice, discountType, discountValue) {
    if (discountType === "percentage") {
        return Math.max(0, basePrice - (basePrice * discountValue) / 100);
    } else if (discountType === "fixed") {
        return Math.max(0, basePrice - discountValue);
    }
    return basePrice;
}

class ProductCampaignService {
    // Apply campaign discounts to products
    static async applyCampaignToProduct(productId, campaign) {
        const product = await Product.findById(productId);
        if (!product) return null;

        // Store original values before applying campaign
        const originalData = {
            originalPrice: product.price,
            originalDiscountType: product.discountType,
            originalDiscountValue: product.discountValue,
        };

        // Calculate campaign price for main product
        const campaignPrice = campaign.calculateCampaignPrice(product.basePrice);

        // Apply campaign discount to product
        product.campaignDiscount = {
            isActive: true,
            campaignId: campaign._id,
            campaignName: campaign.name,
            discountType: campaign.discountType,
            discountValue: campaign.discountValue,
            campaignPrice: campaignPrice,
            startDate: campaign.startDate,
            endDate: campaign.endDate,
        };

        // Store original prices in product for rollback
        product.originalDiscount = {
            discountType: originalData.originalDiscountType,
            discountValue: originalData.originalDiscountValue,
            price: originalData.originalPrice,
        };

        // Update product's active price
        product.price = campaignPrice;
        product.isUnderCampaign = true;
        product.activeCampaignId = campaign._id;

        // ✅ NEW: Apply campaign to variants
        if (product.hasVariants && product.variants && product.variants.length > 0) {
            product.variants = product.variants.map((variant) => {
                const variantBasePrice = variant.basePrice || product.basePrice;

                // Calculate campaign price for this variant
                const variantCampaignPrice = campaign.calculateCampaignPrice(variantBasePrice);

                return {
                    ...variant,
                    campaignPrice: variantCampaignPrice,
                    price: variantCampaignPrice, // Update variant price
                };
            });
        }

        await product.save();

        return {
            productId: product._id,
            originalData,
            campaignPrice,
        };
    }

    // Rollback campaign from a product
    static async rollbackCampaignFromProduct(productId) {
        const product = await Product.findById(productId);
        if (!product || !product.isUnderCampaign) return null;

        // Restore original values
        if (product.originalDiscount) {
            product.discountType = product.originalDiscount.discountType;
            product.discountValue = product.originalDiscount.discountValue;
            product.price = product.originalDiscount.price;
        }

        product.campaignDiscount = {};
        product.isUnderCampaign = false;
        product.activeCampaignId = null;
        product.originalDiscount = {};

        // ✅ NEW: Clear campaign from variants
        if (product.hasVariants && product.variants && product.variants.length > 0) {
            product.variants = product.variants.map((variant) => {
                // Restore variant price using existing discount logic
                let variantPrice = variant.basePrice || product.basePrice;

                // Use variant discount if available
                if (
                    variant.discountType &&
                    variant.discountType !== "none" &&
                    variant.discountValue > 0
                ) {
                    variantPrice = calculatePrice(
                        variant.basePrice || product.basePrice,
                        variant.discountType,
                        variant.discountValue,
                    );
                }
                // Otherwise use product discount if available
                else if (product.discountType !== "none" && product.discountValue > 0) {
                    variantPrice = calculatePrice(
                        variant.basePrice || product.basePrice,
                        product.discountType,
                        product.discountValue,
                    );
                }

                return {
                    ...variant,
                    campaignPrice: null, // Clear campaign price
                    price: variantPrice,
                };
            });
        }

        await product.save();

        return product;
    }

    // Apply a campaign to all eligible products
    static async applyCampaign(campaignId) {
        const campaign = await ProductCampaign.findById(campaignId);
        if (!campaign) {
            throw new Error("Campaign not found");
        }

        if (!campaign.isCurrentlyActive()) {
            throw new Error("Campaign is not currently active");
        }

        const eligibleProductIds = await campaign.getEligibleProductIds();
        const results = [];

        for (const productId of eligibleProductIds) {
            try {
                // Check if product already has a higher priority campaign
                const product = await Product.findById(productId);
                if (product && product.isUnderCampaign && product.activeCampaignId) {
                    const existingCampaign = await ProductCampaign.findById(
                        product.activeCampaignId,
                    );
                    if (existingCampaign && existingCampaign.priority > campaign.priority) {
                        console.log(
                            `Skipping product ${productId}: Higher priority campaign active`,
                        );
                        continue;
                    }
                }

                const result = await this.applyCampaignToProduct(productId, campaign);
                if (result) {
                    results.push(result);
                }
            } catch (error) {
                console.error(`Error applying campaign to product ${productId}:`, error);
            }
        }

        campaign.lastAppliedAt = new Date();
        await campaign.save();

        // ✅ FIX: Added name field
        return {
            name: campaign.name, // ← যোগ করতে হবে
            campaignId: campaign._id,
            totalProducts: eligibleProductIds.length,
            appliedProducts: results.length,
            results,
        };
    }

    // Rollback a campaign (when campaign ends)
    static async rollbackCampaign(campaignId) {
        const campaign = await ProductCampaign.findById(campaignId);
        if (!campaign) throw new Error("Campaign not found");

        const affectedProducts = await Product.find({
            activeCampaignId: campaignId,
            isUnderCampaign: true,
        });

        const results = [];
        for (const product of affectedProducts) {
            try {
                await this.rollbackCampaignFromProduct(product._id);
                results.push(product._id);
            } catch (error) {
                console.error(`Rollback failed for ${product._id}:`, error);
            }
        }

        campaign.isActive = false;
        campaign.rolledBackAt = new Date();
        await campaign.save();

        // ✅ FIX: Added name field
        return {
            name: campaign.name, // ← যোগ করতে হবে
            campaignId: campaign._id,
            rolledBackProducts: results.length,
            results,
        };
    }

    // Check and process all active campaigns (run by cron job)
    static async processAllActiveCampaigns() {
        const now = new Date();

        // Find campaigns that just started
        const startingCampaigns = await ProductCampaign.find({
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now },
            lastAppliedAt: { $exists: false },
        });

        // Find campaigns that just ended
        const endingCampaigns = await ProductCampaign.find({
            isActive: true,
            endDate: { $lt: now },
            rolledBackAt: { $exists: false },
        });

        const results = {
            started: [],
            ended: [],
        };

        for (const campaign of startingCampaigns) {
            const result = await this.applyCampaign(campaign._id);
            results.started.push(result);
        }

        for (const campaign of endingCampaigns) {
            const result = await this.rollbackCampaign(campaign._id);
            results.ended.push(result);
        }

        return results;
    }

    // Get active campaign for a product
    static async getActiveCampaignForProduct(productId) {
        const now = new Date();
        const product = await Product.findById(productId);

        if (!product || !product.isUnderCampaign || !product.activeCampaignId) {
            return null;
        }

        const campaign = await ProductCampaign.findOne({
            _id: product.activeCampaignId,
            isActive: true,
            startDate: { $lte: now },
            endDate: { $gte: now },
        });

        return campaign;
    }
}

export default ProductCampaignService;
