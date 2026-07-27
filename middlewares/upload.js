import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseUploadsDir = path.join(__dirname, "../uploads");

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const subFolder = req.uploadDir || "others";
        const targetDir = path.join(baseUploadsDir, subFolder);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        cb(null, targetDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname).toLowerCase();
        const prefix = req.uploadDir ? req.uploadDir.slice(0, -1) : "file";
        cb(null, `${prefix}-${uniqueSuffix}${ext}`);
    },
});

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
        fileSize: 50 * 1024 * 1024,
    },
});

export const setUploadDir = (dirName) => {
    return (req, res, next) => {
        req.uploadDir = dirName;
        next();
    };
};

export const uploadSingle = upload.single("image");
export const uploadMultiple = upload.array("images", 10);

export const deleteImageFile = (subFolder, filename) => {
    if (!filename) return;
    const filePath = path.join(process.cwd(), "uploads", subFolder, filename);

    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) console.error("file delete error", err);
            else console.log("Local file delete successfully", filename);
        });
    } else {
        console.log("Filde could not found in directory", filePath);
    }
};

export const getImageUrl = (subFolder, filename) => {
    if (!filename) return null;
    const baseUrl = process.env.BASE_URL || "http://localhost:5010";
    const justFilename = path.basename(filename);
    return `${baseUrl}/uploads/${subFolder}/${justFilename}`;
};
