import express from "express";
import { body } from "express-validator";
import {
    createCoupon,
    getAllCoupons,
    getCouponById,
    updateCoupon,
    deleteCoupon,
} from "../../controllers/couponController.js";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

// All routes are protected and admin only
router.use(protect, admin);

// Mirrors Coupon.js schema exactly (couponType enum, conditional value rule,
// appliesTo enum, required startDate/expiryDate) — same validationResult(req)
// pattern used in productAdminRoutes.js / productController.js.
const couponValidationRules = [
    body("code").trim().notEmpty().withMessage("Coupon code is required"),
    body("couponType")
        .isIn(["percentage", "fixed_amount", "free_shipping"])
        .withMessage("Coupon type must be percentage, fixed_amount, or free_shipping"),
    body("value").isFloat({ min: 0 }).withMessage("Discount value must be a non-negative number"),
    body("minOrderAmount")
        .optional()
        .isFloat({ min: 0 })
        .withMessage("Minimum order amount cannot be negative"),
    body("maxDiscountAmount")
        .optional({ nullable: true })
        .isFloat({ min: 0 })
        .withMessage("Maximum discount amount cannot be negative"),
    body("maxUsage")
        .optional()
        .isInt({ min: 0 })
        .withMessage("Total max usage must be a non-negative integer"),
    body("usagePerCustomer")
        .optional()
        .isInt({ min: 0 })
        .withMessage("Usage per customer must be a non-negative integer"),
    body("appliesTo")
        .optional()
        .isIn(["all", "products", "categories"])
        .withMessage("Applies-to must be all, products, or categories"),
    body("startDate").isISO8601().withMessage("Valid start date is required"),
    body("expiryDate").isISO8601().withMessage("Valid expiry date is required"),
];

router.route("/").post(couponValidationRules, createCoupon).get(getAllCoupons);
router
    .route("/:id")
    .get(getCouponById)
    .put(couponValidationRules, updateCoupon)
    .delete(deleteCoupon);

export default router;
