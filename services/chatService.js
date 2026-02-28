const {
  PutCommand,
  QueryCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../config/aws");

const TABLE_NAME = process.env.DYNAMODB_CHAT_TABLE || "chat-history";

// Simpan satu pesan ke DynamoDB
async function saveMessage({ sessionId, role, content, pdfId = null }) {
  const timestamp = new Date().toISOString();
  const item = {
    sessionId, // PK: "general" atau "pdf#fileName"
    timestamp, // SK: ISO string (auto-sorted)
    role, // "user" | "assistant"
    content,
    ...(pdfId && { pdfId }),
  };

  const command = new PutCommand({ TableName: TABLE_NAME, Item: item });
  await docClient.send(command);
  return item;
}

// Ambil semua history berdasarkan sessionId, urut dari lama ke baru
async function getHistory(sessionId, limit = 100) {
  const command = new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "sessionId = :sid",
    ExpressionAttributeValues: { ":sid": sessionId },
    ScanIndexForward: true, // ascending by timestamp
    Limit: limit,
  });

  const response = await docClient.send(command);
  return response.Items || [];
}

// Hapus seluruh history satu sesi (untuk tombol "Clear chat")
async function clearHistory(sessionId) {
  // DynamoDB tidak support bulk delete, harus satu per satu
  const messages = await getHistory(sessionId);

  await Promise.all(
    messages.map((msg) =>
      docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { sessionId: msg.sessionId, timestamp: msg.timestamp },
        }),
      ),
    ),
  );

  return { deleted: messages.length };
}

module.exports = { saveMessage, getHistory, clearHistory };
