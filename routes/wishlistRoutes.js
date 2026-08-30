import express from "express";
import {
    getWishlist,
    addToWishlist,
    removeFromWishlist,
    clearWishlist,
} from "../controllers/wishlistController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// A wishlist belongs to an account by definition, so every route is protected.
// Guests get a "sign in to save" prompt in the UI rather than a local list:
// a saved item that vanishes when the browser is cleared is worse than an
// honest sign-in prompt.
router.use(protect);

router.route("/").get(getWishlist).post(addToWishlist).delete(clearWishlist);
router.delete("/:productId", removeFromWishlist);

export default router;
