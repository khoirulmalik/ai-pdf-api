const {
  callLambdaAIChat,
  callLambdaAskAll,
} = require("../services/lambdaService");

async function aiChat(req, res) {
  try {
    const { message } = req.body;

    console.log("💬 Chat umum dengan AI");
    console.log(`💭 Pesan: ${message}`);

    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Pesan tidak boleh kosong" });
    }

    const lambdaResponse = await callLambdaAIChat(message);
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
    const { question } = req.body;

    console.log(`📚 Pertanyaan tentang semua PDF: ${question}`);

    if (!question) {
      return res
        .status(400)
        .json({ success: false, message: "Pertanyaan tidak boleh kosong" });
    }

    const lambdaResponse = await callLambdaAskAll(question);
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

module.exports = { aiChat, askAll };
