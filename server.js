// server.js
const express = require("express");
const multer = require("multer");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();
const cors = require("cors");
const app = express();

const PORT = process.env.PORT || 3000;
const corsOptions = {
  origin: "http://localhost:5173", // origin frontend kamu
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// Konfigurasi AWS S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

// Konfigurasi Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
// Database sederhana (JSON file)
const DB_FILE = path.join(__dirname, "pdf-database.json");

// Helper: Load database
async function loadDatabase() {
  try {
    const data = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return { pdfs: [] };
  }
}

// Helper: Save database
async function saveDatabase(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

// Helper: Extract text dari PDF menggunakan PDF.js
async function extractTextFromPDF(pdfBuffer) {
  try {
    const uint8Array = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const pdfDocument = await loadingTask.promise;

    const numPages = pdfDocument.numPages;
    let fullText = "";

    // Extract text dari setiap halaman
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      fullText += pageText + "\n";
    }

    return {
      text: fullText,
      numPages: numPages,
    };
  } catch (error) {
    console.error("❌ Error extract PDF:", error.message);
    throw error;
  }
}

// Helper: Analisis PDF dengan Gemini
async function analyzePDFWithGemini(pdfBuffer, fileName) {
  try {
    console.log("🤖 Memulai analisis dengan Gemini AI...");

    // Extract text dari PDF menggunakan PDF.js
    const { text, numPages } = await extractTextFromPDF(pdfBuffer);
    const textContent = text.substring(0, 50000); // Limit 50k chars untuk efisiensi

    console.log(`📄 Teks berhasil di-extract (${numPages} halaman)`);

    const prompt = `
Analisis dokumen PDF berikut dan berikan informasi dalam format JSON:

{
  "title": "judul dokumen (jika tidak ada, buat berdasarkan konten)",
  "summary": "ringkasan 2-3 kalimat",
  "category": "kategori dokumen (misal: Akademik, Bisnis, Teknis, dll)",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "language": "bahasa dokumen",
  "mainTopics": ["topik utama 1", "topik utama 2", "topik utama 3"]
}

Konten dokumen:
${textContent}

Berikan HANYA JSON, tanpa markdown atau teks lain.`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // Parse JSON dari response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Gagal parsing JSON dari Gemini");
    }

    const analysis = JSON.parse(jsonMatch[0]);
    console.log("✅ Analisis selesai!");

    return {
      ...analysis,
      pageCount: numPages,
      analyzedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("❌ Error analisis Gemini:", error.message);
    console.error("📋 Stack:", error.stack);
    return {
      title: fileName,
      summary: "Gagal menganalisis dokumen",
      category: "Unknown",
      keywords: [],
      language: "Unknown",
      mainTopics: [],
      pageCount: 0,
      error: error.message,
    };
  }
}

// Middleware untuk logging yang lebih detail
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString("id-ID");
  console.log("\n" + "=".repeat(60));
  console.log(`⏰ ${timestamp}`);
  console.log(`📍 ${req.method} ${req.url}`);
  console.log(`🌐 IP: ${req.ip}`);
  if (Object.keys(req.query).length > 0) {
    console.log(`🔍 Query:`, req.query);
  }
  if (req.params && Object.keys(req.params).length > 0) {
    console.log(`📝 Params:`, req.params);
  }
  console.log("=".repeat(60));
  next();
});

// Konfigurasi Multer untuk handle upload file
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // Limit 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Hanya file PDF yang diperbolehkan!"), false);
    }
  },
});

app.use(express.json());

// Endpoint: Upload PDF ke S3
app.post("/api/pdf/upload", upload.single("pdf"), async (req, res) => {
  try {
    console.log("📤 Memulai proses upload...");

    if (!req.file) {
      console.log("❌ File tidak ditemukan");
      return res.status(400).json({
        success: false,
        message: "File PDF tidak ditemukan",
      });
    }

    console.log(`📄 File diterima: ${req.file.originalname}`);
    console.log(`📦 Ukuran: ${(req.file.size / 1024).toFixed(2)} KB`);

    const fileName = `${Date.now()}-${req.file.originalname}`;
    console.log(`🏷️  Nama file di S3: ${fileName}`);

    const params = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: "application/pdf",
    };

    console.log("☁️  Mengupload ke S3...");
    const command = new PutObjectCommand(params);
    await s3Client.send(command);
    console.log("✅ Upload ke S3 berhasil!");

    // Generate signed URL
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    });
    const signedUrl = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 3600,
    });
    console.log("🔗 Signed URL berhasil di-generate");

    // Analisis PDF dengan Gemini
    const analysis = await analyzePDFWithGemini(
      req.file.buffer,
      req.file.originalname
    );

    // Simpan ke database
    const db = await loadDatabase();
    const pdfRecord = {
      id: fileName,
      fileName: fileName,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      fileSizeFormatted: `${(req.file.size / 1024).toFixed(2)} KB`,
      uploadedAt: new Date().toISOString(),
      url: signedUrl,
      analysis: analysis,
    };

    db.pdfs.push(pdfRecord);
    await saveDatabase(db);
    console.log("💾 Data berhasil disimpan ke database");

    const response = {
      success: true,
      message: "PDF berhasil diupload dan dianalisis",
      data: pdfRecord,
    };

    console.log("✨ Response:", JSON.stringify(response, null, 2));
    res.status(200).json(response);
  } catch (error) {
    console.error("❌ Error upload PDF:", error.message);
    console.error("📋 Stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Gagal mengupload PDF",
      error: error.message,
    });
  }
});

// Endpoint: Hapus PDF dari S3
app.delete("/api/pdf/delete/:fileName", async (req, res) => {
  try {
    const { fileName } = req.params;
    console.log(`🗑️  Memulai proses hapus file: ${fileName}`);

    if (!fileName) {
      console.log("❌ Nama file kosong");
      return res.status(400).json({
        success: false,
        message: "Nama file tidak boleh kosong",
      });
    }

    const params = {
      Bucket: BUCKET_NAME,
      Key: fileName,
    };

    console.log("☁️  Menghapus dari S3...");
    const command = new DeleteObjectCommand(params);
    await s3Client.send(command);
    console.log("✅ File berhasil dihapus dari S3!");

    // Hapus dari database
    const db = await loadDatabase();
    db.pdfs = db.pdfs.filter(
      (p) => p.fileName !== fileName && p.id !== fileName
    );
    await saveDatabase(db);
    console.log("💾 Data berhasil dihapus dari database");

    const response = {
      success: true,
      message: "PDF berhasil dihapus",
      data: {
        fileName: fileName,
        deletedAt: new Date().toISOString(),
      },
    };

    console.log("✨ Response:", JSON.stringify(response, null, 2));
    res.status(200).json(response);
  } catch (error) {
    console.error("❌ Error hapus PDF:", error.message);
    console.error("📋 Stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Gagal menghapus PDF",
      error: error.message,
    });
  }
});

// Endpoint: Get signed URL untuk download PDF
app.get("/api/pdf/url/:fileName", async (req, res) => {
  try {
    const { fileName } = req.params;
    const expiresIn = parseInt(req.query.expires) || 3600;

    console.log(`🔗 Generate URL untuk: ${fileName}`);
    console.log(
      `⏱️  Expire dalam: ${expiresIn} detik (${expiresIn / 3600} jam)`
    );

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileName,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    console.log("✅ URL berhasil di-generate!");

    const response = {
      success: true,
      data: {
        fileName: fileName,
        url: signedUrl,
        expiresIn: expiresIn,
      },
    };

    console.log("✨ Response:", JSON.stringify(response, null, 2));
    res.status(200).json(response);
  } catch (error) {
    console.error("❌ Error generate URL:", error.message);
    console.error("📋 Stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Gagal generate URL",
      error: error.message,
    });
  }
});

// Endpoint: List semua PDF di S3
app.get("/api/pdf/list", async (req, res) => {
  try {
    console.log(`📋 Mengambil list PDF dari database...`);

    const db = await loadDatabase();
    const files = db.pdfs;

    console.log(`✅ Ditemukan ${files.length} file`);

    const response = {
      success: true,
      data: {
        total: files.length,
        files: files,
      },
    };

    console.log(
      "✨ Response:",
      JSON.stringify({ total: files.length }, null, 2)
    );
    res.status(200).json(response);
  } catch (error) {
    console.error("❌ Error list PDF:", error.message);
    console.error("📋 Stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil list PDF",
      error: error.message,
    });
  }
});

// Endpoint: Get detail PDF by ID
app.get("/api/pdf/detail/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 Mencari PDF dengan ID: ${id}`);

    const db = await loadDatabase();
    const pdf = db.pdfs.find((p) => p.id === id || p.fileName === id);

    if (!pdf) {
      return res.status(404).json({
        success: false,
        message: "PDF tidak ditemukan",
      });
    }

    // Generate URL baru (refresh signed URL)
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: pdf.fileName,
    });
    const signedUrl = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 3600,
    });
    pdf.url = signedUrl;

    res.status(200).json({
      success: true,
      data: pdf,
    });
  } catch (error) {
    console.error("❌ Error get detail:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil detail PDF",
      error: error.message,
    });
  }
});

// Endpoint: Search PDF
app.get("/api/pdf/search", async (req, res) => {
  try {
    const query = req.query.q?.toLowerCase() || "";
    console.log(`🔍 Mencari PDF dengan query: "${query}"`);

    const db = await loadDatabase();
    const results = db.pdfs.filter((pdf) => {
      const searchText = `
        ${pdf.originalName} 
        ${pdf.analysis?.title || ""} 
        ${pdf.analysis?.summary || ""} 
        ${pdf.analysis?.category || ""} 
        ${pdf.analysis?.keywords?.join(" ") || ""}
      `.toLowerCase();

      return searchText.includes(query);
    });

    console.log(`✅ Ditemukan ${results.length} hasil`);

    res.status(200).json({
      success: true,
      data: {
        query: query,
        total: results.length,
        results: results,
      },
    });
  } catch (error) {
    console.error("❌ Error search:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal melakukan pencarian",
      error: error.message,
    });
  }
});

// Endpoint: Chat dengan AI tentang PDF tertentu
app.post("/api/pdf/chat/:id", express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { question } = req.body;

    console.log(`💬 Chat request untuk PDF: ${id}`);
    console.log(`❓ Pertanyaan: ${question}`);

    if (!question) {
      return res.status(400).json({
        success: false,
        message: "Pertanyaan tidak boleh kosong",
      });
    }

    // Ambil PDF dari database
    const db = await loadDatabase();
    const pdf = db.pdfs.find((p) => p.id === id || p.fileName === id);

    if (!pdf) {
      return res.status(404).json({
        success: false,
        message: "PDF tidak ditemukan",
      });
    }

    console.log(`📄 PDF ditemukan: ${pdf.originalName}`);

    // Download PDF dari S3
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: pdf.fileName,
    });
    const s3Response = await s3Client.send(getCommand);
    const pdfBuffer = Buffer.from(await s3Response.Body.transformToByteArray());

    // Extract text dari PDF menggunakan PDF.js
    console.log("📖 Mengekstrak text dari PDF...");
    const { text } = await extractTextFromPDF(pdfBuffer);
    const textContent = text.substring(0, 100000); // Limit 100k chars

    // Tanya ke Gemini
    console.log("🤖 Mengirim pertanyaan ke Gemini AI...");
    const prompt = `
Kamu adalah asisten AI yang membantu menjawab pertanyaan tentang dokumen PDF.

Informasi dokumen:
- Judul: ${pdf.analysis?.title || pdf.originalName}
- Kategori: ${pdf.analysis?.category || "Unknown"}
- Ringkasan: ${pdf.analysis?.summary || "Tidak ada ringkasan"}
- Topik utama: ${pdf.analysis?.mainTopics?.join(", ") || "Tidak ada"}

Konten dokumen:
${textContent}

Pertanyaan pengguna: ${question}

Jawab pertanyaan dengan jelas dan informatif berdasarkan konten dokumen di atas. Jika informasi tidak ada di dokumen, katakan dengan jujur.
`;

    const result = await model.generateContent(prompt);
    const answer = result.response.text();

    console.log("✅ Jawaban berhasil di-generate!");

    res.status(200).json({
      success: true,
      data: {
        pdfId: pdf.id,
        pdfTitle: pdf.analysis?.title || pdf.originalName,
        question: question,
        answer: answer,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ Error chat:", error.message);
    console.error("📋 Stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Gagal memproses chat",
      error: error.message,
    });
  }
});

// Endpoint: Chat umum dengan AI (tanpa PDF spesifik)
app.post("/api/ai/chat", express.json(), async (req, res) => {
  try {
    const { message } = req.body;

    console.log(`💬 Chat umum dengan AI`);
    console.log(`💭 Pesan: ${message}`);

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Pesan tidak boleh kosong",
      });
    }

    console.log("🤖 Mengirim ke Gemini AI...");
    const result = await model.generateContent(message);
    const response = result.response.text();

    console.log("✅ Response berhasil!");

    res.status(200).json({
      success: true,
      data: {
        message: message,
        response: response,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ Error AI chat:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal memproses chat",
      error: error.message,
    });
  }
});

// Endpoint: Tanya AI tentang semua PDF (RAG sederhana)
app.post("/api/ai/ask-all", express.json(), async (req, res) => {
  try {
    const { question } = req.body;

    console.log(`🔍 Pertanyaan tentang semua PDF: ${question}`);

    if (!question) {
      return res.status(400).json({
        success: false,
        message: "Pertanyaan tidak boleh kosong",
      });
    }

    // Ambil semua PDF
    const db = await loadDatabase();

    if (db.pdfs.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Belum ada PDF yang diupload",
      });
    }

    // Compile informasi dari semua PDF
    const allPdfInfo = db.pdfs
      .map(
        (pdf) => `
Dokumen: ${pdf.originalName}
Judul: ${pdf.analysis?.title || "N/A"}
Kategori: ${pdf.analysis?.category || "N/A"}
Ringkasan: ${pdf.analysis?.summary || "N/A"}
Keywords: ${pdf.analysis?.keywords?.join(", ") || "N/A"}
Topik: ${pdf.analysis?.mainTopics?.join(", ") || "N/A"}
---
`
      )
      .join("\n");

    console.log(`📚 Menganalisis ${db.pdfs.length} dokumen...`);

    const prompt = `
Kamu adalah asisten AI yang membantu mencari informasi dari kumpulan dokumen PDF.

Berikut adalah ringkasan dari ${db.pdfs.length} dokumen yang tersedia:

${allPdfInfo}

Pertanyaan pengguna: ${question}

Jawab pertanyaan berdasarkan informasi dokumen di atas. Jika perlu, sebutkan dokumen mana yang relevan. Jika informasi tidak cukup, katakan dengan jelas.
`;

    console.log("🤖 Mengirim ke Gemini AI...");
    const result = await model.generateContent(prompt);
    const answer = result.response.text();

    console.log("✅ Jawaban berhasil!");

    res.status(200).json({
      success: true,
      data: {
        question: question,
        answer: answer,
        analyzedDocuments: db.pdfs.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ Error ask-all:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal memproses pertanyaan",
      error: error.message,
    });
  }
});

// Error handler untuk Multer
app.use((error, req, res, next) => {
  console.error("❌ Error caught:", error.message);

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Ukuran file terlalu besar. Maksimal 10MB",
      });
    }
    if (error.code === "UNEXPECTED_FIELD") {
      return res.status(400).json({
        success: false,
        message:
          'Field name harus "pdf". Pastikan di Postman form-data key-nya adalah "pdf" (huruf kecil) dan type-nya File',
        receivedField: error.field,
      });
    }
  }

  if (error.message.includes("Hanya file PDF")) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  res.status(500).json({
    success: false,
    message: error.message,
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "Server is running" });
});

app.listen(PORT, () => {
  console.log("\n" + "🎉".repeat(30));
  console.log("🚀 SERVER BERHASIL BERJALAN!");
  console.log("=".repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`☁️  AWS Region: ${process.env.AWS_REGION}`);
  console.log(`🪣 S3 Bucket: ${BUCKET_NAME}`);
  console.log(
    `🤖 AI: Google Gemini ${process.env.GEMINI_API_KEY ? "✅" : "❌"}`
  );
  console.log("=".repeat(60));
  console.log("📡 PDF Management Endpoints:");
  console.log(`   ✅ Health Check:  http://localhost:${PORT}/health`);
  console.log(`   📋 List PDFs:     http://localhost:${PORT}/api/pdf/list`);
  console.log(
    `   🔍 Search PDFs:   http://localhost:${PORT}/api/pdf/search?q=keyword`
  );
  console.log(
    `   📄 PDF Detail:    http://localhost:${PORT}/api/pdf/detail/:id`
  );
  console.log(`   📤 Upload PDF:    http://localhost:${PORT}/api/pdf/upload`);
  console.log(
    `   🔗 Get URL:       http://localhost:${PORT}/api/pdf/url/:fileName`
  );
  console.log(
    `   🗑️  Delete PDF:    http://localhost:${PORT}/api/pdf/delete/:fileName`
  );
  console.log("");
  console.log("🤖 AI Chat Endpoints:");
  console.log(`   💬 Chat PDF:      http://localhost:${PORT}/api/pdf/chat/:id`);
  console.log(`   💭 Chat Umum:     http://localhost:${PORT}/api/ai/chat`);
  console.log(`   📚 Tanya Semua:   http://localhost:${PORT}/api/ai/ask-all`);
  console.log("=".repeat(60));
  console.log("👀 Watching for changes...\n");
});

module.exports = app;
