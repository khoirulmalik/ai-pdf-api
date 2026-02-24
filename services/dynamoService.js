const {
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/aws");

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "pdf-documents";

async function savePDFToDB(pdfRecord) {
  try {
    const command = new PutCommand({ TableName: TABLE_NAME, Item: pdfRecord });
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
    const command = new GetCommand({ TableName: TABLE_NAME, Key: { id } });
    const response = await docClient.send(command);
    return response.Item || null;
  } catch (error) {
    console.error("❌ Error get from DynamoDB:", error.message);
    throw error;
  }
}

async function deletePDFFromDB(id) {
  try {
    const command = new DeleteCommand({ TableName: TABLE_NAME, Key: { id } });
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
    const command = new ScanCommand({ TableName: TABLE_NAME });
    const response = await docClient.send(command);
    return response.Items || [];
  } catch (error) {
    console.error("❌ Error scan DynamoDB:", error.message);
    throw error;
  }
}

async function searchPDFsInDB(query) {
  try {
    const command = new ScanCommand({ TableName: TABLE_NAME });
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

module.exports = {
  savePDFToDB,
  getPDFFromDB,
  deletePDFFromDB,
  getAllPDFsFromDB,
  searchPDFsInDB,
  TABLE_NAME,
};
