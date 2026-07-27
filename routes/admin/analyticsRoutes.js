import express from "express";
import { getDashboardAnalytics, getSalesReport } from "../../controllers/admin/analyticsController.js";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/dashboard", protect, admin, getDashboardAnalytics);
router.get("/sales-report", protect, admin, getSalesReport);

export default router;
