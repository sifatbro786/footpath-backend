// routes/admin.shippingRoutes.js
import express from "express";
import { protect, adminOnly } from "../../middlewares/authMiddleware.js";
import {
    getAllDistricts,
    getDistrictById,
    createDistrict,
    updateDistrict,
    deleteDistrict,
    addUpazila,
    updateUpazila,
    deleteUpazila,
    getAllCourierBranches,
    createCourierBranch,
    updateCourierBranch,
    deleteCourierBranch,
    addBranchToDistrict,
    removeBranchFromDistrict,
    getAllShippingRates,
    createShippingRate,
    updateShippingRate,
} from "../../controllers/admin/adminShippingController.js";

const router = express.Router();
router.use(protect, adminOnly); // সব routes admin protected

// Districts
router.get("/districts", getAllDistricts);
router.get("/districts/:id", getDistrictById);
router.post("/districts", createDistrict);
router.put("/districts/:id", updateDistrict);
router.delete("/districts/:id", deleteDistrict);

// Upazilas (nested under district)
router.post("/districts/:id/upazilas", addUpazila);
router.put("/districts/:id/upazilas/:upazilaId", updateUpazila);
router.delete("/districts/:id/upazilas/:upazilaId", deleteUpazila);

// Courier Branches
router.get("/courier-branches", getAllCourierBranches);
router.post("/courier-branches", createCourierBranch);
router.put("/courier-branches/:id", updateCourierBranch);
router.delete("/courier-branches/:id", deleteCourierBranch);
router.post("/courier-branches/:id/add-branch", addBranchToDistrict);
router.delete("/courier-branches/:id/remove-branch", removeBranchFromDistrict);

// Shipping Rates
router.get("/rates", getAllShippingRates);
router.post("/rates", createShippingRate);
router.put("/rates/:id", updateShippingRate);

export default router;
