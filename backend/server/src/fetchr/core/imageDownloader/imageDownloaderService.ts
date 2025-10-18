import { imageDownloaderQueue, ImageProgress } from './imageDownloaderQueue';
import { BaseService } from '../../base/service_injection/baseService';
import { inject, injectable } from 'inversify';
import { supabaseDb } from '../../base/database/supabaseDb';
import { S3Service } from '../aws/s3/s3Service';
import { logService } from '../../base/logging/logService';

@injectable()
export class ImageDownloaderService extends BaseService {
  constructor(@inject(S3Service) private s3Service: S3Service) {
    super('ImageDownloaderService', logService);
  }

  public async downloadImage(imageUrl: string): Promise<void> {
    // Check if the image already exists in the database
    const existingImage = await supabaseDb.external_images.findUnique({
      where: {
        external_image_url: imageUrl,
      },
    });

    // If the image is not in the database, add it to the download queue
    if (!existingImage) {
      await imageDownloaderQueue.addToQueue(imageUrl);
    } else {
      this.logService.debug(`Image ${imageUrl} already exists in database, skipping download`);
    }
  }

  public async downloadImages(imageUrls: string[]): Promise<void> {
    await Promise.all(imageUrls.map(imageUrl => this.downloadImage(imageUrl)));
  }

  /**
   * Gets the image buffer for a given URL, waiting for it to be available if needed
   *
   * @param imageUrl - The URL of the image to get the buffer for
   * @param shouldWaitIfProcessing - Whether to wait for processing to complete
   * @returns The image buffer if available, null otherwise
   */
  public async getImageBuffer(
    imageUrl: string,
    shouldWaitIfProcessing: boolean = true,
  ): Promise<Buffer | null> {
    this.logService.info(`Getting image buffer for ${imageUrl}`, {
      metadata: { imageUrl, shouldWaitIfProcessing },
    });

    // First check the queue
    const job = await imageDownloaderQueue.getJob(imageUrl);

    if (job) {
      const state = await job.getState();
      this.logService.debug(`Job state for ${imageUrl}: ${state}`);

      const progress = job.progress as ImageProgress;
      if (progress && progress.imageBuffer) {
        this.logService.info(`Found image buffer in progress for ${imageUrl}`);
        return progress.imageBuffer;
      }

      if (state === 'completed' && job.returnvalue) {
        this.logService.info(`Found completed job for ${imageUrl}, but no buffer available`);
        return null;
      }

      if (state === 'failed') {
        this.logService.warn(
          `Job failed for image URL: ${imageUrl} for reason: ${job.failedReason}`,
        );
        return null;
      }

      if ((state === 'active' || state === 'waiting') && shouldWaitIfProcessing) {
        this.logService.info(`Waiting for processing to complete for ${imageUrl}`);
        // Wait for processing to complete (max 30 seconds)
        for (let i = 0; i < 300; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const updatedJob = await imageDownloaderQueue.getJob(imageUrl);

          if (!updatedJob) {
            this.logService.warn(`Job disappeared while waiting for ${imageUrl}`);
            return null;
          }

          const updatedProgress = updatedJob.progress as ImageProgress;
          if (updatedProgress && updatedProgress.imageBuffer) {
            this.logService.info(`Found image buffer while waiting for ${imageUrl}`);
            return updatedProgress.imageBuffer;
          }

          const updatedState = await updatedJob.getState();
          if (updatedState === 'failed') {
            this.logService.warn(`Job failed while waiting for ${imageUrl}`);
            return null;
          }

          if (updatedState === 'completed') {
            this.logService.info(
              `Job completed while waiting for ${imageUrl}, but no buffer available`,
            );
            return null;
          }
        }

        this.logService.warn(`Timed out waiting for image buffer for ${imageUrl}`);
        return null;
      }
    } else {
      // If not in queue, check database
      const existingImage = await supabaseDb.external_images.findUnique({
        where: {
          external_image_url: imageUrl,
        },
      });

      if (existingImage?.internal_image_url) {
        this.logService.info(`Found existing image in database for ${imageUrl}, fetching from S3`, {
          metadata: { internalUrl: existingImage.internal_image_url },
        });
        return await this.s3Service.getImageSafeOrFail(existingImage.internal_image_url);
      }
    }

    return null;
  }

  /**
   * Gets the internal s3 image URL for a given external URL, waiting for it to be available if needed
   *
   * @param imageUrl - The URL of the image to get the internal URL for
   * @param shouldWaitIfProcessing - Whether to wait for processing to complete
   * @returns The internal s3 image URL if available, null otherwise
   */
  public async getInternalImageUrl(
    imageUrl: string,
    shouldWaitIfProcessing: boolean = true,
  ): Promise<string | null> {
    this.logService.info(`Getting internal image URL for ${imageUrl}`, {
      metadata: { imageUrl, shouldWaitIfProcessing },
    });

    // First check the queue
    const job = await imageDownloaderQueue.getJob(imageUrl);

    if (job) {
      const state = await job.getState();
      this.logService.debug(`Job state for ${imageUrl}: ${state}`);

      if (state === 'completed' && job.returnvalue) {
        const result = job.returnvalue as ImageProgress;
        this.logService.info(`Found completed job for ${imageUrl}`, {
          metadata: { internalUrl: result.internalUrl },
        });
        return result.internalUrl || null;
      }

      if (state === 'failed') {
        this.logService.warn(
          `Job failed for image URL: ${imageUrl} with reason: ${job.failedReason}`,
          {
            metadata: {
              imageUrl,
              failedReason: job.failedReason,
              stackTrace: job.stacktrace,
            },
          },
        );
        return null;
      }

      if (state === 'active' && shouldWaitIfProcessing) {
        this.logService.info(`Waiting for processing to complete for ${imageUrl}`);
        // Wait for processing to complete (max 30 seconds)
        for (let i = 0; i < 300; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const updatedJob = await imageDownloaderQueue.getJob(imageUrl);

          if (!updatedJob) {
            this.logService.warn(`Job disappeared while waiting for ${imageUrl}`);
            return null;
          }

          const updatedState = await updatedJob.getState();

          if (updatedState === 'failed') {
            this.logService.warn(`Job failed while waiting for ${imageUrl}`);
            return null;
          }

          if (updatedState === 'completed' && updatedJob.returnvalue) {
            const result = updatedJob.returnvalue as ImageProgress;
            this.logService.info(`Job completed while waiting for ${imageUrl}`, {
              metadata: { internalUrl: result.internalUrl },
            });
            return result.internalUrl || null;
          }
        }
        this.logService.warn(`Timeout waiting for image processing: ${imageUrl}`);
        return null; // Timeout after 30 seconds
      }
    } else {
      // If not in queue, check database
      const existingImage = await supabaseDb.external_images.findUnique({
        where: {
          external_image_url: imageUrl,
        },
      });

      if (existingImage?.internal_image_url) {
        this.logService.info(`Found existing image in database for ${imageUrl}`, {
          metadata: { internalUrl: existingImage.internal_image_url },
        });
        return existingImage.internal_image_url;
      }
    }

    return null;
  }
}
