// routes/admin/heroContentAdminRoutes.js — mounted at /api/v1/admin/hero-content
import express from "express";
import {
    getAllHeroContent,
    createHeroContent,
    updateHeroContent,
    deleteHeroContent,
} from "../../controllers/heroContentController.js";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

router.route("/").get(getAllHeroContent).post(createHeroContent);
router.route("/:id").put(updateHeroContent).delete(deleteHeroContent);

export default router;
