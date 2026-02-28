const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload");
const {
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
} = require("../controllers/pdfController");

router.post("/upload", upload.single("pdf"), uploadPDF); // Upload lama (via server)
router.post("/upload-url", getUploadUrl); // ⚡ Presigned: minta URL
router.post("/confirm-upload", confirmUpload); // ⚡ Presigned: konfirmasi
router.delete("/delete/:fileName", deletePDF);
router.get("/url/:fileName", getPDFUrl);
router.get("/list", listPDFs);
router.get("/detail/:id", getPDFDetail);
router.get("/search", searchPDFs);
router.post("/chat/:id", chatWithPDF);
router.get("/history/:id", getPDFHistory); // GET history chat PDF
router.delete("/history/:id", clearPDFHistory); // Clear history chat PDF

module.exports = router;
