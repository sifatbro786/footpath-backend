// routes/admin/heroContentAdminRoutes.js — mounted at /api/admin/hero-content
import express from "express";
import {
    createHeroContent,
    deleteHeroContent,
    getAllHeroContent,
    updateHeroContent,
} from "../../controllers/heroContentController.js";
import { admin, protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

router.route("/").get(getAllHeroContent).post(createHeroContent);
router.route("/:id").put(updateHeroContent).delete(deleteHeroContent);

export default router;
