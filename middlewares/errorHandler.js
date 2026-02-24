const multer = require("multer");

function errorHandler(error, req, res, next) {
  console.error("❌ Error caught:", error.message);

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({
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
    return res.status(400).json({ success: false, message: error.message });
  }

  res.status(500).json({ success: false, message: error.message });
}

module.exports = errorHandler;
