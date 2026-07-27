const express = require("express");
const contactController = require("../controllers/contactController");

const router = express.Router();

router.post("/", contactController.contactUs);
router.get("/test-email", async (req, res) => {
    try {
        const testOptions = {
            name: "Test User",
            email: "test@example.com",
            message: "This is a test email",
        };

        await sendEmail(testOptions);
        res.send("Test email sent successfully");
    } catch (error) {
        console.error("Test email error:", error);
        res.status(500).send("Failed to send test email");
    }
});

module.exports = router;
