import express from "express";
import {
    handleIPN,
    processSuccessRedirect,
    processFailRedirect,
    processCancelRedirect,
} from "../controllers/paymentController.js";

const router = express.Router();

router.route("/process-success").get(processSuccessRedirect).post(processSuccessRedirect);

router.route("/process-fail").get(processFailRedirect).post(processFailRedirect);

router.route("/process-cancel").get(processCancelRedirect).post(processCancelRedirect);

router.post("/ipn", handleIPN);

router.get("/test", (req, res) => {
    res.json({
        success: true,
        message: "Payment route is working!",
        timestamp: new Date().toISOString(),
    });
});

export default router;
