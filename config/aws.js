const { S3Client } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials,
});

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials,
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

module.exports = { s3Client, docClient };
