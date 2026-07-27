import express from "express";
import {
    createProduct,
    getAdminProducts,
    updateProduct,
    deleteProduct,
    updateStock,
    createDynamicSection,
    updateDynamicSection,
    deleteDynamicSection,
    getAllDynamicSections,
    toggleSectionStatus,
    searchProductsForAdmin,
    getAdminProductsOptimized,
    reorderProducts,
    bulkUpdateCategoryOrders,
    getOrderedProducts,
    getNextDisplayOrder,
} from "../../controllers/productController.js";

import { body } from "express-validator";
import { protect, admin } from "../../middlewares/authMiddleware.js";
import { setUploadDir, uploadSingle } from "../../middlewares/upload.js";

const router = express.Router();

// Mounted at /api/v1/admin/products — all routes here are admin-only.
router.use(protect, admin);

const productValidationRules = [
    body("name").notEmpty().withMessage("Product name is required"),
    body("category").isMongoId().withMessage("Valid category ID is required"),
    body("basePrice").isNumeric().withMessage("Base price must be a number"),
    body("stock").isInt({ min: 0 }).withMessage("Stock must be a non-negative integer"),
];

const sectionValidationRules = [
    body("title").notEmpty().withMessage("Section title is required"),
    body("attributeKey").notEmpty().withMessage("Attribute key is required"),
    body("attributeValue").notEmpty().withMessage("Attribute value is required"),
];

const reorderValidationRules = [
    body("products").isArray().withMessage("Products must be an array"),
    body("products.*.productId").isMongoId().withMessage("Valid product ID is required"),
    body("products.*.displayOrder")
        .isInt({ min: 0 })
        .withMessage("Display order must be a non-negative integer"),
];

const bulkCategoryOrderValidationRules = [
    body("categoryId").isMongoId().withMessage("Valid category ID is required"),
    body("products").isArray().withMessage("Products must be an array"),
    body("products.*.productId").isMongoId().withMessage("Valid product ID is required"),
    body("products.*.displayOrder")
        .optional()
        .isInt({ min: 0 })
        .withMessage("Display order must be a non-negative integer"),
];

// Dashboard
router.get("/dashboard", getAdminProducts);
router.get("/dashboard/optimized", getAdminProductsOptimized);

// Ordering
router.put("/reorder", reorderValidationRules, reorderProducts);
router.put("/category/:categoryId/reorder", bulkCategoryOrderValidationRules, bulkUpdateCategoryOrders);
router.get("/next-order", getNextDisplayOrder);
router.get("/next-order/category/:categoryId", getNextDisplayOrder);
router.get("/ordered-list", getOrderedProducts);

// Dynamic sections
router.get("/sections", getAllDynamicSections);
router.get("/search", searchProductsForAdmin);
router.post("/sections", sectionValidationRules, createDynamicSection);
router.put("/sections/:sectionId", updateDynamicSection);
router.delete("/sections/:sectionId", deleteDynamicSection);
router.patch("/sections/:sectionId/toggle", toggleSectionStatus);

// Product CRUD
router.post("/", setUploadDir("products"), uploadSingle, productValidationRules, createProduct);
router.put("/:id", setUploadDir("products"), uploadSingle, productValidationRules, updateProduct);
router.delete("/:id", deleteProduct);
router.patch("/:id/stock", updateStock);

export default router;
