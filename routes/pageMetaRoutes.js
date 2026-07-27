// routes/pageMetaRoutes.js
import express from "express";
import { getPageMetaBySlug } from "../controllers/pageMetaController.js";

const router = express.Router();

router.get("/:slug", getPageMetaBySlug);

// Admin page-meta management routes now live in routes/admin/pageMetaAdminRoutes.js
export default router;
