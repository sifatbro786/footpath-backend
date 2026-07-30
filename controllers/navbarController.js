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
        const { logo, logoUrl, items, cartIcon, searchIcon, userIcon, wishlistIcon } = req.body;

        let config = await NavbarConfig.findOne({ isActive: true });

        // Process items - generate paths based on type
        let processedItems = items;
        if (items && Array.isArray(items)) {
            processedItems = await Promise.all(
                items.map(async (item) => {
                    // ✅ FIX #3: _id is a String subdoc key (not ObjectId), so client-provided
                    // "item-…" ids persist fine and stay stable across saves. Only
                    // drop a blank/absent _id so Mongoose can generate one.
                    const cleanItem = { ...item };
                    if (!cleanItem._id) delete cleanItem._id;

                    // ✅ FIX #2: Always regenerate path for category items (even if path exists)
                    // This ensures changing category updates the link correctly
                    if (cleanItem.type === "category" && cleanItem.category) {
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
            if (logo !== undefined) config.logo = logo;
            if (logoUrl !== undefined) config.logoUrl = logoUrl;
            if (processedItems !== undefined) config.items = processedItems;
            if (cartIcon !== undefined) config.cartIcon = cartIcon;
            if (searchIcon !== undefined) config.searchIcon = searchIcon;
            if (userIcon !== undefined) config.userIcon = userIcon;
            if (wishlistIcon !== undefined) config.wishlistIcon = wishlistIcon;
        } else {
            // Create new config
            config = new NavbarConfig({
                logo: logo || {
                    url: "",
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

        await config.save();
        await config.populate("items.category", "name slug");

        res.json({
            success: true,
            message: "Navbar configuration updated successfully",
            data: config,
        });
    } catch (error) {
        console.error("Error in updateNavbarConfig:", error);

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
            url: "",
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
