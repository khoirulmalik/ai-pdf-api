const axios = require("axios");

const LAMBDA_API_URL = process.env.LAMBDA_API_URL;

async function callLambdaAnalyzePDF(fileName, originalName) {
  try {
    console.log("🚀 Calling Lambda for PDF analysis...");
    const response = await axios.post(
      `${LAMBDA_API_URL}/analyze-pdf`,
      { fileName, originalName },
      { headers: { "Content-Type": "application/json" }, timeout: 300000 },
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error calling Lambda:", error.message);
    throw error;
  }
}

async function callLambdaChatPDF(id, question) {
  try {
    console.log("🚀 Calling Lambda for chat...");
    const response = await axios.post(
      `${LAMBDA_API_URL}/chat-pdf`,
      { id, question },
      { headers: { "Content-Type": "application/json" }, timeout: 300000 },
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error calling Lambda:", error.message);
    throw error;
  }
}

async function callLambdaAIChat(message) {
  try {
    console.log("🚀 Calling Lambda for general chat...");
    const response = await axios.post(
      `${LAMBDA_API_URL}/ai-chat`,
      { message },
      { headers: { "Content-Type": "application/json" }, timeout: 300000 },
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error calling Lambda:", error.message);
    throw error;
  }
}

async function callLambdaAskAll(question) {
  try {
    console.log("🚀 Calling Lambda for ask all...");
    const response = await axios.post(
      `${LAMBDA_API_URL}/ask-all`,
      { question },
      { headers: { "Content-Type": "application/json" }, timeout: 300000 },
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error calling Lambda:", error.message);
    throw error;
  }
}

module.exports = {
  callLambdaAnalyzePDF,
  callLambdaChatPDF,
  callLambdaAIChat,
  callLambdaAskAll,
};
