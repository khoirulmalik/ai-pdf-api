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
} = require("../services/s3Service");
const {
  callLambdaAnalyzePDF,
  callLambdaChatPDF,
} = require("../services/lambdaService");

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

    const signedUrl = await getSignedDownloadUrl(fileName);
    console.log("🔗 Signed URL berhasil di-generate");

    console.log("🤖 Mengirim ke Lambda untuk analisis...");
    const lambdaResponse = await callLambdaAnalyzePDF(
      fileName,
      req.file.originalname,
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

    console.log("✨ Response berhasil dikirim");
    res
      .status(200)
      .json({
        success: true,
        message: "PDF berhasil diupload dan dianalisis",
        data: pdfRecord,
      });
  } catch (error) {
    console.error("❌ Error upload PDF:", error.message);
    console.error("📋 Stack:", error.stack);
    res
      .status(500)
      .json({
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

    console.log("✨ Response berhasil dikirim");
    res.status(200).json({
      success: true,
      message: "PDF berhasil dihapus",
      data: { fileName, deletedAt: new Date().toISOString() },
    });
  } catch (error) {
    console.error("❌ Error hapus PDF:", error.message);
    console.error("📋 Stack:", error.stack);
    res
      .status(500)
      .json({
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

    const signedUrl = await getSignedDownloadUrl(fileName, expiresIn);
    console.log("✅ URL berhasil di-generate!");

    res
      .status(200)
      .json({ success: true, data: { fileName, url: signedUrl, expiresIn } });
  } catch (error) {
    console.error("❌ Error generate URL:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal generate URL",
        error: error.message,
      });
  }
}

async function listPDFs(req, res) {
  try {
    console.log("📋 Mengambil list PDF dari DynamoDB...");
    const files = await getAllPDFsFromDB();
    console.log(`✅ Ditemukan ${files.length} file`);
    res
      .status(200)
      .json({ success: true, data: { total: files.length, files } });
  } catch (error) {
    console.error("❌ Error list PDF:", error.message);
    res
      .status(500)
      .json({
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

    pdf.url = await getSignedDownloadUrl(pdf.fileName);
    res.status(200).json({ success: true, data: pdf });
  } catch (error) {
    console.error("❌ Error get detail:", error.message);
    res
      .status(500)
      .json({
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

    const results = await searchPDFsInDB(query);
    console.log(`✅ Ditemukan ${results.length} hasil`);

    res
      .status(200)
      .json({ success: true, data: { query, total: results.length, results } });
  } catch (error) {
    console.error("❌ Error search:", error.message);
    res
      .status(500)
      .json({
        success: false,
        message: "Gagal melakukan pencarian",
        error: error.message,
      });
  }
}

async function chatWithPDF(req, res) {
  try {
    const { id } = req.params;
    const { question } = req.body;

    console.log(`💬 Chat request untuk PDF: ${id}`);
    console.log(`❓ Pertanyaan: ${question}`);

    if (!question) {
      return res
        .status(400)
        .json({ success: false, message: "Pertanyaan tidak boleh kosong" });
    }

    const lambdaResponse = await callLambdaChatPDF(id, question);
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

module.exports = {
  uploadPDF,
  deletePDF,
  getPDFUrl,
  listPDFs,
  getPDFDetail,
  searchPDFs,
  chatWithPDF,
};
