import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const REGION = 'us-west-1'
const BUCKET = 'nostalgix'

export async function uploadImageToS3(imageBuffer: Buffer, key: string, mimeType: string): Promise<string> {
  try {
    const s3Client = new S3Client({ region: REGION })

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: imageBuffer,
        ContentType: mimeType
      })
    )

    return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`
  } catch (e) {
    console.error('Error uploading screenshot to S3', { e })
    throw e
  }
}
