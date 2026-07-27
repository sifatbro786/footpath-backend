import express from "express";
import { getNavbarConfig, getAvailableCategories } from "../controllers/navbarController.js";

const router = express.Router();

router.get("/config", getNavbarConfig);
router.get("/categories", getAvailableCategories);

// Admin navbar-management route now lives in routes/admin/navbarAdminRoutes.js
export default router;
