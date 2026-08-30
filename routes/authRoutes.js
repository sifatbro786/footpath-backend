import express from "express";
import {
    register,
    login,
    logout,
    getMe,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
    updateProfile,
    changePassword,
    addShippingAddress,
    updateShippingAddress,
    deleteShippingAddress,
} from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { authLimiter, otpLimiter } from "../middlewares/rateLimiter.js";

const router = express.Router();

// Public routes
// FIX: none of these had any rate limiting — brute-forceable OTPs/passwords.
router.post("/register", authLimiter, register);
router.post("/verify-email", otpLimiter, verifyEmail);
router.post("/resend-verification", otpLimiter, resendVerification);
router.post("/login", authLimiter, login);
router.post("/forgot-password", otpLimiter, forgotPassword);
router.put("/reset-password", otpLimiter, resetPassword);

// Protected routes
router.get("/logout", protect, logout);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
// Rate limited with authLimiter: this endpoint verifies the current password,
// which makes it a password oracle for anyone who gets hold of a session.
router.put("/change-password", protect, authLimiter, changePassword);
router.post("/address", protect, addShippingAddress);
router.put("/address/:addressId", protect, updateShippingAddress);
router.delete("/address/:addressId", protect, deleteShippingAddress);

export default router;
