const express = require("express");
const serviceController = require("../controllers/serviceController");
const router = express.Router();

router.post("/submit-request", serviceController.handleServiceRequest);

module.exports = router;
