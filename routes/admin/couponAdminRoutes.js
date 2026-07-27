import express from "express";
import {
    createCoupon,
    getAllCoupons,
    updateCoupon,
    deleteCoupon,
} from "../../controllers/couponController.js";
import { protect, admin } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

router.route("/").post(createCoupon).get(getAllCoupons);
router.route("/:id").put(updateCoupon).delete(deleteCoupon);

export default router;
