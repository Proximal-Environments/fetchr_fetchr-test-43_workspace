import { injectable } from 'inversify';
import { S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { parse as parseUrl } from 'url';
import { BaseService } from '../../base/service_injection/baseService';
import { logService } from '../../base/logging/logService';
@injectable()
export class SupabaseStorageService extends BaseService {
  private readonly s3Client: S3Client;
  private readonly s3ClientSafe: S3Client;
  private readonly chatPhotosBucketName: string;

  constructor() {
    super('SupabaseStorageService', logService);

    const FETCHR_CHAT_PHOTOS_BUCKET_NAME = 'chat_photos';
    const credentials =
      process.env.SUPABASE_S3_ACCESS_KEY && process.env.SUPABASE_S3_SECRET_KEY
        ? {
            accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY,
            secretAccessKey: process.env.SUPABASE_S3_SECRET_KEY,
          }
        : undefined;
    const supabaseEndpoint = process.env.SUPABASE_URL
      ? process.env.SUPABASE_URL + '/storage/v1/object/public/'
      : undefined;

    // "chat_photos" Bucket
    this.chatPhotosBucketName = FETCHR_CHAT_PHOTOS_BUCKET_NAME;
    this.s3Client = new S3Client({
      region: 'us-west-1',
      endpoint: supabaseEndpoint,
      maxAttempts: 3,
      requestHandler: {
        connectionTimeout: 5000,
        socketTimeout: 5000,
        keepAlive: true,
      },
      credentials,
    });

    this.s3ClientSafe = new S3Client({
      region: 'us-west-1',
      endpoint: supabaseEndpoint,
      maxAttempts: 5,
      requestHandler: {
        connectionTimeout: 60_000,
        socketTimeout: 60_000,
        keepAlive: true,
      },
      credentials,
    });
  }

  /**
   * Based on an S3 URL, decide which bucket to use,
   * and return the matching client or clientSafe (depending on which is needed).
   */
  private selectClientAndBucket(
    s3Url: string,
    safe?: boolean,
  ): { client: S3Client; bucket: string } {
    const parsedUrl = parseUrl(s3Url);

    // Check if the URL hostname includes the compressed bucket name
    if (parsedUrl.pathname?.includes(this.chatPhotosBucketName)) {
      return {
        client: safe ? this.s3ClientSafe : this.s3Client,
        bucket: this.chatPhotosBucketName,
      };
    }
    // add more buckets here
    throw new Error('Invalid supabase storage URL');
  }

  async getImage(imageUrl: string): Promise<Buffer | null> {
    try {
      const { bucket } = this.selectClientAndBucket(imageUrl);

      const key = parseUrl(imageUrl).pathname?.split(bucket + '/')?.[1];
      if (!key) throw new Error('Invalid Supabase URL');

      // Use direct Supabase REST API instead of S3 client
      const response = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${key}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
            apikey: process.env.SUPABASE_KEY || '',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      // Handle HEIC format by always converting to JPEG
      const sharpInstance = sharp(imageBuffer);
      if (key.toLowerCase().endsWith('.heic')) {
        return await sharpInstance.toFormat('jpeg', { quality: 85 }).toBuffer();
      }
      return await sharpInstance.toFormat('jpeg', { quality: 85 }).toBuffer();
    } catch (error) {
      this.logService.error(`Error retrieving image from supabase: ${imageUrl}: ${error}`, {
        error,
      });
      return null;
    }
  }

  async getImageOrFail(imageUrl: string): Promise<Buffer> {
    const image = await this.getImage(imageUrl);
    if (!image) {
      this.logService.error(`Image not found in supabase: ${imageUrl}`, {
        metadata: { imageUrl },
      });
      throw new Error(`Image not found in supabase: ${imageUrl}`);
    }
    return image;
  }

  async getImageSafe(imageUrl: string): Promise<Buffer | null> {
    try {
      const { bucket } = this.selectClientAndBucket(imageUrl, true);

      const key = parseUrl(imageUrl).pathname?.split(bucket + '/')?.[1];
      if (!key) throw new Error('Invalid Supabase URL');

      this.logService.info(
        `Getting image with url ${imageUrl} from supabase from bucket ${bucket}, key ${key}`,
      );

      // Use direct Supabase REST API instead of S3 client
      const response = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${key}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
            apikey: process.env.SUPABASE_KEY || '',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }

      this.logService.info(`Got image from supabase with key ${key}`);

      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      // Handle HEIC format by always converting to JPEG
      const sharpInstance = sharp(imageBuffer);
      if (key.toLowerCase().endsWith('.heic')) {
        return await sharpInstance.toFormat('jpeg', { quality: 85 }).toBuffer();
      }
      return await sharpInstance.toFormat('jpeg', { quality: 85 }).toBuffer();
    } catch (error) {
      this.logService.error(`Error retrieving image from Supabase ${imageUrl}: ${error}`, {
        error,
      });
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
}
