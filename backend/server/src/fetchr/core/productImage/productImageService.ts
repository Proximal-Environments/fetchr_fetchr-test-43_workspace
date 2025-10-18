import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { productImageProcessingQueue, ProductImageProgress } from './productImageProcessingQueue';
import { ImageDownloaderService } from '../imageDownloader/imageDownloaderService';
import { supabaseDb } from '../../base/database/supabaseDb';
import { logService } from '../../base/logging/logService';
export interface ProcessedProductImage {
  style?: string;
  embeddings?: number[];
  createdAt: Date;
  updatedAt: Date;
}

@injectable()
export class ProductImageService extends BaseService {
  constructor(
    @inject(ImageDownloaderService) private imageDownloaderService: ImageDownloaderService,
  ) {
    super('ProductImageService', logService);
  }

  /**
   * Inserts a product image from an external URL, processing it in the background
   * @param imageUrl The external URL of the image
   * @returns The ID of the created product image record
   */
  public async insertProductImageFromExternalUrl(imageUrl: string): Promise<void> {
    try {
      // Check if the image already exists in the database
      const existingImage = await supabaseDb.external_product_images.findUnique({
        where: {
          external_url: imageUrl,
        },
      });

      if (existingImage) {
        this.logService.debug(`Image ${imageUrl} already exists in database, skipping processing`);
        return;
      }

      // Start processing in background
      await productImageProcessingQueue.addToQueue(imageUrl);
    } catch (error) {
      this.logService.error(`Error inserting product image from URL ${imageUrl}:`, { error });
      throw error;
    }
  }

  /**
   * Gets the image style, waiting for style extraction to complete if necessary
   * @param imageUrl The external URL of the image
   * @param shouldWaitIfProcessing Whether to wait for processing to complete
   * @returns The processed product image style data
   */
  public async getImageAndWaitForStyleIfProcessing(
    imageUrl: string,
    shouldWaitIfProcessing: boolean = true,
  ): Promise<ProcessedProductImage | null> {
    try {
      // Check if the image is in the processing queue first (in-memory)
      const job = await productImageProcessingQueue.getJob(imageUrl);
      if (job) {
        const state = await job.getState();
        const createdAt = new Date();
        const updatedAt = new Date();

        // Get current progress to check status
        const progress = job.progress as ProductImageProgress;

        // If style is already extracted (style-completed or completed status)
        if (
          (progress.status === 'style-completed' || progress.status === 'completed') &&
          progress.style
        ) {
          return {
            style: progress.style,
            createdAt,
            updatedAt,
          };
        }

        if (state === 'completed' && job.returnvalue) {
          const result = job.returnvalue as ProductImageProgress;
          return {
            style: result.style,
            embeddings: result.embeddings,
            createdAt,
            updatedAt,
          };
        }

        if (state === 'failed') {
          this.logService.warn(`Processing failed for image URL ${imageUrl}`);
          return {
            createdAt,
            updatedAt,
          };
        }

        if ((state === 'active' || state === 'waiting') && shouldWaitIfProcessing) {
          // Wait for style to complete (max 30 seconds)
          for (let i = 0; i < 300; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const updatedJob = await productImageProcessingQueue.getJob(imageUrl);

            if (!updatedJob) {
              this.logService.warn(`Job disappeared while waiting for ${imageUrl}`);
              break;
            }

            // Check progress to see if style is completed
            const updatedProgress = updatedJob.progress as ProductImageProgress;
            if (
              (updatedProgress.status === 'style-completed' ||
                updatedProgress.status === 'completed') &&
              updatedProgress.style
            ) {
              return {
                style: updatedProgress.style,
                createdAt,
                updatedAt: new Date(),
              };
            }

            const updatedState = await updatedJob.getState();
            if (updatedState === 'completed' && updatedJob.returnvalue) {
              const result = updatedJob.returnvalue as ProductImageProgress;
              return {
                style: result.style,
                embeddings: result.embeddings,
                createdAt,
                updatedAt: new Date(),
              };
            }

            if (updatedState === 'failed') {
              this.logService.warn(`Processing failed while waiting for ${imageUrl}`);
              return {
                createdAt,
                updatedAt,
              };
            }
          }

          this.logService.warn(`Timed out waiting for image style extraction: ${imageUrl}`);
        }

        // Return basic info if we're not waiting or if we timed out
        return {
          createdAt,
          updatedAt,
        };
      }

      // If not in queue, check database
      const existingImage = await supabaseDb.external_product_images.findUnique({
        where: {
          external_url: imageUrl,
        },
      });

      if (existingImage?.style) {
        return {
          style: existingImage.style,
          embeddings: (existingImage.embeddings as number[]) || [],
          createdAt: existingImage.created_at || new Date(),
          updatedAt: existingImage.updated_at || new Date(),
        };
      }

      this.logService.debug(`No processed image style found for URL ${imageUrl}`);
      return null;
    } catch (error) {
      this.logService.error(`Error getting image style for URL ${imageUrl}:`, { error });
      throw error;
    }
  }

  /**
   * Gets the image embeddings, waiting for the full processing to complete if necessary
   * @param imageUrl The external URL of the image
   * @param shouldWaitIfProcessing Whether to wait for processing to complete
   * @returns The processed product image data with embeddings
   */
  public async getImageAndWaitForEmbeddingIfProcessing(
    imageUrl: string,
    shouldWaitIfProcessing: boolean = true,
  ): Promise<ProcessedProductImage | null> {
    try {
      // Check if the image is in the processing queue first (in-memory)
      const job = await productImageProcessingQueue.getJob(imageUrl);
      if (job) {
        const state = await job.getState();
        const createdAt = new Date();
        const updatedAt = new Date();

        // Get current progress to check status
        const progress = job.progress as ProductImageProgress;

        // Only return if we have the complete embeddings
        if (progress.status === 'completed' && progress.embeddings) {
          return {
            style: progress.style,
            embeddings: progress.embeddings,
            createdAt,
            updatedAt,
          };
        }

        if (state === 'completed' && job.returnvalue) {
          const result = job.returnvalue as ProductImageProgress;
          return {
            style: result.style,
            embeddings: result.embeddings,
            createdAt,
            updatedAt,
          };
        }

        if (state === 'failed') {
          this.logService.warn(`Processing failed for image URL ${imageUrl}`);
          return {
            createdAt,
            updatedAt,
          };
        }

        if ((state === 'active' || state === 'waiting') && shouldWaitIfProcessing) {
          // Wait for embeddings to complete (max 30 seconds)
          for (let i = 0; i < 300; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const updatedJob = await productImageProcessingQueue.getJob(imageUrl);

            if (!updatedJob) {
              this.logService.warn(`Job disappeared while waiting for ${imageUrl}`);
              break;
            }

            // Check progress to see if embeddings are completed
            const updatedProgress = updatedJob.progress as ProductImageProgress;
            if (updatedProgress.status === 'completed' && updatedProgress.embeddings) {
              return {
                style: updatedProgress.style,
                embeddings: updatedProgress.embeddings,
                createdAt,
                updatedAt: new Date(),
              };
            }

            const updatedState = await updatedJob.getState();
            if (updatedState === 'completed' && updatedJob.returnvalue) {
              const result = updatedJob.returnvalue as ProductImageProgress;
              return {
                style: result.style,
                embeddings: result.embeddings,
                createdAt,
                updatedAt: new Date(),
              };
            }

            if (updatedState === 'failed') {
              this.logService.warn(`Processing failed while waiting for ${imageUrl}`);
              return {
                createdAt,
                updatedAt,
              };
            }
          }

          this.logService.warn(`Timed out waiting for image embeddings: ${imageUrl}`);
        }

        // Return basic info if we're not waiting or if we timed out
        return {
          createdAt,
          updatedAt,
        };
      }

      // If not in queue, check database
      const existingImage = await supabaseDb.external_product_images.findUnique({
        where: {
          external_url: imageUrl,
        },
      });

      if (existingImage?.embeddings && (existingImage.embeddings as number[]).length > 0) {
        return {
          style: existingImage.style || undefined,
          embeddings: existingImage.embeddings as number[],
          createdAt: existingImage.created_at || new Date(),
          updatedAt: existingImage.updated_at || new Date(),
        };
      } else if (existingImage?.style) {
        // If we have style but no embeddings, return the style but queue for embedding generation
        await productImageProcessingQueue.addToQueue(imageUrl);
        this.logService.info(`Queued ${imageUrl} for embeddings generation`);

        return {
          style: existingImage.style,
          createdAt: existingImage.created_at || new Date(),
          updatedAt: existingImage.updated_at || new Date(),
        };
      }

      this.logService.debug(`No processed image embeddings found for URL ${imageUrl}`);
      return null;
    } catch (error) {
      this.logService.error(`Error getting image embeddings for URL ${imageUrl}:`, { error });
      throw error;
    }
  }

  public async getImageAndWaitIfProcessing(
    imageUrl: string,
  ): Promise<ProcessedProductImage | null> {
    const styleImage = await this.getImageAndWaitForStyleIfProcessing(imageUrl);
    const embeddingsImage = await this.getImageAndWaitForEmbeddingIfProcessing(imageUrl);

    if (!styleImage && !embeddingsImage) {
      return null;
    }

    return {
      style: styleImage?.style,
      embeddings: embeddingsImage?.embeddings,
      createdAt: embeddingsImage?.createdAt || new Date(),
      updatedAt: embeddingsImage?.updatedAt || new Date(),
    };
  }
  /**
   * Gets the saved internal URL for a product image
   * @param imageUrl The external URL of the image
   * @returns The internal S3 URL if available, null otherwise
   */
  public async getSavedImageUrl(imageUrl: string): Promise<string | null> {
    try {
      return await this.imageDownloaderService.getInternalImageUrl(imageUrl);
    } catch (error) {
      this.logService.error(`Error getting saved image URL for ${imageUrl}:`, { error });
      throw error;
    }
  }
}
