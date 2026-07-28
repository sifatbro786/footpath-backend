import express from "express";
import { createLazychatOrder, getLazychatProducts } from "../controllers/lazychatController.js";

const router = express.Router();

// Step 1: Lazychat fetches all products (public, but token-protected via middleware below)
// Lazychat will call: GET /api/lazychat/products
// Authorization: Bearer <LAZYCHAT_INCOMING_TOKEN> from .env
router.get("/products", verifyLazychatToken, getLazychatProducts);

// Step 3: Lazychat posts order to this endpoint
// POST /api/lazychat/order/create
router.post("/order/create", verifyLazychatToken, createLazychatOrder);

// Simple token middleware — Lazychat sends a Bearer token you define in .env
function verifyLazychatToken(req, res, next) {
    const auth = req.headers["authorization"] || "";
    const token = auth.replace("Bearer ", "").trim();
    if (!token || token !== process.env.LAZYCHAT_INCOMING_TOKEN) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    next();
}

export default router;
