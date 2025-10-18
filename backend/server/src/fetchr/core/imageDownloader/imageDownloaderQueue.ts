import { Queue, Worker, Job, ConnectionOptions } from 'bullmq';
import { getExternalImage } from './imageUtils';
import { s3Service } from '../../base/service_injection/global';
import { supabaseDb } from '../../base/database/supabaseDb';
import { logService } from '../../base/logging/logService';
// import { initImageDownloader } from './imageUtils';

export interface ImageDownloadJob {
  imageUrl: string;
  sessionId?: string;
}

export interface ImageProgress {
  status: 'processing' | 'downloaded' | 'completed' | 'failed';
  internalUrl?: string;
  error?: string;
  imageBuffer?: Buffer;
}

class ImageDownloaderQueue {
  private static instance: ImageDownloaderQueue;
  private queue: Queue;
  private worker!: Worker;

  private constructor() {
    const connection: ConnectionOptions = {
      url: process.env.REDIS_URL || 'localhost',
      username: process.env.REDIS_USER || undefined,
      password: process.env.REDIS_PASSWORD || undefined,
      tls:
        process.env.REDIS_TLS === 'true'
          ? {
              rejectUnauthorized: false,
            }
          : undefined,
    };

    // For Redis Cluster, wrap the queue name in curly braces to ensure keys are in the same slot
    const queueName = '{image-downloader-5}';

    this.queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 60 * 60 * 24, // Remove completed jobs after 24 hours
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: true,
      },
    });

    this.setupWorker(connection, queueName);
  }

  private setupWorker(connection: ConnectionOptions, queueName: string): void {
    this.worker = new Worker(
      queueName,
      async (job: Job<ImageDownloadJob>) => {
        const { imageUrl } = job.data;

        try {
          // Update status to processing
          await job.updateProgress({
            status: 'processing',
          } as ImageProgress);

          const imageBuffer = await getExternalImage(imageUrl);
          logService.info(`Extracted external image with url ${imageUrl}`, {});

          //   // Update status to downloaded with buffer
          await job.updateProgress({
            status: 'downloaded',
            imageBuffer: imageBuffer,
          } as ImageProgress);

          // Upload to S3 using S3Service
          const s3Url = await s3Service.uploadFileToRandomLocation(imageBuffer, imageUrl);
          if (!s3Url) {
            throw new Error('Failed to upload image to S3');
          }

          await supabaseDb.external_images.upsert({
            where: {
              external_image_url: imageUrl,
            },
            create: {
              external_image_url: imageUrl,
              internal_image_url: s3Url,
            },
            update: {
              internal_image_url: s3Url,
            },
          });

          // Return the final result which will be stored in job.returnvalue
          return {
            status: 'completed',
            internalUrl: s3Url,
          } as ImageProgress;
        } catch (error) {
          // Add detailed error logging
          console.error(`Error processing image ${imageUrl}:`, {
            error: error.message,
            stack: error.stack,
          });

          // TODO: Delete the image from S3 if it was uploaded
          // TODO: Delete the image from the database if it was inserted

          // Update status to failed with detailed error info
          await job.updateProgress({
            status: 'failed',
            error: error.message,
          } as ImageProgress);

          throw error;
        }
      },
      { connection },
    );

    this.worker.on('failed', (job: Job<ImageDownloadJob>, err: Error) => {
      // Enhance the failed event logging
      console.error(`Failed to process image ${job.data.imageUrl}:`, {
        error: err.message,
        stack: err.stack,
        jobId: job.id,
        attempts: job.attemptsMade,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
      });
    });
  }

  public static getInstance(): ImageDownloaderQueue {
    if (!ImageDownloaderQueue.instance) {
      ImageDownloaderQueue.instance = new ImageDownloaderQueue();
    }
    // initImageDownloader();
    return ImageDownloaderQueue.instance;
  }

  public async addToQueue(imageUrl: string, sessionId?: string): Promise<void> {
    // Check if the job already exists before adding it
    const existingJob = await this.queue.getJob(imageUrl);
    if (existingJob) {
      // Job already exists, no need to add it again
      return;
    }

    await this.queue.add(
      'download-image',
      { imageUrl, sessionId },
      {
        jobId: imageUrl,
        removeOnComplete: false,
      },
    );
  }

  public async addBatchToQueue(imageUrls: string[], sessionId?: string): Promise<void> {
    // Filter out URLs that already have jobs in the queue
    const uniqueUrls = [];

    for (const imageUrl of imageUrls) {
      const existingJob = await this.queue.getJob(imageUrl);
      if (!existingJob) {
        uniqueUrls.push(imageUrl);
      }
    }

    if (uniqueUrls.length === 0) {
      return;
    }

    const jobs = uniqueUrls.map(imageUrl => ({
      name: 'download-image',
      data: { imageUrl, sessionId },
      opts: {
        jobId: imageUrl,
        removeOnComplete: false,
      },
    }));

    await this.queue.addBulk(jobs);
  }

  public async getJob(imageUrl: string): Promise<Job<ImageDownloadJob> | null> {
    return this.queue.getJob(imageUrl);
  }

  public async close(): Promise<void> {
    await this.queue.close();
    await this.worker.close();
  }
}

export const imageDownloaderQueue = ImageDownloaderQueue.getInstance();
