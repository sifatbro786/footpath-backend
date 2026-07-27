// routes/admin/pageMetaAdminRoutes.js — mounted at /api/v1/admin/page-meta
// FIX (critical, carried over from the earlier structure-only pass): none of
// these mutating routes had protect/adminOnly applied at all, despite both
// being imported in the original file — anyone could create/edit/delete page
// meta without logging in.
import express from "express";
import { protect, adminOnly } from "../../middlewares/authMiddleware.js";
import {
    createPageMeta,
    getAllPageMeta,
    updatePageMeta,
    deletePageMeta,
    togglePageMetaStatus,
    bulkUpdatePageMeta,
} from "../../controllers/pageMetaController.js";

const router = express.Router();

router.use(protect, adminOnly);

router.post("/", createPageMeta);
router.get("/all", getAllPageMeta);
router.put("/:id", updatePageMeta);
router.delete("/:id", deletePageMeta);
router.patch("/:id/toggle", togglePageMetaStatus);
router.put("/bulk/update", bulkUpdatePageMeta);

export default router;
