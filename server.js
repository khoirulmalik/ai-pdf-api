// server.js (Updated - AI processing di Lambda)
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// DynamoDB SDK
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const path = require("path");
require("dotenv").config();
const cors = require("cors");
const app = express();

const PORT = process.env.PORT || 3000;

// Lambda API Gateway URL
const LAMBDA_API_URL = process.env.LAMBDA_API_URL; // Dari API Gateway

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3001",
  "http://localhost:3000",
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
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

// Konfigurasi DynamoDB
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "pdf-documents";

// ========== DynamoDB Helper Functions ==========

async function savePDFToDB(pdfRecord) {
  try {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: pdfRecord,
    });
    await docClient.send(command);
    console.log("💾 Data berhasil disimpan ke DynamoDB");
    return true;
  } catch (error) {
    console.error("❌ Error save to DynamoDB:", error.message);
    throw error;
  }
}

async function getPDFFromDB(id) {
  try {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: { id },
    });
    const response = await docClient.send(command);
    return response.Item || null;
  } catch (error) {
    console.error("❌ Error get from DynamoDB:", error.message);
    throw error;
  }
}

async function deletePDFFromDB(id) {
  try {
    const command = new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { id },
    });
    await docClient.send(command);
    console.log("💾 Data berhasil dihapus dari DynamoDB");
    return true;
  } catch (error) {
    console.error("❌ Error delete from DynamoDB:", error.message);
    throw error;
  }
}

async function getAllPDFsFromDB() {
  try {
    const command = new ScanCommand({
      TableName: TABLE_NAME,
    });
    const response = await docClient.send(command);
    return response.Items || [];
  } catch (error) {
    console.error("❌ Error scan DynamoDB:", error.message);
    throw error;
  }
}

async function searchPDFsInDB(query) {
  try {
    const command = new ScanCommand({
      TableName: TABLE_NAME,
    });
    const response = await docClient.send(command);
    const allPDFs = response.Items || [];

    const lowerQuery = query.toLowerCase();
    return allPDFs.filter((pdf) => {
      const searchText = `
        ${pdf.originalName || ""} 
        ${pdf.analysis?.title || ""} 
        ${pdf.analysis?.summary || ""} 
        ${pdf.analysis?.category || ""} 
        ${pdf.analysis?.keywords?.join(" ") || ""}
      `.toLowerCase();

      return searchText.includes(lowerQuery);
    });
  } catch (error) {
    console.error("❌ Error search DynamoDB:", error.message);
    throw error;
  }
}

// ========== Lambda Helper Functions ==========

// Call Lambda untuk analisis PDF
async function callLambdaAnalyzePDF(fileName, originalName) {
  try {
    console.log("🚀 Calling Lambda for PDF analysis...");
    const response = await axios.post(
      `${LAMBDA_API_URL}/analyze-pdf`,
      {
        fileName: fileName,
        originalName: originalName,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 300000, // 5 minutes
      }
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error calling Lambda:", error.message);
    throw error;
  }
}

// Call Lambda untuk chat dengan PDF
async function callLambdaChatPDF(id, question) {
  try {
    console.log("🚀 Calling Lambda for chat...");
    const response = await axios.post(
      `${LAMBDA_API_URL}/chat-pdf`,
      {
        id: id,
        question: question,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 300000,
      }
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error calling Lambda:", error.message);
    throw error;
  }
}

// Call Lambda untuk chat umum
async function callLambdaAIChat(message) {
  try {
    console.log("🚀 Calling Lambda for general chat...");
    const response = await axios.post(
      `${LAMBDA_API_URL}/ai-chat`,
      {
        message: message,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 300000,
      }
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error calling Lambda:", error.message);
    throw error;
  }
}

// Call Lambda untuk tanya semua PDF
async function callLambdaAskAll(question) {
  try {
    console.log("🚀 Calling Lambda for ask all...");
    const response = await axios.post(
      `${LAMBDA_API_URL}/ask-all`,
      {
        question: question,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 300000,
      }
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error calling Lambda:", error.message);
    throw error;
  }
}

// ========== Middleware ==========

app.use((req, res, next) => {
  const timestamp = new Date().toLocaleString("id-ID");
  console.log("\n" + "=".repeat(60));
  console.log(`⏰ ${timestamp}`);
  console.log(`📝 ${req.method} ${req.url}`);
  console.log(`🌍 IP: ${req.ip}`);
  if (Object.keys(req.query).length > 0) {
    console.log(`🔍 Query:`, req.query);
  }
  console.log("=".repeat(60));
  next();
});

// Konfigurasi Multer
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
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

// ========== API Endpoints ==========

// Endpoint: Upload PDF ke S3 dan analisis dengan Lambda
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
    console.log(`🏷️ Nama file di S3: ${fileName}`);

    // Upload ke S3
    const params = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: "application/pdf",
    };

    console.log("☁️ Mengupload ke S3...");
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

    // Analisis PDF dengan Lambda
    console.log("🤖 Mengirim ke Lambda untuk analisis...");
    const lambdaResponse = await callLambdaAnalyzePDF(
      fileName,
      req.file.originalname
    );

    const analysis = lambdaResponse.success
      ? lambdaResponse.data
      : {
          title: req.file.originalname,
          summary: "Gagal menganalisis dokumen",
          category: "Unknown",
          keywords: [],
          language: "Unknown",
          mainTopics: [],
          pageCount: 0,
        };

    // Simpan ke DynamoDB
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

    await savePDFToDB(pdfRecord);

    const response = {
      success: true,
      message: "PDF berhasil diupload dan dianalisis",
      data: pdfRecord,
    };

    console.log("✨ Response berhasil dikirim");
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

// Endpoint: Hapus PDF dari S3 dan DynamoDB
app.delete("/api/pdf/delete/:fileName", async (req, res) => {
  try {
    const { fileName } = req.params;
    console.log(`🗑️ Memulai proses hapus file: ${fileName}`);

    if (!fileName) {
      console.log("❌ Nama file kosong");
      return res.status(400).json({
        success: false,
        message: "Nama file tidak boleh kosong",
      });
    }

    // Hapus dari S3
    const params = {
      Bucket: BUCKET_NAME,
      Key: fileName,
    };

    console.log("☁️ Menghapus dari S3...");
    const command = new DeleteObjectCommand(params);
    await s3Client.send(command);
    console.log("✅ File berhasil dihapus dari S3!");

    // Hapus dari DynamoDB
    await deletePDFFromDB(fileName);

    const response = {
      success: true,
      message: "PDF berhasil dihapus",
      data: {
        fileName: fileName,
        deletedAt: new Date().toISOString(),
      },
    };

    console.log("✨ Response berhasil dikirim");
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

    res.status(200).json(response);
  } catch (error) {
    console.error("❌ Error generate URL:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal generate URL",
      error: error.message,
    });
  }
});

// Endpoint: List semua PDF dari DynamoDB
app.get("/api/pdf/list", async (req, res) => {
  try {
    console.log(`📋 Mengambil list PDF dari DynamoDB...`);

    const files = await getAllPDFsFromDB();

    console.log(`✅ Ditemukan ${files.length} file`);

    const response = {
      success: true,
      data: {
        total: files.length,
        files: files,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("❌ Error list PDF:", error.message);
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

    const pdf = await getPDFFromDB(id);

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

    const results = await searchPDFsInDB(query);

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

// Endpoint: Chat dengan AI tentang PDF tertentu (via Lambda)
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

    // Call Lambda
    const lambdaResponse = await callLambdaChatPDF(id, question);

    res.status(200).json(lambdaResponse);
  } catch (error) {
    console.error("❌ Error chat:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal memproses chat",
      error: error.message,
    });
  }
});

// Endpoint: Chat umum dengan AI (via Lambda)
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

    // Call Lambda
    const lambdaResponse = await callLambdaAIChat(message);

    res.status(200).json(lambdaResponse);
  } catch (error) {
    console.error("❌ Error AI chat:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal memproses chat",
      error: error.message,
    });
  }
});

// Endpoint: Tanya AI tentang semua PDF (via Lambda)
app.post("/api/ai/ask-all", express.json(), async (req, res) => {
  try {
    const { question } = req.body;

    console.log(`📚 Pertanyaan tentang semua PDF: ${question}`);

    if (!question) {
      return res.status(400).json({
        success: false,
        message: "Pertanyaan tidak boleh kosong",
      });
    }

    // Call Lambda
    const lambdaResponse = await callLambdaAskAll(question);

    res.status(200).json(lambdaResponse);
  } catch (error) {
    console.error("❌ Error ask-all:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal memproses pertanyaan",
      error: error.message,
    });
  }
});

// Error handler
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
        message: 'Field name harus "pdf"',
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
  res.status(200).json({
    status: "OK",
    message: "Server is running",
    database: "DynamoDB",
    table: TABLE_NAME,
    lambdaAPI: LAMBDA_API_URL,
  });
});

app.listen(PORT, () => {
  console.log("\n" + "🎉".repeat(30));
  console.log("🚀 SERVER BERHASIL BERJALAN!");
  console.log("=".repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`☁️ AWS Region: ${process.env.AWS_REGION}`);
  console.log(`🪣 S3 Bucket: ${BUCKET_NAME}`);
  console.log(`🗄️ DynamoDB Table: ${TABLE_NAME}`);
  console.log(`⚡ Lambda API: ${LAMBDA_API_URL || "❌ Not configured"}`);
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
    `   🗑️ Delete PDF:    http://localhost:${PORT}/api/pdf/delete/:fileName`
  );
  console.log("");
  console.log("🤖 AI Chat Endpoints (via Lambda):");
  console.log(`   💬 Chat PDF:      http://localhost:${PORT}/api/pdf/chat/:id`);
  console.log(`   💭 Chat Umum:     http://localhost:${PORT}/api/ai/chat`);
  console.log(`   📚 Tanya Semua:   http://localhost:${PORT}/api/ai/ask-all`);
  console.log("=".repeat(60));
  console.log("👀 Watching for changes...\n");
});

module.exports = app;
