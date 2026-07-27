import express from "express";
import {
    calculateCheckoutData,
    getDistricts,
    getUpazilas,
    getCourierBranches,
    validateLocation,
    getCourierDistricts,
} from "../controllers/checkoutController.js";
import { protect, optionalProtect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Existing routes
router.get("/districts", getDistricts);
router.get("/upazilas/:district", getUpazilas);
router.get("/courier-branches/:district", getCourierBranches);
router.get("/courier-districts", getCourierDistricts);

router.post("/validate-location", optionalProtect, validateLocation);
router.post("/calculate", optionalProtect, calculateCheckoutData);

export default router;
