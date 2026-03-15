import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const createS3Client = ({
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
}: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}) =>
  new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

export const uploadBufferToS3 = async ({
  client,
  bucket,
  key,
  body,
  contentType,
}: {
  client: S3Client;
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}) => {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return {
    bucket,
    key,
    s3Uri: `s3://${bucket}/${key}`,
  };
};
