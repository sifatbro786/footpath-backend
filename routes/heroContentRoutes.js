// routes/heroContentRoutes.js
import express from "express";
const router = express.Router();
import { getActiveHeroContent } from "../controllers/heroContentController.js";

// Public Read Route
router.route("/").get(getActiveHeroContent);

// Admin hero-content CRUD routes now live in routes/admin/heroContentAdminRoutes.js
export default router;
