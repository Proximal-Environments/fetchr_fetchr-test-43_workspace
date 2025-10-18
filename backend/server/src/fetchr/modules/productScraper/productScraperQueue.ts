import { Queue, Worker, ConnectionOptions } from 'bullmq';
import { productScraperService } from '../../base/service_injection/global';
import { Gender, ProductCategory, ProductFit } from '@fetchr/schema/base/base';
import { getRedisConfig } from '../../core/redis/redisConfig';
import { logService } from '../../base/logging/logService';

export interface ScrapeJobData {
  url: string;
  env: 'BROWSERBASE' | 'LOCAL';
  userId: string;
}

export interface ScrapeJobResult {
  status: 'pending' | 'completed' | 'failed';
  result?: {
    title: string;
    price: number;
    brandName: string;
    description: string;
    imageUrls: string[];
    s3ImageUrls: string[];
    url: string;
    gender: Gender;
    category: ProductCategory;
    fit: ProductFit;
  };
  error?: string;
}

export interface ProductUpload {
  id: string;
  url: string;
  status: 'pending' | 'completed' | 'failed';
  result?: ScrapeJobResult['result'];
  error?: string;
  createdAt: Date;
}

const QUEUE_NAME = 'product-scraping';

let queue: Queue<ScrapeJobData, ScrapeJobResult> | null = null;
let worker: Worker<ScrapeJobData, ScrapeJobResult> | null = null;

export async function listUserUploads(userId: string): Promise<ProductUpload[]> {
  const q = getQueue();
  const jobs = await q.getJobs(['active', 'waiting', 'completed', 'failed']);

  return jobs
    .filter(job => job.data.userId === userId)
    .map(job => {
      let status: 'pending' | 'completed' | 'failed';
      if (job.finishedOn) {
        status = job.failedReason ? 'failed' : 'completed';
      } else {
        status = 'pending';
      }

      return {
        id: job.id || '',
        url: job.data.url,
        status,
        result: job.returnvalue?.result,
        error: job.failedReason || job.returnvalue?.error,
        createdAt: new Date(job.timestamp),
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function initializeQueue(): Queue<ScrapeJobData, ScrapeJobResult> {
  if (queue) return queue;

  const redisConfig = getRedisConfig();
  const user = redisConfig.user;
  const password = redisConfig.password;
  const tls = redisConfig.tls;
  const cleanRedisUrl = redisConfig.redisUrl?.replace(/^redis:\/\//, '');
  const lastColonIndex = cleanRedisUrl?.lastIndexOf(':') ?? -1;
  const host = lastColonIndex > -1 ? cleanRedisUrl?.substring(0, lastColonIndex) : cleanRedisUrl;
  const port = lastColonIndex > -1 ? cleanRedisUrl?.substring(lastColonIndex + 1) : '6379';
  logService.info('Initializing product scraper queue', {
    metadata: { host, port, user, password, tls },
  });

  if (!host || !port) {
    throw new Error('Invalid Redis URL');
  }

  const connection: ConnectionOptions = {
    host: host,
    port: parseInt(port),
    username: user,
    password: password,
    tls: tls
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  };

  queue = new Queue<ScrapeJobData, ScrapeJobResult>(`${QUEUE_NAME}`, {
    // https://docs.bullmq.io/bull/patterns/redis-cluster
    prefix: '{bullqueue}',
    connection,
  });

  // Initialize the worker
  worker = new Worker<ScrapeJobData, ScrapeJobResult>(
    QUEUE_NAME,
    async job => {
      try {
        const result = await productScraperService.scrapeProduct(job.data.url, job.data.env);
        return {
          status: 'completed',
          result: {
            title: result.title,
            price: result.price,
            brandName: result.brandName,
            description: result.description,
            imageUrls: result.productImageUrls,
            s3ImageUrls: result.s3ImageUrls,
            url: job.data.url,
            gender: result.gender,
            category: result.category,
            fit: result.fit,
            sizes: result.availableSizes,
          },
        };
      } catch (error) {
        logService.error('Error in scraping worker', { error });
        return {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
      }
    },
    {
      // https://github.com/taskforcesh/bullmq/issues/906#issuecomment-2094142133
      prefix: '{bullworker}',
      connection,
      concurrency: 5,
    },
  );

  worker.on('completed', job => {
    logService.info('Scraping job completed', { metadata: { jobId: job.id } });
  });

  worker.on('failed', (job, error) => {
    logService.error('Scraping job failed', { metadata: { jobId: job?.id }, error });
  });

  return queue;
}

export function getQueue(): Queue<ScrapeJobData, ScrapeJobResult> {
  if (!queue) {
    throw new Error('Queue not initialized. Call initializeQueue first.');
  }
  return queue;
}

export async function cleanup(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
