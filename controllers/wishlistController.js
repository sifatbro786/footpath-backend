// controllers/wishlistController.js
import mongoose from "mongoose";
import Wishlist from "../models/Wishlist.js";
import Product from "../models/Product.js";

/**
 * The projection mirrors what the storefront's normalizeProduct expects, so a
 * wishlist entry renders through the same ProductCard as everywhere else.
 * imageGroups (not `images`, which does not exist on Product) is what holds the
 * photography.
 */
const PRODUCT_FIELDS =
    "name slug price basePrice discountType discountValue imageGroups averageRating numReviews stock hasVariants isActive";

/** Shared read, so add/remove can return the same shape as get. */
const loadWishlist = async (userId) => {
    const wishlist = await Wishlist.findOne({ user: userId }).populate({
        path: "items.product",
        select: PRODUCT_FIELDS,
    });

    if (!wishlist) return { items: [] };

    // A product deleted or deactivated since it was saved populates to null, or
    // comes back inactive. Filtering here rather than in the UI means every
    // consumer gets a clean list.
    const items = wishlist.items
        .filter((item) => item.product && item.product.isActive !== false)
        .map((item) => ({ product: item.product, addedAt: item.addedAt }));

    return { items };
};

// @desc    Get the signed-in user's wishlist
// @route   GET /api/wishlist
// @access  Private
export const getWishlist = async (req, res, next) => {
    try {
        const { items } = await loadWishlist(req.user.id);
        res.status(200).json({ success: true, count: items.length, items });
    } catch (error) {
        console.error("Get wishlist error:", error.message);
        next(error);
    }
};

// @desc    Add a product to the wishlist
// @route   POST /api/wishlist
// @access  Private
//
// Idempotent by design: saving something already saved is a no-op that still
// returns 200. A wishlist toggle fired twice by a double tap must not 400.
export const addToWishlist = async (req, res, next) => {
    try {
        const { productId } = req.body;

        if (!mongoose.isValidObjectId(productId)) {
            return res.status(400).json({ success: false, message: "A valid product is required." });
        }

        const product = await Product.findOne({ _id: productId, isActive: true }).select("_id");
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }

        // $addToSet on a subdocument array compares whole objects, and `addedAt`
        // differs every call, so it would never dedupe. Guard with the
        // "not already present" filter instead and upsert the document itself.
        await Wishlist.updateOne(
            { user: req.user.id },
            { $setOnInsert: { user: req.user.id } },
            { upsert: true },
        );

        await Wishlist.updateOne(
            { user: req.user.id, "items.product": { $ne: productId } },
            { $push: { items: { product: productId, addedAt: new Date() } } },
        );

        const { items } = await loadWishlist(req.user.id);
        res.status(200).json({ success: true, count: items.length, items });
    } catch (error) {
        console.error("Add to wishlist error:", error.message);
        next(error);
    }
};

// @desc    Remove a product from the wishlist
// @route   DELETE /api/wishlist/:productId
// @access  Private
export const removeFromWishlist = async (req, res, next) => {
    try {
        const { productId } = req.params;

        if (!mongoose.isValidObjectId(productId)) {
            return res.status(400).json({ success: false, message: "A valid product is required." });
        }

        await Wishlist.updateOne(
            { user: req.user.id },
            { $pull: { items: { product: productId } } },
        );

        const { items } = await loadWishlist(req.user.id);
        res.status(200).json({ success: true, count: items.length, items });
    } catch (error) {
        console.error("Remove from wishlist error:", error.message);
        next(error);
    }
};

// @desc    Clear the whole wishlist
// @route   DELETE /api/wishlist
// @access  Private
export const clearWishlist = async (req, res, next) => {
    try {
        await Wishlist.updateOne({ user: req.user.id }, { $set: { items: [] } });
        res.status(200).json({ success: true, count: 0, items: [] });
    } catch (error) {
        console.error("Clear wishlist error:", error.message);
        next(error);
    }
};
