// routes/admin/navbarAdminRoutes.js — mounted at /api/admin/navbar
// FIX (critical): PUT /config had NO auth middleware at all in the original
// navbarRoutes.js — anyone could rewrite the site's entire navigation menu
// without logging in.
import express from "express";
import { updateNavbarConfig } from "../../controllers/navbarController.js";
import { admin, protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.put("/config", protect, admin, updateNavbarConfig);

export default router;
