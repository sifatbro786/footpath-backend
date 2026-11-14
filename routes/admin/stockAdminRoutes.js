import express from "express";
import { body } from "express-validator";
import { adjustStock, getMovements, getStock } from "../../controllers/admin/stockController.js";
import { admin, protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect, admin);

// Literal routes before any future /:id.
router.get("/movements", getMovements);
router.post(
    "/adjust",
    [
        body("productId").isMongoId().withMessage("Invalid product"),
        body("mode").isIn(["in", "out", "set"]).withMessage("Invalid mode"),
        body("quantity").isInt({ min: 0, max: 1000000 }).withMessage("Quantity must be a whole number").toInt(),
        body("options").optional().isArray({ max: 10 }),
        body("note").optional().isString().isLength({ max: 500 }),
    ],
    adjustStock,
);
router.get("/", getStock);

export default router;
