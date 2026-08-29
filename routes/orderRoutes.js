// routes/orderRoutes.js
import express from "express";
import { createOrder, getOrderById, getMyOrders } from "../controllers/orderController.js";
import { optionalProtect, protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// FIX (Phase 0): getMyOrders reads req.user.id unconditionally, but this route
// was mounted with optionalProtect — so any unauthenticated call threw a
// TypeError and returned a 500 instead of a 401. "My orders" is meaningless
// without an identity, so it now requires a real session.
router.route("/").post(optionalProtect, createOrder).get(protect, getMyOrders);

// Stays optionalProtect: guests legitimately read their own order back with a
// capability token (?token=...), while registered users are matched by JWT.
// Authorization is enforced inside the controller.
router.route("/:id").get(optionalProtect, getOrderById);

export default router;
