const pdfParse = require("pdf-parse");
const fs = require("fs");

console.log("Type of pdfParse:", typeof pdfParse);

fs.readFile("tes.pdf", async (err, data) => {
  if (err) throw err;

  try {
    const pdfData = await pdfParse(data);
    console.log("Success! Pages:", pdfData.numpages);
    console.log("Text preview:", pdfData.text.substring(0, 100));
  } catch (error) {
    console.error("Error:", error.message);
  }
});
