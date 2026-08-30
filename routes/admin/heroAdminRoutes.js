// routes/admin/heroAdminRoutes.js
import express from "express";
import {
    getAllHeroItemsAdmin,
    createHeroItem,
    updateHeroItem,
    deleteHeroItem,
    reorderHeroItems,
} from "../../controllers/admin/heroAdminController.js";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

// PHASE 9: added. Without a list route the panel could only reach slides
// through the public endpoint, which hides anything inactive.
router.get("/", getAllHeroItemsAdmin);

router.post("/", createHeroItem);
router.put("/:id", updateHeroItem);
router.delete("/:id", deleteHeroItem);
router.put("/", reorderHeroItems); // bulk reorder: body { items: [{id, order}] }

export default router;
