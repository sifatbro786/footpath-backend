import express from "express";
import { body } from "express-validator";
import {
    createCustomer,
    deleteCustomer,
    exportCustomers,
    getCustomers,
    importCustomers,
    updateCustomer,
} from "../../controllers/admin/customerController.js";
import { admin, protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();
router.use(protect, admin);

const fields = [
    body("name").optional().isString().isLength({ max: 120 }).trim(),
    body("email").optional({ values: "falsy" }).isEmail().withMessage("Invalid email"),
    body("district").optional().isString().isLength({ max: 80 }).trim(),
    body("address").optional().isString().isLength({ max: 300 }).trim(),
    body("note").optional().isString().isLength({ max: 1000 }).trim(),
    body("marketingOptIn").optional().isBoolean().toBoolean(),
    body("tags").optional().custom((v) => Array.isArray(v) || typeof v === "string"),
];

// Literal routes before /:id.
router.get("/export", exportCustomers);
router.post("/import", [body("rows").isArray({ min: 1 }), body("mode").optional().isIn(["skip", "update"])], importCustomers);

router.get("/", getCustomers);
router.post("/", [body("phone").isString().notEmpty().withMessage("Phone is required"), ...fields], createCustomer);
router.patch("/:id", [body("phone").optional().isString(), ...fields], updateCustomer);
router.delete("/:id", deleteCustomer);

export default router;
