import express from "express";
import { protect, admin, authorize } from "../../middlewares/authMiddleware.js";
import {
    getAdminAnalytics,
    getUsers,
    getUser,
    createUser,
    updateUserRole,
    deleteUser,
    updateUserStatus,
} from "../../controllers/admin/adminController.js";
// import {
//     getOrders,
//     getOrderByIdAdmin,
//     deleteOrder,
//     updateOrderAdmin
// } from '../../controllers/orderController.js';

const router = express.Router();

// All admin routes protected and require admin role
router.use(protect);
router.use(admin); // Using your existing admin middleware

// Analytics Routes
router.get("/analytics", getAdminAnalytics);

// User Management Routes
router.route("/users").get(getUsers).post(createUser);

router.route("/users/:id").get(getUser).delete(deleteUser);

router.route("/users/:id/role").put(updateUserRole);

router.route("/users/:id/status").put(updateUserStatus);

export default router;
