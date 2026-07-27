import express from "express";
import {
    getCart,
    addItemToCart,
    updateCartItem,
    removeItemFromCart,
} from "../controllers/cartController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.route("/").get(protect, getCart).post(protect, addItemToCart);
router.route("/:itemId").put(protect, updateCartItem).delete(protect, removeItemFromCart);

export default router;
