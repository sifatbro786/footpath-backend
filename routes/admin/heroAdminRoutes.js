// routes/admin/heroAdminRoutes.js
import express from "express";
import {
    createHeroItem,
    updateHeroItem,
    deleteHeroItem,
    reorderHeroItems,
} from "../../controllers/admin/heroAdminController.js";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

router.post("/", createHeroItem);
router.put("/:id", updateHeroItem);
router.delete("/:id", deleteHeroItem);
router.put("/", reorderHeroItems); // bulk reorder

export default router;
