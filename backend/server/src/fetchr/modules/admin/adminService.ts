import { injectable, inject } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { Product } from '@fetchr/schema/base/base';
import {
  ScrapeProductRequest,
  ScrapeProductResponse,
  GetScrapeStatusRequest,
  GetScrapeStatusResponse,
  ListProductUploadsRequest,
  ListProductUploadsResponse,
  ProductUpload,
} from '@fetchr/schema/admin/admin';
import { v4 as uuidv4 } from 'uuid';
import { getQueue, listUserUploads } from '../productScraper/productScraperQueue';
import { RedisService } from '../../core/redis/redisService';
import { getRequestUser } from '../../base/logging/requestContext';
import { supabaseDb } from '../../base/database/supabaseDb';
import { logService } from '../../base/logging/logService';
@injectable()
export class AdminService extends BaseService {
  constructor(@inject(RedisService) private redisService: RedisService) {
    super('AdminService', logService);
  }

  private async findOrCreateBrand(brandName: string): Promise<string> {
    // First try to find an exact match (case-insensitive)
    const existingBrand = await supabaseDb.brands.findFirst({
      where: {
        company: {
          equals: brandName.toUpperCase(),
          mode: 'insensitive',
        },
      },
    });

    if (existingBrand) {
      return existingBrand.id;
    }

    // Create new brand if not found
    const newBrand = await supabaseDb.brands.create({
      data: {
        company: brandName.toUpperCase(),
        url: '', // Can be updated later
      },
    });

    return newBrand.id;
  }

  async scrapeProduct(request: ScrapeProductRequest): Promise<ScrapeProductResponse> {
    try {
      const user = getRequestUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Add job to queue
      const queue = getQueue();
      const job = await queue.add('scrape', {
        url: request.url,
        env: 'BROWSERBASE',
        userId: user.id,
      });

      if (!job.id) {
        throw new Error('Job not found');
      }
      return {
        result: {
          $case: 'jobId',
          jobId: job.id,
        },
        status: 'pending',
      };
    } catch (error) {
      this.logService.error('Error queueing scrape job', {
        metadata: { url: request.url },
        error,
      });
      throw error;
    }
  }

  async getScrapeStatus(request: GetScrapeStatusRequest): Promise<GetScrapeStatusResponse> {
    try {
      const queue = getQueue();
      const job = await queue.getJob(request.jobId);

      if (!job) {
        throw new Error('Job not found');
      }

      const finished = job.finishedOn;

      if (!finished || !job.isCompleted()) {
        return {
          status: 'pending',
        };
      }

      if (job.failedReason) {
        return {
          status: 'failed',
          error: job.failedReason,
        };
      }

      const result = job.returnvalue;
      if (!result || !result.result) {
        return {
          status: 'failed',
          error: 'Job completed but no result found',
        };
      }

      // Find or create brand
      const brandId = await this.findOrCreateBrand(result.result.brandName);

      const product: Product = {
        id: uuidv4(),
        brandId,
        brandName: result.result.brandName,
        url: result.result.url,
        imageUrls: result.result.imageUrls,
        s3ImageUrls: result.result.imageUrls,
        compressedImageUrls: result.result.imageUrls,
        title: result.result.title,
        name: result.result.title,
        price: result.result.price,
        gender: 0,
        sizes: [],
        description: result.result.description,
        generatedDescription: result.result.description,
        fullGeneratedDescription: result.result.description,
        colors: [],
        materials: [],
        category: 0,
        scrapingMetadata: {
          contentQualityCheck: true,
        },
        manuallyAdded: true,
        highresWebpUrls: [],
        isKidProduct: false,
      };

      return {
        status: 'completed',
        product,
      };
    } catch (error) {
      this.logService.error('Error getting scrape status', {
        metadata: { jobId: request.jobId },
        error,
      });
      throw error;
    }
  }

  async listProductUploads(
    request: ListProductUploadsRequest,
  ): Promise<ListProductUploadsResponse> {
    void request;
    const user = getRequestUser();
    try {
      if (!user) {
        throw new Error('User not authenticated');
      }

      const uploads = await listUserUploads(user.id);

      const protoUploads: ProductUpload[] = await Promise.all(
        uploads.map(async upload => {
          let brandId = '';
          if (upload.result?.brandName) {
            brandId = await this.findOrCreateBrand(upload.result.brandName);
          }

          return {
            id: upload.id,
            url: upload.url,
            status: upload.status,
            error: upload.error,
            createdAt: Number(upload.createdAt),
            product: upload.result
              ? {
                  id: uuidv4(),
                  brandId,
                  brandName: upload.result.brandName,
                  url: upload.result.url,
                  imageUrls: upload.result.imageUrls,
                  s3ImageUrls: upload.result.imageUrls,
                  compressedImageUrls: upload.result.imageUrls,
                  title: upload.result.title,
                  name: upload.result.title,
                  price: upload.result.price,
                  gender: 0,
                  sizes: [],
                  description: upload.result.description,
                  generatedDescription: upload.result.description,
                  fullGeneratedDescription: upload.result.description,
                  colors: [],
                  materials: [],
                  category: 0,
                  scrapingMetadata: {
                    contentQualityCheck: true,
                  },
                  manuallyAdded: true,
                  highresWebpUrls: [],
                  isKidProduct: false,
                }
              : undefined,
          };
        }),
      );

      return {
        uploads: protoUploads,
      };
    } catch (error) {
      this.logService.error('Error listing product uploads', {
        error,
      });
      throw error;
    }
  }
}
