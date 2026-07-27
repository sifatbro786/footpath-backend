// routes/faqRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// MongoDB Schema
const faqSchema = new mongoose.Schema({
    question: String,
    answer: String,
});
const FAQ = mongoose.model("FAQ", faqSchema);

// GET all FAQs
router.get("/", async (req, res) => {
    try {
        const faqs = await FAQ.find();
        res.json(faqs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
