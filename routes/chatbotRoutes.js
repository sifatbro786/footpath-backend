const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const fetch = require("node-fetch");

const faqSchema = new mongoose.Schema({
    question: String,
    answer: String,
});
const FAQ = mongoose.models.FAQ || mongoose.model("FAQ", faqSchema);

router.post("/", async (req, res) => {
    const { question } = req.body;

    try {
        // ১. FAQ collection থেকে মিল খুঁজে বের করা
        const faq = await FAQ.findOne({
            question: { $regex: question, $options: "i" },
        });

        if (faq) {
            // ২. FAQ থেকে পাওয়া answer সরাসরি পাঠানো
            return res.json({ answer: faq.answer });
        }

        // ৩. FAQ না মেললে AI কে প্রশ্ন পাঠানো
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama3-8b-8192",
                messages: [{ role: "user", content: question }],
                max_tokens: 512,
            }),
        });

        const data = await groqRes.json();
        const aiAnswer = data.choices?.[0]?.message?.content || "Sorry, I don't know the answer.";

        res.json({ answer: aiAnswer });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
    }
});

module.exports = router;
