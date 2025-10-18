import { injectable } from 'inversify';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import axios from 'axios';
import sharp from 'sharp';
import { createHash, randomUUID } from 'crypto';
import { parse as parseUrl } from 'url';
import { BaseService } from '../../../base/service_injection/baseService';
import { logService } from '../../../base/logging/logService';

const FETCHR_S3_BUCKET_NAME = 'fetchr-image-urls';
const FETCHR_COMPRESSED_BUCKET_NAME = 'fetchr-compressed-images';

@injectable()
export class S3Service extends BaseService {
  private readonly s3Client: S3Client;
  private readonly s3ClientSafe: S3Client;
  private readonly bucketName: string;

  // Separate clients/bucket references for compressed images:
  private readonly s3ClientCompressed: S3Client;
  private readonly s3ClientCompressedSafe: S3Client;
  private readonly compressedBucketName: string;

  constructor() {
    super('S3Service', logService);

    const credentials = {
      AWS_ACCESS_KEY_ID: process.env.FETCHR_AWS_ACCESS_KEY_ID ?? 'AKIA37EWIY4SK3WE26CH',
      AWS_SECRET_ACCESS_KEY:
        process.env.FETCHR_AWS_SECRET_ACCESS_KEY ?? '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',
    };

    if (!credentials.AWS_ACCESS_KEY_ID || !credentials.AWS_SECRET_ACCESS_KEY) {
      this.logService.error('AWS credentials not found');
    }

    // "Normal" Bucket
    this.bucketName = FETCHR_S3_BUCKET_NAME;
    this.s3Client = new S3Client({
      region: 'us-east-1',
      maxAttempts: 3,
      requestHandler: {
        connectionTimeout: 5000,
        socketTimeout: 5000,
        keepAlive: true,
      },
      credentials: {
        accessKeyId: credentials.AWS_ACCESS_KEY_ID,
        secretAccessKey: credentials.AWS_SECRET_ACCESS_KEY,
      },
      useAccelerateEndpoint: true,
    });

    this.s3ClientSafe = new S3Client({
      region: 'us-east-1',
      maxAttempts: 5,
      requestHandler: {
        connectionTimeout: 60_000,
        socketTimeout: 60_000,
        keepAlive: true,
      },
      credentials: {
        accessKeyId: credentials.AWS_ACCESS_KEY_ID,
        secretAccessKey: credentials.AWS_SECRET_ACCESS_KEY,
      },
      useAccelerateEndpoint: true,
    });

    // Compressed Bucket
    this.compressedBucketName = FETCHR_COMPRESSED_BUCKET_NAME;
    this.s3ClientCompressed = new S3Client({
      region: 'us-west-1',
      maxAttempts: 3,
      requestHandler: {
        connectionTimeout: 5000,
        socketTimeout: 5000,
        keepAlive: true,
      },
      credentials: {
        accessKeyId: credentials.AWS_ACCESS_KEY_ID,
        secretAccessKey: credentials.AWS_SECRET_ACCESS_KEY,
      },
      useAccelerateEndpoint: true,
    });

    this.s3ClientCompressedSafe = new S3Client({
      region: 'us-west-1',
      maxAttempts: 5,
      requestHandler: {
        connectionTimeout: 60_000,
        socketTimeout: 60_000,
        keepAlive: true,
      },
      credentials: {
        accessKeyId: credentials.AWS_ACCESS_KEY_ID,
        secretAccessKey: credentials.AWS_SECRET_ACCESS_KEY,
      },
      useAccelerateEndpoint: true,
    });
  }

  /**
   * Based on an S3 URL, decide if it's the compressed or normal bucket,
   * and return the matching client or clientSafe (depending on which is needed).
   */
  private selectClientAndBucket(
    s3Url: string,
    safe?: boolean,
  ): { client: S3Client; bucket: string } {
    const parsedUrl = parseUrl(s3Url);

    // If there's no hostname, default to "normal" bucket/client:
    if (!parsedUrl.hostname) {
      return {
        client: safe ? this.s3ClientSafe : this.s3Client,
        bucket: this.bucketName,
      };
    }

    // Check if the URL hostname includes the compressed bucket name
    if (parsedUrl.hostname.includes(this.compressedBucketName)) {
      return {
        client: safe ? this.s3ClientCompressedSafe : this.s3ClientCompressed,
        bucket: this.compressedBucketName,
      };
    } else {
      return {
        client: safe ? this.s3ClientSafe : this.s3Client,
        bucket: this.bucketName,
      };
    }
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9\-_.]/g, '').slice(0, 200);
  }

  private async prepareImage(imageBuffer: Buffer): Promise<[Buffer, string]> {
    const processedImage = await sharp(imageBuffer).jpeg().toBuffer();

    const imageHash = createHash('md5').update(processedImage).digest('hex');

    return [processedImage, imageHash];
  }

  /**
   * By default, we upload to the "normal" bucket (this.bucketName).
   * If you want to upload to the compressed bucket, you'd call
   * a separate method or add a parameter here.
   */
  async uploadImageToS3(imageUrl: string): Promise<string | null> {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10_000,
      });

      const [processedImage, imageHash] = await this.prepareImage(response.data);

      const originalFilename = parseUrl(imageUrl).pathname?.split('/').pop() || 'image.jpg';
      const sanitizedFilename = this.sanitizeFilename(originalFilename);
      const filename = `${imageHash}_${sanitizedFilename}`;

      // We always put images in the "normal" bucket in this example
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: filename,
          Body: processedImage,
          ContentType: 'image/jpeg',
        }),
      );

      const s3Url = `https://${this.bucketName}.s3-accelerate.amazonaws.com/${encodeURIComponent(
        filename,
      )}`;
      this.logService.info(`Successfully uploaded image to S3: ${s3Url}`);
      return s3Url;
    } catch (error) {
      this.logService.error(`Error uploading image to S3: ${error}`);
      return null;
    }
  }

  async getImage(s3Url: string): Promise<Buffer | null> {
    try {
      const key = parseUrl(s3Url).pathname?.substring(1);
      if (!key) throw new Error('Invalid S3 URL');

      const decodedKey = decodeURIComponent(key);

      const { client, bucket } = this.selectClientAndBucket(s3Url);

      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: decodedKey,
        }),
      );

      const imageBuffer = Buffer.from((await result.Body?.transformToByteArray()) || []);
      // Handle HEIC format by always converting to JPEG
      const sharpInstance = sharp(imageBuffer);
      if (decodedKey.toLowerCase().endsWith('.heic')) {
        return await sharpInstance.toFormat('jpeg', { quality: 85 }).toBuffer();
      }
      return await sharpInstance.toFormat('jpeg', { quality: 85 }).toBuffer();
    } catch (error) {
      this.logService.error(`Error retrieving image from S3 ${s3Url}: ${error}`, { error });
      return null;
    }
  }

  async getImageOrFail(s3Url: string): Promise<Buffer> {
    const image = await this.getImage(s3Url);
    if (!image) {
      this.logService.error(`Image not found in S3: ${s3Url}`, {
        metadata: { s3Url },
      });
      throw new Error(`Image not found in S3: ${s3Url}`);
    }
    return image;
  }

  async getImageSafe(s3Url: string): Promise<Buffer | null> {
    try {
      const key = parseUrl(s3Url).pathname?.substring(1);
      if (!key) throw new Error('Invalid S3 URL');

      const decodedKey = decodeURIComponent(key);

      const { client, bucket } = this.selectClientAndBucket(s3Url, true);

      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: decodedKey,
        }),
      );

      const imageBuffer = Buffer.from((await result.Body?.transformToByteArray()) || []);
      // Handle HEIC format by always converting to JPEG
      const sharpInstance = sharp(imageBuffer);
      if (decodedKey.toLowerCase().endsWith('.heic')) {
        return await sharpInstance.toFormat('jpeg', { quality: 85 }).toBuffer();
      }
      return await sharpInstance.toFormat('jpeg', { quality: 85 }).toBuffer();
    } catch (error) {
      this.logService.error(`Error retrieving image from S3 ${s3Url}: ${error}`, { error });
      return null;
    }
  }

  async getImageSafeOrFail(s3Url: string): Promise<Buffer> {
    const image = await this.getImageSafe(s3Url);
    if (!image) {
      this.logService.error(`Image not found in S3: ${s3Url}`, {
        metadata: { s3Url },
      });
      throw new Error(`Image not found in S3: ${s3Url}`);
    }
    return image;
  }

  async verifyS3Url(s3Url: string): Promise<boolean> {
    try {
      const key = parseUrl(s3Url).pathname?.substring(1);
      if (!key) return false;

      const { client, bucket } = this.selectClientAndBucket(s3Url, true);

      await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      this.logService.error(`Error verifying S3 URL ${s3Url}: ${error}`);
      return false;
    }
  }

  async uploadFileToRandomLocation(file: Buffer, originalUrl?: string): Promise<string> {
    const randomFilename = randomUUID();
    let fileExtension = '';

    // Extract file extension from originalUrl if provided
    if (originalUrl) {
      const urlPath = originalUrl.split('?')[0]; // Remove query parameters
      const extensionMatch = urlPath.match(/\.([a-zA-Z0-9]+)$/);
      if (extensionMatch && extensionMatch[1]) {
        fileExtension = `.${extensionMatch[1].toLowerCase()}`;
      }
    }

    const key = `random_files/${randomFilename}${fileExtension}`;

    await this.s3ClientSafe.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: file,
      }),
    );

    const s3Url = `https://${this.bucketName}.s3.amazonaws.com/${encodeURIComponent(key)}`;

    return s3Url;
  }

  async uploadImagesToS3(imageUrls: string[]): Promise<string[]> {
    const s3Urls: string[] = [];

    for (const imageUrl of imageUrls) {
      const s3Url = await this.uploadImageToS3(imageUrl);
      if (s3Url && (await this.verifyS3Url(s3Url))) {
        s3Urls.push(s3Url);
        this.logService.info(`Successfully uploaded and verified S3 URL: ${s3Url}`);
      } else {
        this.logService.warn(`Failed to upload or verify image ${imageUrl} to S3`);
      }
    }

    return s3Urls;
  }

  async getFile(key: string): Promise<Buffer> {
    const { client, bucket } = this.selectClientAndBucket(key);
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from((await result.Body?.transformToByteArray()) || []);
  }
}
