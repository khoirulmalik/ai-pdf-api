const express = require("express");
const router = express.Router();
const {
  aiChat,
  askAll,
  getAIHistory,
  clearAIHistory,
} = require("../controllers/aiController");

router.post("/chat", aiChat);
router.post("/ask-all", askAll);
router.get("/history", getAIHistory); // GET /ai/history?sessionId=xxx
router.delete("/history", clearAIHistory); // DELETE /ai/history?sessionId=xxx

module.exports = router;
