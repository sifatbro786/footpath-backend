// routes/heroRoutes.js
import express from "express";
import { getActiveHeroItems, getHeroItemById } from "../controllers/heroController.js";

const router = express.Router();

router.get("/", getActiveHeroItems);
router.get("/:id", getHeroItemById);

// Admin hero-item CRUD routes now live in routes/admin/heroAdminRoutes.js
export default router;
