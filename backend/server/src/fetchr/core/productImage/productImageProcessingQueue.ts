import { Queue, Worker, Job, ConnectionOptions } from 'bullmq';
import {
  imageDownloaderService,
  imagePreferenceService,
  pineconeService,
} from '../../base/service_injection/global';
import { supabaseDb } from '../../base/database/supabaseDb';
import { logService } from '../../base/logging/logService';

export interface ProductImageJob {
  imageUrl: string;
  sessionId?: string;
}

export interface ProductImageProgress {
  status: 'processing' | 'downloaded' | 'style-completed' | 'completed' | 'failed';
  imageBuffer?: Buffer;
  error?: string;
  style?: string;
  embeddings?: number[];
}

class ProductImageProcessingQueue {
  private static instance: ProductImageProcessingQueue;
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
    const queueName = '{product-image-processor-3}';

    this.queue = new Queue(queueName, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 60, // Remove completed jobs after 60 seconds
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: false,
      },
    });
    this.setupWorker(connection, queueName);
  }

  private setupWorker(connection: ConnectionOptions, queueName: string): void {
    this.worker = new Worker(
      queueName,
      async (job: Job<ProductImageJob>) => {
        const { imageUrl } = job.data;

        try {
          // Update status to processing
          await job.updateProgress({
            status: 'processing',
          } as ProductImageProgress);

          // Get the image buffer
          await imageDownloaderService.downloadImage(imageUrl);
          const imageBufferResponse = await imageDownloaderService.getImageBuffer(imageUrl);
          if (!imageBufferResponse) {
            throw new Error('Failed to get image buffer');
          }

          // Ensure we have a proper Buffer
          const imageBuffer = Buffer.isBuffer(imageBufferResponse)
            ? imageBufferResponse
            : Buffer.from(imageBufferResponse as Buffer);

          if (!Buffer.isBuffer(imageBuffer)) {
            throw new Error('Failed to convert image data to Buffer');
          }

          // Update progress without including the buffer
          await job.updateProgress({
            status: 'downloaded',
          } as ProductImageProgress);

          // Extract style using the image preference service
          const style = await imagePreferenceService.extractStyleFromImage(imageBuffer);

          // Store style in database and update status to style-completed
          await supabaseDb.external_product_images.upsert({
            where: {
              external_url: imageUrl,
            },
            create: {
              external_url: imageUrl,
              style: style,
            },
            update: {
              style: style,
            },
          });

          // Update progress to indicate style processing is complete
          await job.updateProgress({
            status: 'style-completed',
            style,
          } as ProductImageProgress);

          // Generate embeddings
          const embeddings = await pineconeService.getProductImageEmbeddingWithSearchMethod(
            imageBuffer,
            style,
          );

          logService.info(`Generated embeddings for image: ${imageUrl}`, {
            metadata: { embeddingsLength: embeddings.length },
          });

          // Store in database with embeddings
          await supabaseDb.external_product_images.upsert({
            where: {
              external_url: imageUrl,
            },
            create: {
              external_url: imageUrl,
              style: style,
              embeddings: embeddings,
            },
            update: {
              style: style,
              embeddings: embeddings,
            },
          });

          // Return the final result without including the buffer
          return {
            status: 'completed',
            style,
            embeddings,
          } as ProductImageProgress;
        } catch (error) {
          console.log('Error processing product image', error);
          logService.error(`Error processing product image ${imageUrl}:`, {
            metadata: { error: error instanceof Error ? error.message : String(error) },
          });

          // Update status to failed with detailed error info
          await job.updateProgress({
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          } as ProductImageProgress);

          throw error;
        }
      },
      { connection },
    );

    this.worker.on('failed', (job: Job<ProductImageJob>, err: Error) => {
      logService.error(`Failed to process product image ${job.data.imageUrl}:`, {
        metadata: {
          error: err.message,
          jobId: job.id,
          attempts: job.attemptsMade,
          failedReason: job.failedReason,
          stacktrace: job.stacktrace,
        },
      });
    });
  }

  public static getInstance(): ProductImageProcessingQueue {
    if (!ProductImageProcessingQueue.instance) {
      ProductImageProcessingQueue.instance = new ProductImageProcessingQueue();
    }
    return ProductImageProcessingQueue.instance;
  }

  public async addToQueue(imageUrl: string, sessionId?: string): Promise<void> {
    // Check if the job already exists before adding it
    const existingJob = await this.queue.getJob(imageUrl);
    if (existingJob) {
      // Job already exists, no need to add it again
      return;
    }

    await this.queue.add(
      'process-product-image',
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
      name: 'process-product-image',
      data: { imageUrl, sessionId },
      opts: {
        jobId: imageUrl,
        removeOnComplete: false,
      },
    }));

    await this.queue.addBulk(jobs);
  }

  public async getJob(imageUrl: string): Promise<Job<ProductImageJob> | null> {
    return this.queue.getJob(imageUrl);
  }

  public async close(): Promise<void> {
    await this.queue.close();
    await this.worker.close();
  }
}

export const productImageProcessingQueue = ProductImageProcessingQueue.getInstance();
