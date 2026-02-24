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
} = require("../controllers/pdfController");

router.post("/upload", upload.single("pdf"), uploadPDF);
router.delete("/delete/:fileName", deletePDF);
router.get("/url/:fileName", getPDFUrl);
router.get("/list", listPDFs);
router.get("/detail/:id", getPDFDetail);
router.get("/search", searchPDFs);
router.post("/chat/:id", chatWithPDF);

module.exports = router;
