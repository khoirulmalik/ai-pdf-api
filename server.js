const express = require("express");
const cors = require("cors");
require("dotenv").config();

const logger = require("./middlewares/logger");
const errorHandler = require("./middlewares/errorHandler");
const pdfRoutes = require("./routes/pdfRoutes");
const aiRoutes = require("./routes/aiRoutes");

const app = express();
const PORT = process.env.PORT || 3000;
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "pdf-documents";
const LAMBDA_API_URL = process.env.LAMBDA_API_URL;

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
app.use(logger);
app.use(express.json());

// Routes
app.use("/api/pdf", pdfRoutes);
app.use("/api/ai", aiRoutes);

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Server is running",
    database: "DynamoDB",
    table: TABLE_NAME,
    lambdaAPI: LAMBDA_API_URL,
  });
});

// Error handler (harus paling bawah)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log("\n" + "🎉".repeat(30));
  console.log("🚀 SERVER BERHASIL BERJALAN!");
  console.log("=".repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`☁️ AWS Region: ${process.env.AWS_REGION}`);
  console.log(`🪣 S3 Bucket: ${process.env.AWS_BUCKET_NAME}`);
  console.log(`🗄️ DynamoDB Table: ${TABLE_NAME}`);
  console.log(`⚡ Lambda API: ${LAMBDA_API_URL || "❌ Not configured"}`);
  console.log("=".repeat(60));
  console.log("📡 PDF Management Endpoints:");
  console.log(`   ✅ Health Check:  http://localhost:${PORT}/health`);
  console.log(`   📋 List PDFs:     http://localhost:${PORT}/api/pdf/list`);
  console.log(
    `   🔍 Search PDFs:   http://localhost:${PORT}/api/pdf/search?q=keyword`,
  );
  console.log(
    `   📄 PDF Detail:    http://localhost:${PORT}/api/pdf/detail/:id`,
  );
  console.log(`   📤 Upload PDF:    http://localhost:${PORT}/api/pdf/upload`);
  console.log(
    `   🔗 Get URL:       http://localhost:${PORT}/api/pdf/url/:fileName`,
  );
  console.log(
    `   🗑️ Delete PDF:    http://localhost:${PORT}/api/pdf/delete/:fileName`,
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
