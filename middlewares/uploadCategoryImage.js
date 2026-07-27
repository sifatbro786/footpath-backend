import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "../uploads/categories");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename: timestamp-randomNumber-originalname
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `category-${uniqueSuffix}${ext}`;
        cb(null, filename);
    },
});

// File filter
const fileFilter = (req, file, cb) => {
    // Allowed file types
    const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(
            new Error("Invalid file type. Only JPEG, JPG, PNG, WEBP, and GIF files are allowed."),
            false,
        );
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
});

// Single file upload middleware
export const uploadCategoryImage = upload.single("image");

// Multiple files upload middleware (if needed in future)
export const uploadCategoryImages = upload.array("images", 5); // Max 5 images

// Helper function to delete image file
export const deleteImageFile = (imagePath) => {
    if (imagePath && fs.existsSync(imagePath)) {
        fs.unlink(imagePath, (err) => {
            if (err) {
                console.error("Error deleting image file:", err);
            }
        });
    }
};

// Helper function to get full image URL
export const getImageUrl = (filename) => {
    if (!filename) return null;

    // In production, you might want to use your domain
    const baseUrl = process.env.BASE_URL || "http://localhost:5010";

    // Remove the absolute path and get only the filename
    const justFilename = path.basename(filename);

    return `${baseUrl}/uploads/categories/${justFilename}`;
};

// Helper function to get file path from URL
export const getFilePathFromUrl = (url) => {
    if (!url) return null;

    // Extract filename from URL
    const filename = url.split("/").pop();
    return path.join(uploadsDir, filename);
};
