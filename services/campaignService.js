import Campaign from "../models/Campaign.js";
import Product from "../models/Product.js";

class CampaignService {
    // Get all active campaigns
    async getActiveCampaigns() {
        try {
            const campaigns = await Campaign.getActiveCampaigns();
            console.log(`🎯 Found ${campaigns.length} active campaigns`);
            return campaigns;
        } catch (error) {
            console.error("❌ Error getting active campaigns:", error);
            return [];
        }
    }

    // Apply campaigns to a single product
    async applyCampaignsToProduct(product) {
        try {
            const activeCampaigns = await this.getActiveCampaigns();
            const productDoc = product.toObject ? product.toObject() : product;

            let bestCampaign = null;
            let maxDiscount = 0;

            console.log(`🔍 Checking campaigns for product: ${productDoc.name}`);

            for (const campaign of activeCampaigns) {
                const isApplicable = campaign.isApplicableToProduct(
                    productDoc._id.toString(),
                    productDoc.category ? productDoc.category.toString() : null,
                );

                if (isApplicable) {
                    const discount = campaign.calculateDiscount(productDoc.basePrice); // <-- এখানে পরিবর্তন
                    console.log(`💰 Campaign "${campaign.name}" offers discount: ${discount}`);

                    if (discount > maxDiscount) {
                        maxDiscount = discount;
                        bestCampaign = campaign;
                    }
                }
            }

            const result = {
                ...productDoc,
                originalPrice: productDoc.basePrice, // <-- এটি একটি বিকল্প পরিবর্তন
                campaignDiscount: maxDiscount,
                finalPrice: Math.max(0, productDoc.basePrice - maxDiscount), // <-- এখানেও পরিবর্তন
                appliedCampaign: bestCampaign,
                hasActiveCampaign: maxDiscount > 0,
            };

            console.log(
                `🎉 Final price for ${productDoc.name}: ${result.finalPrice} (Discount: ${maxDiscount})`,
            );

            return result;
        } catch (error) {
            console.error("❌ Error applying campaigns to product:", error);
            // Return original product if error occurs
            return {
                ...(product.toObject ? product.toObject() : product),
                originalPrice: product.price,
                campaignDiscount: 0,
                finalPrice: product.price,
                appliedCampaign: null,
                hasActiveCampaign: false,
            };
        }
    }

    // Apply campaigns to multiple products
    async applyCampaignsToProducts(products) {
        try {
            const activeCampaigns = await this.getActiveCampaigns();
            const results = [];

            console.log(`🛍️ Applying campaigns to ${products.length} products`);

            for (const product of products) {
                const productDoc = product.toObject ? product.toObject() : product;
                let bestCampaign = null;
                let maxDiscount = 0;

                for (const campaign of activeCampaigns) {
                    const isApplicable = campaign.isApplicableToProduct(
                        productDoc._id.toString(),
                        productDoc.category ? productDoc.category.toString() : null,
                    );

                    if (isApplicable) {
                        const discount = campaign.calculateDiscount(productDoc.price);

                        if (discount > maxDiscount) {
                            maxDiscount = discount;
                            bestCampaign = campaign;
                        }
                    }
                }

                results.push({
                    ...productDoc,
                    originalPrice: productDoc.price,
                    campaignDiscount: maxDiscount,
                    finalPrice: Math.max(0, productDoc.price - maxDiscount),
                    appliedCampaign: bestCampaign,
                    hasActiveCampaign: maxDiscount > 0,
                });
            }

            return results;
        } catch (error) {
            console.error("❌ Error applying campaigns to products:", error);
            // Return original products if error occurs
            return products.map((product) => ({
                ...(product.toObject ? product.toObject() : product),
                originalPrice: product.price,
                campaignDiscount: 0,
                finalPrice: product.price,
                appliedCampaign: null,
                hasActiveCampaign: false,
            }));
        }
    }

    // Get products with campaign pricing for a category
    async getCategoryProductsWithCampaign(categoryId, page = 1, limit = 20) {
        try {
            const products = await Product.find({
                category: categoryId,
                isActive: true,
            })
                .populate("category")
                .skip((page - 1) * limit)
                .limit(limit)
                .sort({ createdAt: -1 });

            return await this.applyCampaignsToProducts(products);
        } catch (error) {
            console.error("❌ Error getting category products with campaign:", error);
            throw error;
        }
    }

    // Check if a campaign is currently active for a product
    async hasActiveCampaign(productId, categoryId) {
        try {
            const activeCampaigns = await this.getActiveCampaigns();

            return activeCampaigns.some((campaign) =>
                campaign.isApplicableToProduct(productId.toString(), categoryId.toString()),
            );
        } catch (error) {
            console.error("❌ Error checking active campaign:", error);
            return false;
        }
    }
}

export default new CampaignService();
