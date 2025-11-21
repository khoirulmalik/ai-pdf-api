// cek-model.js
require("dotenv").config();

const API_KEY = process.env.GEMINI_API_KEY;
const URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

console.log("🔍 Sedang menghubungi Google untuk meminta daftar model...");

fetch(URL)
  .then((response) => response.json())
  .then((data) => {
    if (data.error) {
      console.error("❌ Error:", data.error.message);
      return;
    }

    console.log("\n✅ DAFTAR MODEL YANG TERSEDIA UNTUK ANDA:");
    console.log("===========================================");

    const models = data.models || [];
    // Filter hanya model yang bisa generate text (chat)
    const chatModels = models.filter((m) =>
      m.supportedGenerationMethods.includes("generateContent")
    );

    if (chatModels.length === 0) {
      console.log("⚠️ Tidak ditemukan model chat. Cek API Key Anda.");
    }

    chatModels.forEach((model) => {
      // Hapus prefix 'models/' agar mudah dibaca
      const cleanName = model.name.replace("models/", "");
      console.log(`👉 ${cleanName}`);
    });
    console.log("===========================================");
    console.log(
      "TIPS: Pilih salah satu nama di atas untuk ditaruh di server.js"
    );
  })
  .catch((err) => {
    console.error("❌ Gagal menghubungi server:", err.message);
  });
