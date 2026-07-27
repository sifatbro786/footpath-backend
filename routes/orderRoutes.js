// routes/orderRoutes.js
import express from "express";
import { createOrder, getOrderById, getMyOrders } from "../controllers/orderController.js";
import { optionalProtect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.route("/").post(optionalProtect, createOrder).get(optionalProtect, getMyOrders);

router.route("/:id").get(optionalProtect, getOrderById);

export default router;
