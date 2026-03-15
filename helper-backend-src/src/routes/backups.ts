import { FastifyInstance } from "fastify";
import { requireS3Config } from "../config/runtime.js";
import { createS3Client, uploadBodyToS3 } from "../services/s3.js";

export const registerBackupRoutes = async (app: FastifyInstance) => {
  app.post("/api/v1/backups/upload", async (request) => {
    const file = await request.file();
    if (!file) {
      throw new Error("Multipart file is required.");
    }

    const keyField = file.fields.key;
    const keyValue =
      keyField && !Array.isArray(keyField) && "value" in keyField
        ? String(keyField.value ?? "").trim()
        : "";
    if (!keyValue) {
      throw new Error("S3 object key is required.");
    }

    const s3 = requireS3Config();
    const client = createS3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
    });

    return uploadBodyToS3({
      client,
      bucket: s3.bucket,
      key: keyValue,
      body: file.file,
      contentType: file.mimetype || "application/octet-stream",
    });
  });
};
