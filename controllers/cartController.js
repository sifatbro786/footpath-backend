import Campaign from "../models/Campaign.js";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const getCart = async (req, res, next) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({
            success: false,
            message: "Not authorized. Please log in to view your cart.",
        });
    }
    try {
        let cart = await Cart.findOne({ user: req.user.id }).populate({
            path: "items.product",
            select: "name slug imageGroups variants hasVariants price basePrice discountPercentage stockStatus isActive",
        });

        if (!cart) {
            const newCart = await Cart.create({ user: req.user.id, items: [] });

            // ✅ FIX: Static import ব্যবহার করছি, dynamic import সরানো হয়েছে
            let activeCampaigns = [];
            try {
                activeCampaigns = await Campaign.find({
                    user: req.user.id,
                    status: "active",
                    expiresAt: { $gt: new Date() },
                })
                    .populate("promotion")
                    .populate("cartItems.product");
            } catch (campaignError) {
                console.log("⚠️ Campaign model error:", campaignError.message);
            }

            return res.status(200).json({
                success: true,
                cart: newCart,
                activeCampaigns: activeCampaigns,
            });
        }

        let isCartModified = false;
        const itemsToKeep = [];

        for (const item of cart.items) {
            const product = item.product;
            if (!product || product.isActive === false) {
                isCartModified = true;
                console.log(
                    `🗑️ Removing inactive/deleted product from cart: ${product?.name || "Unknown Product"}`,
                );
                continue;
            }

            if (product.stockStatus === "out_of_stock") {
                isCartModified = true;
                console.log(`📦 Removing out of stock product: ${product.name}`);
                continue;
            }

            let livePrice = product.price || 0;

            // ✅ FIX: SKU এর বদলে options দিয়ে variant match করা হচ্ছে
            if (product.hasVariants && item.variant?.options?.length) {
                const liveVariant = product.variants.find((v) =>
                    item.variant.options.every((opt) =>
                        v.options.some(
                            (vOpt) => vOpt.name === opt.name && vOpt.value === opt.value,
                        ),
                    ),
                );

                if (liveVariant) {
                    livePrice = liveVariant.price || 0;
                    if (liveVariant.stockStatus === "out_of_stock") {
                        isCartModified = true;
                        console.log(
                            `📦 Removing out of stock variant: ${product.name} - ${item.variant.displayName}`,
                        );
                        continue;
                    }
                } else {
                    isCartModified = true;
                    console.log(
                        `❌ Variant not found, removing: ${product.name} - ${item.variant.displayName}`,
                    );
                    continue;
                }
            }

            let currentItemPrice = item.priceAtPurchase || 0;
            if ((currentItemPrice ?? 0).toFixed(2) !== (livePrice ?? 0).toFixed(2)) {
                console.log(
                    `💰 Price updated for ${product.name}: ${currentItemPrice} → ${livePrice}`,
                );
                item.priceAtPurchase = livePrice;
                isCartModified = true;
            }

            itemsToKeep.push(item);
        }

        if (isCartModified) {
            cart.items = itemsToKeep;
            let newTotalPrice = cart.items.reduce(
                (total, item) => total + item.priceAtPurchase * item.quantity,
                0,
            );

            cart.totalPrice = newTotalPrice || 0;
            await cart.save();
            await cart.populate({
                path: "items.product",
                select: "name slug imageGroups variants hasVariants price basePrice discountPercentage stockStatus isActive",
            });
        }

        // ✅ FIX: Static import ব্যবহার করছি, dynamic import সরানো হয়েছে
        let activeCampaigns = [];
        try {
            activeCampaigns = await Campaign.find({
                user: req.user.id,
                status: "active",
                expiresAt: { $gt: new Date() },
            })
                .populate("promotion")
                .populate("cartItems.product", "name slug imageGroups price");
            console.log(`🎁 Found ${activeCampaigns.length} active campaigns for user`);
        } catch (campaignError) {
            console.log("⚠️ Campaign model error:", campaignError.message);
        }

        let finalCart = cart.toObject();
        let appliedPromotions = [];
        let totalDiscount = 0;

        if (activeCampaigns.length > 0) {
            for (const campaign of activeCampaigns) {
                if (campaign.promotion && campaign.promotion.isActive) {
                    const promotion = campaign.promotion;
                    const now = new Date();
                    if (now < promotion.startDate || now > promotion.endDate) {
                        continue;
                    }

                    if (
                        promotion.minimumCartValue &&
                        finalCart.totalPrice < promotion.minimumCartValue
                    ) {
                        continue;
                    }

                    let campaignDiscount = 0;
                    if (promotion.type === "cart_discount") {
                        if (promotion.discountType === "percentage") {
                            campaignDiscount =
                                (finalCart.totalPrice * promotion.discountValue) / 100;
                        } else {
                            campaignDiscount = promotion.discountValue;
                        }
                    } else if (promotion.type === "product_discount") {
                        for (const item of finalCart.items) {
                            if (
                                promotion.applicableProducts &&
                                promotion.applicableProducts.includes(item.product._id.toString())
                            ) {
                                if (promotion.discountType === "percentage") {
                                    const itemDiscount =
                                        (item.priceAtPurchase *
                                            item.quantity *
                                            promotion.discountValue) /
                                        100;
                                    campaignDiscount += itemDiscount;
                                    item.discountedPrice =
                                        item.priceAtPurchase -
                                        (item.priceAtPurchase * promotion.discountValue) / 100;
                                } else {
                                    campaignDiscount += promotion.discountValue * item.quantity;
                                    item.discountedPrice =
                                        item.priceAtPurchase - promotion.discountValue;
                                }
                            }
                        }
                    } else if (promotion.type === "abandoned_cart") {
                        if (promotion.discountType === "percentage") {
                            campaignDiscount =
                                (finalCart.totalPrice * promotion.discountValue) / 100;
                        } else {
                            campaignDiscount = promotion.discountValue;
                        }
                    }

                    if (campaignDiscount > 0) {
                        totalDiscount += campaignDiscount;
                        appliedPromotions.push({
                            campaignId: campaign._id,
                            promotionName: promotion.name,
                            discountValue: promotion.discountValue,
                            discountType: promotion.discountType,
                            discountAmount: campaignDiscount,
                        });
                    }
                }
            }
        }

        const finalTotalPrice = Math.max(0, finalCart.totalPrice - totalDiscount);

        res.status(200).json({
            success: true,
            cart: finalCart,
            activeCampaigns: activeCampaigns,
            appliedPromotions: appliedPromotions,
            totalDiscount: totalDiscount,
            finalTotalPrice: finalTotalPrice,
            message:
                appliedPromotions.length > 0
                    ? `🎉 ${appliedPromotions.length} promotion(s) applied to your cart!`
                    : "Cart loaded successfully",
        });
    } catch (error) {
        console.error("❌ Cart Controller getCart Error:", error);
        next(error);
    }
};

// @desc    Add item to cart
// @route   POST /api/cart
// @access  Private
export const addItemToCart = async (req, res, next) => {
    const { productId, quantity, variant } = req.body;

    console.log("🛒 Cart Controller - Add Item Request:");
    console.log("User ID:", req.user?.id);
    console.log("Request Body:", req.body);

    if (!req.user || !req.user.id) {
        return res.status(401).json({
            success: false,
            message: "Not authorized. Please log in to add items to cart.",
        });
    }

    const qty = parseInt(quantity);
    if (!qty || qty < 1) {
        return res.status(400).json({
            success: false,
            message: "Quantity must be a positive number.",
        });
    }

    try {
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        console.log("✅ Product found:", product.name);

        let priceToUse = product.price;
        let variantData = null;
        let variantSku = null;
        let availableStock = product.stock;

        if (variant && variant.options && Array.isArray(variant.options)) {
            console.log("✅ New variant structure detected:", variant);
            const variantItem = product.variants.find((v) => {
                return variant.options.every((opt) =>
                    v.options.some((vOpt) => vOpt.name === opt.name && vOpt.value === opt.value),
                );
            });

            if (!variantItem) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid product variant or variant not found.",
                });
            }
            priceToUse = variantItem.price;
            variantSku = variantItem.sku;
            availableStock = variantItem.stock;
            variantData = {
                options: variant.options,
                imageGroupName: variantItem.imageGroupName,
                displayName:
                    variant.displayName ||
                    variant.options.map((opt) => `${opt.name}: ${opt.value}`).join(", "),
                sku: variantItem.sku,
            };

            console.log("✅ Variant selected:", variantData.displayName);
            console.log("✅ Variant price:", priceToUse);
            console.log("✅ Variant imageGroupName:", variantData.imageGroupName);
        } else {
            console.log("✅ No variant selected, using product price:", priceToUse);
        }

        if (priceToUse === null || priceToUse === undefined || priceToUse <= 0) {
            priceToUse = product.price || product.basePrice || 0;
        }

        if (availableStock !== undefined && qty > availableStock) {
            return res.status(400).json({
                success: false,
                message: `Only ${availableStock} unit(s) in stock.`,
            });
        }

        const basePriceToUse = product.basePrice || priceToUse;
        const discountPercentageToUse = product.discountPercentage || 0;

        console.log(" Final price to use:", priceToUse);
        console.log(" Base price:", basePriceToUse);
        console.log(" Discount percentage:", discountPercentageToUse);

        let cart = await Cart.findOne({ user: req.user.id });

        if (!cart) {
            cart = await Cart.create({ user: req.user.id, items: [] });
            console.log("New cart created for user:", req.user.id);
        }

        const newItem = {
            product: productId,
            quantity: qty,
            priceAtPurchase: priceToUse,
            basePrice: basePriceToUse,
            discountPercentage: discountPercentageToUse,
            variant: variantData
                ? {
                      options: variantData.options,
                      imageGroupName: variantData.imageGroupName,
                      displayName: variantData.displayName,
                      sku: variantSku,
                  }
                : null,
        };

        const existingItem = cart.items.find((item) => {
            if (item.product.toString() !== productId) return false;
            if (!item.variant && !variantData) return true;
            if (!item.variant || !variantData) return false;
            if (item.variant.options && variantData.options) {
                const itemOptions = JSON.stringify(
                    item.variant.options.sort((a, b) => a.name.localeCompare(b.name)),
                );
                const newOptions = JSON.stringify(
                    variantData.options.sort((a, b) => a.name.localeCompare(b.name)),
                );
                return itemOptions === newOptions;
            }
            return false;
        });

        if (existingItem) {
            const newQty = existingItem.quantity + qty;
            if (availableStock !== undefined && newQty > availableStock) {
                return res.status(400).json({
                    success: false,
                    message: `Only ${availableStock} unit(s) in stock. You already have ${existingItem.quantity} in your cart.`,
                });
            }
            existingItem.quantity = newQty;
            existingItem.priceAtPurchase = priceToUse;
            existingItem.basePrice = basePriceToUse;
            existingItem.discountPercentage = discountPercentageToUse;
            console.log("Item already in cart, updated quantity:", existingItem.quantity);
        } else {
            cart.items.push(newItem);
            console.log("New item added to cart");
        }

        await cart.save();
        cart = await Cart.findById(cart._id).populate(
            "items.product",
            "name slug imageGroups variants hasVariants",
        );
        console.log("Cart saved successfully, total items:", cart.items.length);

        res.status(200).json({
            success: true,
            message: "Product added to your cart successfully.",
            cart,
        });
    } catch (error) {
        console.error("Cart Controller Error:", error);
        if (error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }
        next(error);
    }
};

// @desc    Merge a guest cart into the signed-in user's cart
// @route   POST /api/cart/merge
// @access  Private
//
// PHASE 5: this endpoint is load bearing, not a convenience.
//
// createOrder builds a signed-in user's order from the SERVER cart and ignores
// any items in the request body (only guests may pass guestItems). A guest cart
// therefore cannot survive login as localStorage alone: without this merge, a
// guest who fills a basket and then signs in to pay arrives at checkout with an
// empty server cart and a full local one.
//
// Merge rules, chosen to never destroy what the shopper already had:
//   • quantities ADD for a line that already exists (same product + variant)
//   • the guest's stale price is discarded; live price is re-read from the
//     product, exactly as addItemToCart does
//   • quantity is clamped to available stock rather than rejecting the whole
//     merge, so one sold-out item cannot cost the shopper their entire basket
//   • unknown or inactive products are skipped and reported back
export const mergeGuestCart = async (req, res, next) => {
    if (!req.user?.id) {
        return res.status(401).json({ success: false, message: "Not authorized." });
    }

    const { items } = req.body;

    if (!Array.isArray(items)) {
        return res.status(400).json({ success: false, message: "items must be an array." });
    }

    // Nothing to merge is a success, not an error: the client calls this on
    // every login regardless of whether a guest cart exists.
    if (items.length === 0) {
        const existing = await Cart.findOne({ user: req.user.id }).populate(
            "items.product",
            "name slug imageGroups variants hasVariants",
        );
        return res.status(200).json({
            success: true,
            cart: existing || { items: [], totalPrice: 0 },
            merged: 0,
            skipped: [],
        });
    }

    try {
        let cart = await Cart.findOne({ user: req.user.id });
        if (!cart) cart = await Cart.create({ user: req.user.id, items: [] });

        const skipped = [];
        let merged = 0;

        for (const incoming of items) {
            const quantity = parseInt(incoming?.quantity, 10);
            if (!incoming?.productId || !Number.isFinite(quantity) || quantity < 1) continue;

            const product = await Product.findById(incoming.productId);
            if (!product || product.isActive === false) {
                skipped.push({ productId: incoming.productId, reason: "unavailable" });
                continue;
            }

            // Resolve price and stock from the live product, never from the
            // client payload — a guest cart sits in localStorage where anyone
            // can edit the price.
            let price = product.price;
            let availableStock = product.stock;
            let variantData = null;

            const options = incoming.variant?.options;
            if (Array.isArray(options) && options.length > 0) {
                const variantItem = product.variants.find((v) =>
                    options.every((opt) =>
                        v.options.some(
                            (vOpt) => vOpt.name === opt.name && vOpt.value === opt.value,
                        ),
                    ),
                );

                if (!variantItem) {
                    skipped.push({ productId: incoming.productId, reason: "variant_missing" });
                    continue;
                }

                price = variantItem.price;
                availableStock = variantItem.stock;
                variantData = {
                    options,
                    imageGroupName: variantItem.imageGroupName,
                    displayName:
                        incoming.variant.displayName ||
                        options.map((o) => `${o.name}: ${o.value}`).join(", "),
                    sku: variantItem.sku,
                };
            }

            if (price == null || price <= 0) price = product.price || product.basePrice || 0;

            // Same matching rule as addItemToCart: product id plus the option
            // set, compared order-independently.
            const existingItem = cart.items.find((item) => {
                if (item.product.toString() !== String(incoming.productId)) return false;
                if (!item.variant?.options?.length && !variantData) return true;
                if (!item.variant?.options?.length || !variantData) return false;

                const a = [...item.variant.options]
                    .map((o) => `${o.name}:${o.value}`)
                    .sort()
                    .join("|");
                const b = [...variantData.options]
                    .map((o) => `${o.name}:${o.value}`)
                    .sort()
                    .join("|");
                return a === b;
            });

            const cap = availableStock ?? Infinity;

            if (existingItem) {
                const target = existingItem.quantity + quantity;
                const clamped = Math.min(target, cap);
                if (clamped > existingItem.quantity) merged += clamped - existingItem.quantity;
                existingItem.quantity = Math.max(1, clamped);
                existingItem.priceAtPurchase = price;
                existingItem.basePrice = product.basePrice || price;
            } else {
                const clamped = Math.min(quantity, cap);
                if (clamped < 1) {
                    skipped.push({ productId: incoming.productId, reason: "out_of_stock" });
                    continue;
                }
                cart.items.push({
                    product: incoming.productId,
                    quantity: clamped,
                    priceAtPurchase: price,
                    basePrice: product.basePrice || price,
                    discountPercentage: product.discountPercentage || 0,
                    variant: variantData,
                });
                merged += clamped;
            }
        }

        await cart.save();
        await cart.populate("items.product", "name slug imageGroups variants hasVariants");

        res.status(200).json({ success: true, cart, merged, skipped });
    } catch (error) {
        console.error("Cart merge error:", error.message);
        next(error);
    }
};

// @desc    Update item quantity in cart
// @route   PUT /api/cart/:itemId
// @access  Private
export const updateCartItem = async (req, res, next) => {
    const { quantity } = req.body;
    console.log("Update Cart Item ID:", req.params.itemId);
    console.log("Requested Quantity:", quantity);

    if (!req.user || !req.user.id) {
        return res.status(401).json({
            success: false,
            message: "Not authorized.",
        });
    }

    if (quantity < 1) {
        return res.status(400).json({
            success: false,
            message: "Quantity must be at least 1. Use DELETE to remove item.",
        });
    }

    try {
        const cart = await Cart.findOne({ user: req.user.id }).populate(
            "items.product",
            "stock variants hasVariants",
        );

        if (!cart) {
            return res.status(404).json({
                success: false,
                message: "Cart not found",
            });
        }

        const item = cart.items.id(req.params.itemId);
        if (!item) {
            return res.status(404).json({
                success: false,
                message: "Cart item not found",
            });
        }

        // ✅ FIX: SKU এর বদলে options দিয়ে variant match করা হচ্ছে
        const product = item.product;
        let availableStock = product?.stock;

        if (product?.hasVariants && item.variant?.options?.length) {
            const variantItem = product.variants.find((v) =>
                item.variant.options.every((opt) =>
                    v.options.some((vOpt) => vOpt.name === opt.name && vOpt.value === opt.value),
                ),
            );
            if (variantItem) availableStock = variantItem.stock;
        }

        if (availableStock !== undefined && quantity > availableStock) {
            return res.status(400).json({
                success: false,
                message: `Only ${availableStock} unit(s) in stock.`,
            });
        }

        item.quantity = quantity;
        await cart.save();
        await cart.populate("items.product", "name slug imageGroups variants hasVariants");

        res.status(200).json({ success: true, cart });
    } catch (error) {
        console.error("Cart Controller Update Error:", error);
        if (error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }
        next(error);
    }
};

// @desc    Remove item from cart
// @route   DELETE /api/cart/:itemId
// @access  Private
export const removeItemFromCart = asyncHandler(async (req, res) => {
    if (!req.user?.id) {
        return res.status(401).json({ success: false, message: "Not authorized." });
    }

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
        return res.status(404).json({ success: false, message: "Cart not found" });
    }

    cart.items.pull({ _id: req.params.itemId });
    await cart.save();
    await cart.populate("items.product", "name slug imageGroups variants hasVariants");
    res.status(200).json({ success: true, cart });
});
