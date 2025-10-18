/* eslint-disable */
import { injectable } from "inversify";
import { BaseService } from "../../base/service_injection/baseService";
import { logService } from "../../base/logging/logService";
import { EmbeddingModel } from "@fetchr/schema/core/core";

export interface SiglipEmbeddingResponse {
  embedding: number[];
}

export interface BatchSiglipEmbeddingResponse {
  embeddings: number[][];
}

/**
 * SiglipService - DISABLED
 *
 * This service has been disabled to avoid dependency issues with @huggingface/transformers
 * and other ML-related packages that can cause installation conflicts. All methods return
 * zero vectors or pass-through values to maintain API compatibility.
 *
 * In a production environment, this service would handle:
 * - Text embedding generation using SigLIP models
 * - Image embedding generation
 * - Batch processing of embeddings
 * - Caching and optimization
 */
@injectable()
export class SiglipService extends BaseService {
  private isDisabled = true;

  constructor() {
    super("SiglipService", logService);
    this.logService.info("SiglipService disabled for task runner environment");
  }

  async getQueryEmbedding(
    query: string,
    _model: EmbeddingModel = EmbeddingModel.EMBEDDING_MODEL_SIGLIP
  ): Promise<number[]> {
    return new Array(512).fill(0); // Return zero vector of expected dimension
  }

  async getImageEmbedding(_imageBuffer: Buffer): Promise<number[]> {
    return new Array(512).fill(0); // Return zero vector of expected dimension
  }

  async updateEmbedding(
    currentEmbedding: number[],
    _likedItems?: number[][],
    _dislikedItems?: number[][]
  ): Promise<number[]> {
    return currentEmbedding; // Return input embedding unchanged
  }

  public async batchGetImageEmbeddings(
    imageBuffers: Buffer[]
  ): Promise<number[][]> {
    // Return zero vectors for each input image
    return imageBuffers.map(() => new Array(512).fill(0));
  }
}
