// routes/admin/aplusContentAdminRoutes.js — mounted at /api/admin/aplus-content
import express from "express";
import {
    createOrUpdateAplusContent,
    deleteAplusContent,
    getAdminAplusContent,
    getAllAplusContent,
    toggleAplusContentStatus,
} from "../../controllers/aplusContentController.js";
import upload from "../../controllers/uploadController.js";
import { adminOnly, protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, adminOnly);

router.post("/", createOrUpdateAplusContent);
router.get("/all", getAllAplusContent);
router.get("/dashboard", getAdminAplusContent);
router.put("/toggle/:productId", toggleAplusContentStatus);
router.delete("/:productId", deleteAplusContent);

// ================= IMAGE UPLOAD ROUTES =================
router.post("/upload/image", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded",
            });
        }

        const baseUrl = process.env.BASE_URL || "http://localhost:5010";
        const imageUrl = `${baseUrl}/uploads/products/${req.file.filename}`;

        res.status(200).json({
            success: true,
            imageUrl,
            fileName: req.file.filename,
            fileInfo: {
                originalName: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
            },
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
            success: false,
            message: "Error uploading image",
        });
    }
});

router.post("/upload/multiple", upload.array("images", 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No files uploaded",
            });
        }

        const baseUrl = process.env.BASE_URL || "http://localhost:5010";

        const uploadedFiles = req.files.map((file) => ({
            url: `${baseUrl}/uploads/products/${file.filename}`,
            fileName: file.filename,
            originalName: file.originalname,
            size: file.size,
            mimetype: file.mimetype,
        }));

        res.status(200).json({
            success: true,
            message: "Images uploaded successfully",
            files: uploadedFiles,
            count: uploadedFiles.length,
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
            success: false,
            message: "Error uploading images",
        });
    }
});

export default router;
