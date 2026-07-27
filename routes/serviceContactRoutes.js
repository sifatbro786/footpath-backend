const express = require("express");
const { check } = require("express-validator");
const contactController = require("../controllers/contactController");
const router = express.Router();

// Submit contact form
router.post(
    "/submit",
    [
        check("service").not().isEmpty().withMessage("Service is required"),
        check("name").not().isEmpty().withMessage("Name is required"),
        check("email").isEmail().withMessage("Please enter a valid email"),
        check("message").not().isEmpty().withMessage("Message is required"),
    ],
    contactController.submitContactForm,
);

// Get all contacts (admin only)
router.get("/all", contactController.getAllContacts);

module.exports = router;
