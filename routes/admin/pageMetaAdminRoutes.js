// routes/admin/pageMetaAdminRoutes.js — mounted at /api/admin/page-meta
// FIX (critical, carried over from the earlier structure-only pass): none of
// these mutating routes had protect/adminOnly applied at all, despite both
// being imported in the original file — anyone could create/edit/delete page
// meta without logging in.
import express from "express";
import {
    bulkUpdatePageMeta,
    createPageMeta,
    deletePageMeta,
    getAllPageMeta,
    togglePageMetaStatus,
    updatePageMeta,
} from "../../controllers/pageMetaController.js";
import { adminOnly, protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, adminOnly);

router.post("/", createPageMeta);
router.get("/all", getAllPageMeta);
router.put("/:id", updatePageMeta);
router.delete("/:id", deletePageMeta);
router.patch("/:id/toggle", togglePageMetaStatus);
router.put("/bulk/update", bulkUpdatePageMeta);

export default router;
