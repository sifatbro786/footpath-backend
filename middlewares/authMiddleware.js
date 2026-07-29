import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
            token = req.headers.authorization.split(" ")[1];
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Not authorized, no token",
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select("-password");

        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "User not found",
            });
        }

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Not authorized, token failed",
        });
    }
};

export const optionalProtect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
            token = req.headers.authorization.split(" ")[1];

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select("-password");
        }
        // If no token, req.user will be undefined (guest user)
        next();
    } catch (error) {
        // Token invalid, but continue as guest
        next();
    }
};

// FIX: role hierarchy — "executive" sits above "admin" and must pass every
// admin-gated route too. Previously this checked role === "admin" only, so
// any executive account (schema allows it; it's your top "System
// Administrator" account) got 403 on literally every /admin/* route.
const ADMIN_ROLES = ["admin", "executive"];

export const admin = (req, res, next) => {
    if (req.user && ADMIN_ROLES.includes(req.user.role)) {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: "Not authorized as admin",
        });
    }
};

// alias, kept because several route files import it by this name
export const adminOnly = admin;

// NEW: Authorize middleware for multiple roles
export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Not authorized to access this route",
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `User role ${req.user.role} is not authorized to access this route. Required roles: ${roles.join(", ")}`,
            });
        }
        next();
    };
};

// NEW: Executive or Admin middleware
export const executiveOrAdmin = (req, res, next) => {
    if (req.user && (req.user.role === "executive" || req.user.role === "admin")) {
        next();
    } else {
        res.status(403).json({
            success: false,
            message: "Not authorized as executive or admin",
        });
    }
};

// NEW: Check if user is verified
export const requireVerifiedEmail = (req, res, next) => {
    if (req.user && !req.user.isEmailVerified) {
        return res.status(403).json({
            success: false,
            message: "Please verify your email address to access this resource",
        });
    }
    next();
};

// NEW: Check if user is active
export const requireActiveStatus = (req, res, next) => {
    if (req.user && req.user.status !== "active") {
        return res.status(403).json({
            success: false,
            message: `Your account is ${req.user.status}. Please contact support.`,
        });
    }
    next();
};

// NEW: Combined middleware for protected admin routes
export const adminProtect = [protect, adminOnly];

// NEW: Combined middleware for protected executive routes
export const executiveProtect = [protect, executiveOrAdmin];
