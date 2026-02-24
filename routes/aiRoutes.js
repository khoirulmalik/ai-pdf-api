const express = require("express");
const router = express.Router();
const { aiChat, askAll } = require("../controllers/aiController");

router.post("/chat", aiChat);
router.post("/ask-all", askAll);

module.exports = router;
