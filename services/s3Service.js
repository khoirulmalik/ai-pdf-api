const {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3Client } = require("../config/aws");

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

async function uploadToS3(fileName, fileBuffer, contentType) {
  const params = {
    Bucket: BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: contentType,
  };
  console.log("☁️ Mengupload ke S3...");
  const command = new PutObjectCommand(params);
  await s3Client.send(command);
  console.log("✅ Upload ke S3 berhasil!");
}

async function deleteFromS3(fileName) {
  const params = { Bucket: BUCKET_NAME, Key: fileName };
  console.log("☁️ Menghapus dari S3...");
  const command = new DeleteObjectCommand(params);
  await s3Client.send(command);
  console.log("✅ File berhasil dihapus dari S3!");
}

async function getSignedDownloadUrl(fileName, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: fileName });
  return await getSignedUrl(s3Client, command, { expiresIn });
}

module.exports = { uploadToS3, deleteFromS3, getSignedDownloadUrl };
