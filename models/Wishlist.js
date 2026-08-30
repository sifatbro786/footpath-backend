import mongoose from "mongoose";

/**
 * Wishlist (Phase 6).
 *
 * One document per user holding an array of product references, rather than one
 * document per saved item. A wishlist is always read whole ("show me my saved
 * things"), is small, and is never paginated, so a single document is one query
 * instead of a lookup plus a join, and the unique index below gives idempotent
 * "add" behaviour for free.
 *
 * Deliberately NOT variant aware. A wishlist saves intent ("I want this pen"),
 * not a purchase decision; the variant is chosen on the product page when the
 * item actually moves to the cart. Storing a variant here would mean a saved
 * item silently breaking whenever an admin retires that option.
 */
const wishlistSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        items: [
            {
                product: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Product",
                    required: true,
                },
                addedAt: { type: Date, default: Date.now },
                _id: false,
            },
        ],
    },
    { timestamps: true },
);

// `user` is already unique above, which covers the only query this collection
// serves: findOne({ user }).
const Wishlist = mongoose.model("Wishlist", wishlistSchema);
export default Wishlist;
