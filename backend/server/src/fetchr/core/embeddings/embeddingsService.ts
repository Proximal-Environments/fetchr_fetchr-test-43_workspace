import {
  EmbeddingModel,
  OpenAIEmbeddingModel,
  VoyageEmbeddingModel,
} from '@fetchr/schema/core/core';
import { inject, injectable } from 'inversify';
import { logService } from '../../base/logging/logService';
import { createHash } from 'crypto';
import { OpenAIService } from '../open_ai/openaiService';
import { SiglipService } from '../siglip/siglipService';
import { VoyageService } from '../voyage/voyageService';
import { assertNever } from '../../../shared/utils';
import { S3Service } from '../aws/s3/s3Service';
import { BaseService } from '../../base/service_injection/baseService';

export type EmbeddingModelType =
  | EmbeddingModel
  | EmbeddingModel[]
  | { model: EmbeddingModel; outputDimension?: number; multiplier?: number }
  | { model: EmbeddingModel; outputDimension?: number; multiplier?: number }[];

@injectable()
export class EmbeddingsService extends BaseService {
  private embeddingsCache: Map<string, Map<EmbeddingModelType, number[]>> = new Map();

  constructor(
    @inject(OpenAIService) private openAIService: OpenAIService,
    @inject(SiglipService) private siglipService: SiglipService,
    @inject(VoyageService) private voyageService: VoyageService,
    @inject(S3Service) private s3Service: S3Service,
  ) {
    super('EmbeddingsService', logService);
  }

  private generateImageKey(imageBuffer: Buffer): string {
    return createHash('sha256').update(imageBuffer).digest('hex');
  }

  public async getQueryEmbedding(
    query: string,
    model: EmbeddingModelType = EmbeddingModel.EMBEDDING_MODEL_SIGLIP,
  ): Promise<number[]> {
    if (this.embeddingsCache.has(query) && this.embeddingsCache.get(query)?.has(model)) {
      const cachedEmbedding = this.embeddingsCache.get(query)?.get(model);
      if (cachedEmbedding) {
        return cachedEmbedding;
      }
    }

    const embeddings: number[] = [];
    const modelsArray = Array.isArray(model) ? model : [model];
    for (const curModel of modelsArray) {
      const embeddingModel = typeof curModel === 'object' ? curModel.model : curModel;
      const curOutputDimension =
        typeof curModel === 'object' ? curModel.outputDimension : undefined;
      const multiplier = typeof curModel === 'object' ? curModel.multiplier : 1;

      let curEmbedding: number[];
      switch (embeddingModel) {
        case EmbeddingModel.EMBEDDING_MODEL_SIGLIP:
          curEmbedding = await this.siglipService.getQueryEmbedding(query);
          break;
        case EmbeddingModel.EMBEDDING_MODEL_TEXT_EMBEDDING_3_LARGE:
          curEmbedding = await this.openAIService.embedText(
            query,
            OpenAIEmbeddingModel.TEXT_EMBEDDING_3_LARGE,
          );
          break;
        case EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3:
          curEmbedding = await this.voyageService.embedText(
            query,
            VoyageEmbeddingModel.VOYAGE_LARGE_3,
            curOutputDimension,
          );
          break;
        case EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3_MULTIMODAL:
          curEmbedding = await this.voyageService.embedMultimodal(
            query,
            undefined,
            curOutputDimension,
          );
          break;
        case EmbeddingModel.UNRECOGNIZED:
          throw new Error(`Embedding model ${model} not implemented`);
        default:
          assertNever(embeddingModel);
      }

      if (multiplier !== undefined && multiplier !== 1) {
        curEmbedding = curEmbedding.map(value => value * multiplier);
      }

      embeddings.push(...curEmbedding);
    }

    if (embeddings && embeddings.length > 0) {
      const queryCache = this.embeddingsCache.get(query) || new Map();
      this.embeddingsCache.set(query, queryCache);
      queryCache.set(model, embeddings);
      return embeddings;
    } else {
      throw new Error(`Failed to generate embedding for query: ${query}`);
    }
  }
  public async batchGetQueryEmbeddings(
    queries: string[],
    model: EmbeddingModelType = EmbeddingModel.EMBEDDING_MODEL_SIGLIP,
  ): Promise<number[][]> {
    const resultEmbeddings: number[][] = [];
    const queriesToEmbed: string[] = [];
    const cachedEmbeddings: Map<string, number[]> = new Map();

    // Check cache first
    for (const query of queries) {
      const queryCache = this.embeddingsCache.get(query);
      const modelEmbedding = queryCache?.get(model);
      if (queryCache && modelEmbedding) {
        cachedEmbeddings.set(query, modelEmbedding);
      } else {
        queriesToEmbed.push(query);
      }
    }

    let newEmbeddingsList: number[][] = [];

    if (queriesToEmbed.length > 0) {
      const modelsArray = Array.isArray(model) ? model : [model];

      // Get embeddings for each model in parallel
      const modelEmbeddingsArrays = await Promise.all(
        modelsArray.map(async curModel => {
          const embeddingModel = typeof curModel === 'object' ? curModel.model : curModel;
          const curOutputDimension =
            typeof curModel === 'object' ? curModel.outputDimension : undefined;
          const multiplier = typeof curModel === 'object' ? curModel.multiplier : 1;

          let embeddings: number[][];
          switch (embeddingModel) {
            case EmbeddingModel.EMBEDDING_MODEL_SIGLIP:
              // TODO: Implement SIGLIP batch text embedding
              throw new Error(`SIGLIP batch text embedding not implemented yet`);
            case EmbeddingModel.EMBEDDING_MODEL_TEXT_EMBEDDING_3_LARGE:
              embeddings = await this.openAIService.batchEmbedText(
                queriesToEmbed,
                OpenAIEmbeddingModel.TEXT_EMBEDDING_3_LARGE,
              );
              break;
            case EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3:
              embeddings = await this.voyageService.batchEmbedText(
                queriesToEmbed,
                VoyageEmbeddingModel.VOYAGE_LARGE_3,
                curOutputDimension,
              );
              break;
            case EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3_MULTIMODAL:
              embeddings = await Promise.all(
                queriesToEmbed.map(q =>
                  this.voyageService.embedMultimodal(q, undefined, curOutputDimension),
                ),
              );
              break;
            case EmbeddingModel.UNRECOGNIZED:
              throw new Error(`Embedding model ${embeddingModel} not implemented`);
            default:
              assertNever(embeddingModel);
          }

          if (multiplier !== undefined && multiplier !== 1) {
            embeddings = embeddings.map(embedding => embedding.map(value => value * multiplier));
          }

          return embeddings;
        }),
      );

      // Concatenate embeddings from different models for each query
      newEmbeddingsList = queriesToEmbed.map((_, queryIndex) => {
        return modelEmbeddingsArrays.reduce((concatenated, modelEmbeddings) => {
          return [...concatenated, ...modelEmbeddings[queryIndex]];
        }, [] as number[]);
      });

      // Cache the results
      queriesToEmbed.forEach((query, index) => {
        const queryCache = this.embeddingsCache.get(query) || new Map();
        this.embeddingsCache.set(query, queryCache);
        queryCache.set(model, newEmbeddingsList[index]);
        cachedEmbeddings.set(query, newEmbeddingsList[index]);
      });
    }

    // Build final results in original query order
    for (const query of queries) {
      const embedding = cachedEmbeddings.get(query);
      if (embedding) {
        resultEmbeddings.push(embedding);
      } else {
        throw new Error(`Failed to retrieve embedding for query: ${query}`);
      }
    }

    return resultEmbeddings;
  }

  public async getImageEmbedding(
    image: Buffer | string,
    options: { useSafeS3: boolean } = { useSafeS3: false },
  ): Promise<number[]> {
    const imageKey = typeof image === 'string' ? image : this.generateImageKey(image);
    const imageBuffer =
      typeof image === 'string'
        ? options.useSafeS3
          ? await this.s3Service.getImageSafeOrFail(image)
          : await this.s3Service.getImageOrFail(image)
        : image;
    if (
      this.embeddingsCache.has(imageKey) &&
      this.embeddingsCache.get(imageKey)?.has(EmbeddingModel.EMBEDDING_MODEL_SIGLIP)
    ) {
      const cache = this.embeddingsCache.get(imageKey);
      const embedding = cache?.get(EmbeddingModel.EMBEDDING_MODEL_SIGLIP);
      if (embedding) {
        return embedding;
      }
    }

    const embedding = await this.siglipService.getImageEmbedding(imageBuffer);

    if (!this.embeddingsCache.has(imageKey)) {
      this.embeddingsCache.set(imageKey, new Map());
    }
    const imageCache = this.embeddingsCache.get(imageKey);
    if (!imageCache) {
      throw new Error('Image cache not found');
    }
    imageCache.set(EmbeddingModel.EMBEDDING_MODEL_SIGLIP, embedding);
    return embedding;
  }

  public async batchGetImageEmbeddings(imageBuffers: Buffer[]): Promise<number[][]> {
    return this.siglipService.batchGetImageEmbeddings(imageBuffers);
  }
}
