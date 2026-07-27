// routes/adminOrderRoutes.js - সম্পূর্ণ কোড
import express from "express";
import {
    getAllOrders,
    getOrderStats,
    updateOrderStatus,
    updatePaymentStatus,
    addAdminNote,
    deleteOrder,
    getOrderByIdAdmin,
    updateOrderDetails,
} from "../../controllers/orderController.js";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

// All routes are protected and admin only
router.use(protect, admin);

router.route("/").get(getAllOrders);

router.route("/stats").get(getOrderStats);
router
    .route("/:id")
    .get(getOrderByIdAdmin)
    .put(updateOrderDetails)
    .delete(deleteOrder);

router.route("/:id/status").put(updateOrderStatus);

router.route("/:id/payment").put(updatePaymentStatus);

router.route("/:id/notes").post(addAdminNote);

export default router;
