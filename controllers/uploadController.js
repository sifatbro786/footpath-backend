import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(process.cwd(), "uploads");
const productsDir = path.join(uploadsDir, "products");

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log("Created uploads directory:", uploadsDir);
}
if (!fs.existsSync(productsDir)) {
    fs.mkdirSync(productsDir, { recursive: true });
    console.log("Created products directory:", productsDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        console.log("Destination directory:", productsDir);
        console.log("Directory exists:", fs.existsSync(productsDir));
        cb(null, productsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        const filename = `product-${uniqueSuffix}${ext}`;
        console.log("Generated filename:", filename);
        cb(null, filename);
    },
});

// File filter (same as before)
const fileFilter = (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only JPEG, JPG, PNG, WEBP, and GIF files are allowed."), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
});

// Create offers directory
const offersDir = path.join(uploadsDir, "offers");
if (!fs.existsSync(offersDir)) {
    fs.mkdirSync(offersDir, { recursive: true });
    console.log("Created offers directory:", offersDir);
}

// Add a new function for offer image uploads
export const uploadOfferImage = async (req, res) => {
    try {
        // Temporarily change storage destination for offers
        const offerStorage = multer.diskStorage({
            destination: function (req, file, cb) {
                cb(null, offersDir);
            },
            filename: function (req, file, cb) {
                const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
                const ext = path.extname(file.originalname);
                const filename = `offer-${uniqueSuffix}${ext}`;
                cb(null, filename);
            },
        });

        const offerUpload = multer({
            storage: offerStorage,
            fileFilter: fileFilter,
            limits: {
                fileSize: 5 * 1024 * 1024,
            },
        }).single("image");

        // Process upload
        offerUpload(req, res, async (err) => {
            if (err) {
                return handleUploadError(err, req, res);
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "No file uploaded",
                });
            }

            const baseUrl = process.env.BASE_URL || "http://localhost:5010";
            const imageUrl = `${baseUrl}/uploads/offers/${req.file.filename}`;

            res.status(200).json({
                success: true,
                message: "Image uploaded successfully",
                imageUrl: imageUrl,
                filename: req.file.filename,
                file: {
                    url: imageUrl,
                    filename: req.file.filename,
                    originalname: req.file.originalname,
                    size: req.file.size,
                    mimetype: req.file.mimetype,
                },
            });
        });
    } catch (error) {
        console.error("Offer image upload error:", error);
        res.status(500).json({
            success: false,
            message: "Error uploading offer image",
        });
    }
};

export const uploadMultipleImages = async (req, res) => {
    try {
        console.log("Upload request received");
        console.log("Files:", req.files);
        console.log("Upload directory:", productsDir);

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No files uploaded",
            });
        }

        // Check if files actually exist on disk
        req.files.forEach((file, index) => {
            console.log(`File ${index}:`, {
                filename: file.filename,
                path: file.path,
                size: file.size,
                exists: fs.existsSync(file.path),
            });
        });

        const baseUrl = process.env.BASE_URL || "http://localhost:5010";

        const uploadedFiles = req.files.map((file) => {
            // Create correct URL
            const fileUrl = `${baseUrl}/uploads/products/${file.filename}`;

            return {
                url: fileUrl,
                filename: file.filename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                path: file.path,
                public_id: file.filename,
            };
        });

        console.log("Uploaded files info:", uploadedFiles);

        res.status(200).json({
            success: true,
            message: "Images uploaded successfully",
            files: uploadedFiles,
            count: uploadedFiles.length,
        });
    } catch (error) {
        console.error("Upload error:", error.message);
        res.status(500).json({
            success: false,
            message: "Error uploading images: " + error.message,
        });
    }
};

// Single Image Upload (Local)
export const uploadImage = async (req, res) => {
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
            message: "Image uploaded successfully",
            imageUrl: imageUrl,
            filename: req.file.filename,
            file: {
                url: imageUrl,
                filename: req.file.filename,
                originalname: req.file.originalname,
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
};
// Error handling middleware
export const handleUploadError = (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
                success: false,
                message: "File too large. Maximum size is 5MB.",
            });
        }
        if (error.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({
                success: false,
                message: "Too many files uploaded.",
            });
        }
        if (error.code === "LIMIT_UNEXPECTED_FILE") {
            return res.status(400).json({
                success: false,
                message: "Unexpected file field.",
            });
        }
    }

    if (error.message === "Only JPEG, JPG, PNG, WEBP, and GIF files are allowed.") {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }

    console.error("Upload error:", error);
    res.status(500).json({
        success: false,
        message: "Upload failed: " + error.message,
    });
};

// Export the multer instance
export default upload;
