const {
  callLambdaAIChat,
  callLambdaAskAll,
} = require("../services/lambdaService");
const {
  saveMessage,
  getHistory,
  clearHistory,
} = require("../services/chatService");

async function aiChat(req, res) {
  try {
    const { message, sessionId, originalMessage } = req.body;

    console.log("💬 Chat umum dengan AI");
    console.log(`💭 Pesan: ${originalMessage || message}`);

    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Pesan tidak boleh kosong" });
    }
    if (!sessionId) {
      return res
        .status(400)
        .json({ success: false, message: "sessionId tidak boleh kosong" });
    }

    // Simpan pesan asli user ke history (bukan contextual prompt)
    // Frontend bisa kirim originalMessage terpisah kalau message-nya sudah di-inject context
    await saveMessage({
      sessionId,
      role: "user",
      content: originalMessage || message,
    });

    // Kirim full message (bisa berisi contextual prompt) ke Lambda
    const lambdaResponse = await callLambdaAIChat(message);

    // Simpan response assistant
    if (lambdaResponse.success && lambdaResponse.data?.reply) {
      await saveMessage({
        sessionId,
        role: "assistant",
        content: lambdaResponse.data.reply,
      });
    }

    res.status(200).json(lambdaResponse);
  } catch (error) {
    console.error("❌ Error AI chat:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal memproses chat",
        error: error.message,
      });
  }
}

async function askAll(req, res) {
  try {
    const { question, sessionId, originalMessage } = req.body;

    console.log(
      `📚 Pertanyaan tentang semua PDF: ${originalMessage || question}`,
    );

    if (!question) {
      return res
        .status(400)
        .json({ success: false, message: "Pertanyaan tidak boleh kosong" });
    }
    if (!sessionId) {
      return res
        .status(400)
        .json({ success: false, message: "sessionId tidak boleh kosong" });
    }

    await saveMessage({
      sessionId,
      role: "user",
      content: originalMessage || question,
    });

    const lambdaResponse = await callLambdaAskAll(question);

    if (lambdaResponse.success && lambdaResponse.data?.reply) {
      await saveMessage({
        sessionId,
        role: "assistant",
        content: lambdaResponse.data.reply,
      });
    }

    res.status(200).json(lambdaResponse);
  } catch (error) {
    console.error("❌ Error ask-all:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal memproses pertanyaan",
        error: error.message,
      });
  }
}

// GET /ai/history?sessionId=xxx
async function getAIHistory(req, res) {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res
        .status(400)
        .json({ success: false, message: "sessionId tidak boleh kosong" });
    }

    const messages = await getHistory(sessionId);
    res.status(200).json({ success: true, data: { sessionId, messages } });
  } catch (error) {
    console.error("❌ Error get history:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal mengambil history",
        error: error.message,
      });
  }
}

// DELETE /ai/history?sessionId=xxx
async function clearAIHistory(req, res) {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res
        .status(400)
        .json({ success: false, message: "sessionId tidak boleh kosong" });
    }

    const result = await clearHistory(sessionId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("❌ Error clear history:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal menghapus history",
        error: error.message,
      });
  }
}

module.exports = { aiChat, askAll, getAIHistory, clearAIHistory };
