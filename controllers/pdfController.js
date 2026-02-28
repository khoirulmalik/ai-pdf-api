const {
  savePDFToDB,
  getPDFFromDB,
  deletePDFFromDB,
  getAllPDFsFromDB,
  searchPDFsInDB,
} = require("../services/dynamoService");
const {
  uploadToS3,
  deleteFromS3,
  getSignedDownloadUrl,
  getPresignedUploadUrl,
} = require("../services/s3Service");
const {
  callLambdaAnalyzePDF,
  callLambdaChatPDF,
} = require("../services/lambdaService");
const {
  saveMessage,
  getHistory,
  clearHistory,
} = require("../services/chatService");

// ⚡ Simple in-memory cache (gratis, no Redis needed)
const cache = new Map();
const CACHE_TTL = {
  SIGNED_URL: 50 * 60 * 1000, // 50 menit (URL valid 1 jam)
  LIST: 60 * 1000, // 60 detik
  SEARCH: 30 * 1000, // 30 detik
};

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttl) {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

function cacheInvalidate(pattern) {
  for (const key of cache.keys()) {
    if (key.startsWith(pattern)) cache.delete(key);
  }
}

async function uploadPDF(req, res) {
  try {
    console.log("📤 Memulai proses upload...");

    if (!req.file) {
      console.log("❌ File tidak ditemukan");
      return res
        .status(400)
        .json({ success: false, message: "File PDF tidak ditemukan" });
    }

    console.log(`📄 File diterima: ${req.file.originalname}`);
    console.log(`📦 Ukuran: ${(req.file.size / 1024).toFixed(2)} KB`);

    const fileName = `${Date.now()}-${req.file.originalname}`;
    console.log(`🏷️ Nama file di S3: ${fileName}`);

    await uploadToS3(fileName, req.file.buffer, "application/pdf");

    // ⚡ Parallelkan signed URL + Lambda analyze (hemat ~30-40% waktu)
    console.log("⚡ Menjalankan signed URL + Lambda analyze secara paralel...");
    const [signedUrl, lambdaResponse] = await Promise.all([
      getSignedDownloadUrl(fileName),
      callLambdaAnalyzePDF(fileName, req.file.originalname),
    ]);
    console.log("🔗 Signed URL berhasil di-generate");

    // ⚡ Pisahkan extractedText dari analysis supaya tidak ikut tampil ke frontend
    const rawData = lambdaResponse.success ? lambdaResponse.data : null;
    const extractedText = rawData?._extractedText || null;
    const { _extractedText, ...analysisClean } = rawData || {};

    const analysis = rawData
      ? analysisClean
      : {
          title: req.file.originalname,
          summary: "Gagal menganalisis dokumen",
          category: "Unknown",
          keywords: [],
          language: "Unknown",
          mainTopics: [],
          pageCount: 0,
        };

    const pdfRecord = {
      id: fileName,
      fileName: fileName,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      fileSizeFormatted: `${(req.file.size / 1024).toFixed(2)} KB`,
      uploadedAt: new Date().toISOString(),
      url: signedUrl,
      analysis: analysis,
      // ⚡ Cache extracted text — chat tidak perlu download ulang dari S3
      ...(extractedText && { extractedText }),
    };

    await savePDFToDB(pdfRecord);

    // ⚡ Invalidate cache list & search supaya data fresh
    cacheInvalidate("list:");
    cacheInvalidate("search:");

    console.log("✨ Response berhasil dikirim");
    res.status(200).json({
      success: true,
      message: "PDF berhasil diupload dan dianalisis",
      data: pdfRecord,
    });
  } catch (error) {
    console.error("❌ Error upload PDF:", error.message);
    console.error("📋 Stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Gagal mengupload PDF",
      error: error.message,
    });
  }
}

async function deletePDF(req, res) {
  try {
    const { fileName } = req.params;
    console.log(`🗑️ Memulai proses hapus file: ${fileName}`);

    if (!fileName) {
      console.log("❌ Nama file kosong");
      return res
        .status(400)
        .json({ success: false, message: "Nama file tidak boleh kosong" });
    }

    await deleteFromS3(fileName);
    await deletePDFFromDB(fileName);

    // ⚡ Invalidate semua cache terkait file ini
    cacheInvalidate("list:");
    cacheInvalidate("search:");
    cacheInvalidate(`url:${fileName}`);

    console.log("✨ Response berhasil dikirim");
    res.status(200).json({
      success: true,
      message: "PDF berhasil dihapus",
      data: { fileName, deletedAt: new Date().toISOString() },
    });
  } catch (error) {
    console.error("❌ Error hapus PDF:", error.message);
    console.error("📋 Stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Gagal menghapus PDF",
      error: error.message,
    });
  }
}

async function getPDFUrl(req, res) {
  try {
    const { fileName } = req.params;
    const expiresIn = parseInt(req.query.expires) || 3600;
    console.log(`🔗 Generate URL untuk: ${fileName}`);

    // ⚡ Cek cache dulu sebelum generate URL baru
    const cacheKey = `url:${fileName}`;
    let signedUrl = cacheGet(cacheKey);
    if (signedUrl) {
      console.log("⚡ Signed URL dari cache!");
    } else {
      signedUrl = await getSignedDownloadUrl(fileName, expiresIn);
      cacheSet(cacheKey, signedUrl, CACHE_TTL.SIGNED_URL);
      console.log("✅ URL berhasil di-generate!");
    }

    res
      .status(200)
      .json({ success: true, data: { fileName, url: signedUrl, expiresIn } });
  } catch (error) {
    console.error("❌ Error generate URL:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal generate URL",
      error: error.message,
    });
  }
}

async function listPDFs(req, res) {
  try {
    // ⚡ Cek cache dulu
    const cached = cacheGet("list:all");
    if (cached) {
      console.log("⚡ List PDF dari cache!");
      return res
        .status(200)
        .json({ success: true, data: { total: cached.length, files: cached } });
    }

    console.log("📋 Mengambil list PDF dari DynamoDB...");
    const files = await getAllPDFsFromDB();
    cacheSet("list:all", files, CACHE_TTL.LIST);
    console.log(`✅ Ditemukan ${files.length} file`);
    res
      .status(200)
      .json({ success: true, data: { total: files.length, files } });
  } catch (error) {
    console.error("❌ Error list PDF:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil list PDF",
      error: error.message,
    });
  }
}

async function getPDFDetail(req, res) {
  try {
    const { id } = req.params;
    console.log(`🔍 Mencari PDF dengan ID: ${id}`);

    const pdf = await getPDFFromDB(id);
    if (!pdf) {
      return res
        .status(404)
        .json({ success: false, message: "PDF tidak ditemukan" });
    }

    // ⚡ Cache signed URL untuk detail
    const cacheKey = `url:${pdf.fileName}`;
    let signedUrl = cacheGet(cacheKey);
    if (!signedUrl) {
      signedUrl = await getSignedDownloadUrl(pdf.fileName);
      cacheSet(cacheKey, signedUrl, CACHE_TTL.SIGNED_URL);
    }
    pdf.url = signedUrl;
    res.status(200).json({ success: true, data: pdf });
  } catch (error) {
    console.error("❌ Error get detail:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil detail PDF",
      error: error.message,
    });
  }
}

async function searchPDFs(req, res) {
  try {
    const query = req.query.q?.toLowerCase() || "";
    console.log(`🔍 Mencari PDF dengan query: "${query}"`);

    // ⚡ Cek cache search
    const cacheKey = `search:${query}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      console.log("⚡ Search result dari cache!");
      return res
        .status(200)
        .json({
          success: true,
          data: { query, total: cached.length, results: cached },
        });
    }

    const results = await searchPDFsInDB(query);
    cacheSet(cacheKey, results, CACHE_TTL.SEARCH);
    console.log(`✅ Ditemukan ${results.length} hasil`);

    res
      .status(200)
      .json({ success: true, data: { query, total: results.length, results } });
  } catch (error) {
    console.error("❌ Error search:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal melakukan pencarian",
      error: error.message,
    });
  }
}

async function chatWithPDF(req, res) {
  try {
    const { id } = req.params;
    const { question, sessionId } = req.body;

    console.log(`💬 Chat request untuk PDF: ${id}`);
    console.log(`❓ Pertanyaan: ${question}`);

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

    const pdfSessionId = `pdf#${id}`;

    // Simpan pesan user
    await saveMessage({
      sessionId: pdfSessionId,
      role: "user",
      content: question,
      pdfId: id,
    });

    const lambdaResponse = await callLambdaChatPDF(id, question);

    // Simpan response assistant
    if (lambdaResponse.success && lambdaResponse.data?.reply) {
      await saveMessage({
        sessionId: pdfSessionId,
        role: "assistant",
        content: lambdaResponse.data.reply,
        pdfId: id,
      });
    }

    res.status(200).json(lambdaResponse);
  } catch (error) {
    console.error("❌ Error chat:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal memproses chat",
        error: error.message,
      });
  }
}

// GET /pdf/history/:id?sessionId=xxx
async function getPDFHistory(req, res) {
  try {
    const { id } = req.params;
    const pdfSessionId = `pdf#${id}`;

    const messages = await getHistory(pdfSessionId);
    res.status(200).json({ success: true, data: { pdfId: id, messages } });
  } catch (error) {
    console.error("❌ Error get PDF history:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal mengambil history",
        error: error.message,
      });
  }
}

// DELETE /pdf/history/:id
async function clearPDFHistory(req, res) {
  try {
    const { id } = req.params;
    const pdfSessionId = `pdf#${id}`;

    const result = await clearHistory(pdfSessionId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("❌ Error clear PDF history:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal menghapus history",
        error: error.message,
      });
  }
}

// ⚡ PRIORITY 3: Presigned upload — client upload langsung ke S3
// Alur baru: GET /upload-url → client PUT ke S3 → POST /confirm-upload → Lambda analyze + save DB
// Manfaat: file tidak lewat server, hemat memory & bandwidth

async function getUploadUrl(req, res) {
  try {
    const { originalName, contentType = "application/pdf" } = req.body;

    if (!originalName) {
      return res
        .status(400)
        .json({ success: false, message: "originalName tidak boleh kosong" });
    }
    if (contentType !== "application/pdf") {
      return res
        .status(400)
        .json({ success: false, message: "Hanya file PDF yang diperbolehkan" });
    }

    const fileName = `${Date.now()}-${originalName}`;
    const uploadUrl = await getPresignedUploadUrl(fileName, contentType);

    console.log(`✅ Presigned upload URL disiapkan untuk: ${fileName}`);
    res.status(200).json({
      success: true,
      data: {
        uploadUrl, // Client langsung PUT ke sini
        fileName, // Simpan ini, kirim balik saat confirm
        expiresIn: 300, // 5 menit
      },
    });
  } catch (error) {
    console.error("❌ Error generate upload URL:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal generate upload URL",
        error: error.message,
      });
  }
}

async function confirmUpload(req, res) {
  try {
    const { fileName, originalName, fileSize } = req.body;

    if (!fileName || !originalName) {
      return res
        .status(400)
        .json({
          success: false,
          message: "fileName dan originalName wajib diisi",
        });
    }

    console.log(`✅ Konfirmasi upload: ${fileName}`);

    // Paralel: signed URL + Lambda analyze
    const [signedUrl, lambdaResponse] = await Promise.all([
      getSignedDownloadUrl(fileName),
      callLambdaAnalyzePDF(fileName, originalName),
    ]);

    const analysis = lambdaResponse.success
      ? lambdaResponse.data
      : {
          title: originalName,
          summary: "Gagal menganalisis dokumen",
          category: "Unknown",
          keywords: [],
          language: "Unknown",
          mainTopics: [],
          pageCount: 0,
        };

    const pdfRecord = {
      id: fileName,
      fileName,
      originalName,
      fileSize: fileSize || 0,
      fileSizeFormatted: fileSize
        ? `${(fileSize / 1024).toFixed(2)} KB`
        : "Unknown",
      uploadedAt: new Date().toISOString(),
      url: signedUrl,
      analysis,
    };

    await savePDFToDB(pdfRecord);
    cacheInvalidate("list:");
    cacheInvalidate("search:");

    res
      .status(200)
      .json({
        success: true,
        message: "PDF berhasil dikonfirmasi dan dianalisis",
        data: pdfRecord,
      });
  } catch (error) {
    console.error("❌ Error confirm upload:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal konfirmasi upload",
        error: error.message,
      });
  }
}

module.exports = {
  uploadPDF,
  deletePDF,
  getPDFUrl,
  listPDFs,
  getPDFDetail,
  searchPDFs,
  chatWithPDF,
  getUploadUrl,
  confirmUpload,
  getPDFHistory,
  clearPDFHistory,
};
