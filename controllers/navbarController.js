import NavbarConfig from "../models/NavbarConfig.js";
import Category from "../models/Category.js";

// Get active navbar configuration
export const getNavbarConfig = async (req, res) => {
    try {
        const config = await NavbarConfig.findOne({ isActive: true })
            .populate("items.category", "name slug")
            .sort({ createdAt: -1 });

        if (!config) {
            // Return default config if none exists
            const defaultConfig = await createDefaultConfig();
            return res.json({
                success: true,
                data: defaultConfig,
            });
        }

        res.json({
            success: true,
            data: config,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// Create or update navbar configuration
export const updateNavbarConfig = async (req, res) => {
    try {
        console.log("📦 Request Body:", JSON.stringify(req.body, null, 2));

        const { logo, logoUrl, items, cartIcon, searchIcon, userIcon, wishlistIcon } = req.body;

        let config = await NavbarConfig.findOne({ isActive: true });
        console.log("🔍 Found existing config:", config ? "Yes" : "No");

        // Process items - generate paths based on type
        let processedItems = items;
        if (items && Array.isArray(items)) {
            processedItems = await Promise.all(
                items.map(async (item) => {
                    let cleanItem = { ...item };

                    // Remove custom _id for new items to avoid ObjectId casting issues
                    if (item._id && typeof item._id === "string" && item._id.startsWith("item-")) {
                        const { _id, ...rest } = item;
                        cleanItem = rest;
                    }

                    // Generate path based on item type
                    if (cleanItem.type === "category" && cleanItem.category && !cleanItem.path) {
                        // For categories, create path like /category/slug
                        try {
                            const categoryDoc = await Category.findById(cleanItem.category).select(
                                "slug",
                            );
                            if (categoryDoc) {
                                cleanItem.path = `/category/${categoryDoc.slug}`;
                            } else {
                                cleanItem.path = "/shop"; // fallback
                            }
                        } catch (error) {
                            console.error("Error fetching category:", error);
                            cleanItem.path = "/shop"; // fallback
                        }
                    } else if (cleanItem.type === "custom" && cleanItem.customUrl) {
                        cleanItem.path = cleanItem.customUrl;
                    }
                    // For 'link' type, use the provided path directly

                    return cleanItem;
                }),
            );
        }

        if (config) {
            // Update existing config
            if (logo) config.logo = logo;
            if (logoUrl) config.logoUrl = logoUrl;
            if (processedItems) config.items = processedItems;
            if (cartIcon !== undefined) config.cartIcon = cartIcon;
            if (searchIcon !== undefined) config.searchIcon = searchIcon;
            if (userIcon !== undefined) config.userIcon = userIcon;
            if (wishlistIcon !== undefined) config.wishlistIcon = wishlistIcon;
        } else {
            // Create new config
            config = new NavbarConfig({
                logo: logo || {
                    url: "", // NOTE: was hardcoded to an unrelated news-site image URL — replace via admin panel with the real Footpath logo
                    public_id: "",
                },
                logoUrl: logoUrl || "/",
                items: processedItems || [],
                cartIcon: cartIcon !== undefined ? cartIcon : true,
                searchIcon: searchIcon !== undefined ? searchIcon : true,
                userIcon: userIcon !== undefined ? userIcon : true,
                wishlistIcon: wishlistIcon !== undefined ? wishlistIcon : true,
            });
        }

        console.log("💾 Saving config...");
        await config.save();
        console.log("✅ Config saved successfully");

        await config.populate("items.category", "name slug");
        console.log("✅ Population completed");

        res.json({
            success: true,
            message: "Navbar configuration updated successfully",
            data: config,
        });
    } catch (error) {
        console.error("❌ Error in updateNavbarConfig:", error);
        console.error("📋 Error details:", {
            name: error.name,
            message: error.message,
        });

        if (error.name === "ValidationError") {
            const errors = Object.values(error.errors).map((e) => e.message);
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: errors,
            });
        }

        res.status(500).json({
            success: false,
            message: "Internal server error: " + error.message,
        });
    }
};

// Get available categories for navbar
export const getAvailableCategories = async (req, res) => {
    try {
        const categories = await Category.find({ isActive: true })
            .select("name slug level path")
            .sort({ level: 1, name: 1 });

        res.json({
            success: true,
            data: categories,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// Helper function to create default config
const createDefaultConfig = async () => {
    const defaultConfig = new NavbarConfig({
        logo: {
            url: "", // NOTE: was hardcoded to an unrelated news-site image URL — replace via admin panel with the real Footpath logo
            public_id: "",
        },
        logoUrl: "/",
        items: [
            { name: "Home", type: "link", path: "/", order: 0, isActive: true },
            { name: "Collections", type: "link", path: "/shop", order: 1, isActive: true },
            { name: "Deals", type: "link", path: "/best-deal", order: 2, isActive: true },
            { name: "Blog", type: "link", path: "/blogs", order: 3, isActive: true },
            { name: "About Us", type: "link", path: "/about", order: 4, isActive: true },
        ],
        cartIcon: true,
        searchIcon: true,
        userIcon: true,
        wishlistIcon: true,
    });

    await defaultConfig.save();
    return defaultConfig;
};
