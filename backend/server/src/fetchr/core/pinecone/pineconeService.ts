import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { EmbeddingModelType, EmbeddingsService } from '../embeddings/embeddingsService';
import { S3Service } from '../aws/s3/s3Service';
import {
  Pinecone,
  Index,
  RecordMetadata,
  RecordMetadataValue,
  RecordSparseValues,
} from '@pinecone-database/pinecone';

import { convertCategoryToDbCategory, convertGenderToDbGender } from '../../../shared/converters';
import { EmbeddingModel } from '@fetchr/schema/core/core';
import { Product, ProductCategory, SearchMethod, SearchQuery } from '@fetchr/schema/base/base';
import {
  convertSearchQueryToProductMetadataFilter,
  hybridScoreNorm,
  ProductMetadataFilter,
} from './pineconeUtils';
import { assertNever } from '../../../shared/utils';
import { VoyageService } from '../voyage/voyageService';
import { SparseService } from '../sparse/sparseService';
import { ScoredVector } from '@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch/db_data';
import { logService } from '../../base/logging/logService';
import { Perf } from '../performance/performance';
const PINECONE_INDEX_SIGLIP = 'siglip-averaged';
const PINECONE_INDEX_VOYAGE_EMBEDDING = 'siglip-voyage';
const PINECONE_INDEX_VOYAGE_MULTIMODAL = 'voyage-multimodal';
const PINECONE_INDEX_VOYAGE_TEXT_SIGLIP_IMAGE = 'voyage-text-siglip-image';
const PINECONE_INDEX_VOYAGE_TEXT_SIGLIP_IMAGE_SPARSE = 'siglip-image-voyage-text-hybrid';
const PINECONE_INDEX_VOYAGE_TEXT_SIGLIP_IMAGE_SPARSE_CLEAN =
  'clean-siglip-image-voyage-text-hybrid';
const PINECONE_INDEX_VOYAGE_TEXT_SIGLIP_IMAGE_SPARSE_CLEAN_WITH_SEMANTIC_METADATA =
  'clean-siglip-voyage-hybrid-with-masking';
const EMBEDDING_IMAGE_WEIGHT = 0.7;
const EMBEDDING_TEXT_WEIGHT = 0.3;

export const DEFAULT_SEARCH_METHOD: SearchMethod =
  SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN;

@injectable()
export class PineconeService extends BaseService {
  private pc: Pinecone;
  private productIndexSiglip_averagedByDefault: Index;
  private productIndexVoyageEmbedding: Index;
  private productIndexVoyageMultimodal: Index;
  private productIndexVoyageTextSiglipImage_defaultOnlyFirstImage: Index;
  private productIndexVoyageTextSiglipImage_sparse: Index;
  private productIndexVoyageTextSiglipImage_sparse_clean: Index;
  private productIndexVoyageTextSiglipImage_sparse_clean_with_semantic_metadata: Index;

  constructor(
    @inject(EmbeddingsService) private embeddingsService: EmbeddingsService,
    @inject(S3Service) private s3Service: S3Service,
    @inject(VoyageService) private voyageService: VoyageService,
    @inject(SparseService) private sparseService: SparseService,
    @inject(Perf) private perfService: Perf,
    apiKey?: string,
  ) {
    super('PineconeService', logService);
    const finalApiKey = apiKey || process.env.PINECONE_API_KEY;
    if (!finalApiKey) {
      throw new Error('Pinecone API key is required');
    }

    this.pc = new Pinecone({
      apiKey: finalApiKey,
    });

    this.productIndexSiglip_averagedByDefault = this.pc.Index(PINECONE_INDEX_SIGLIP);
    this.productIndexVoyageEmbedding = this.pc.Index(PINECONE_INDEX_VOYAGE_EMBEDDING);
    this.productIndexVoyageMultimodal = this.pc.Index(PINECONE_INDEX_VOYAGE_MULTIMODAL);
    this.productIndexVoyageTextSiglipImage_defaultOnlyFirstImage = this.pc.Index(
      PINECONE_INDEX_VOYAGE_TEXT_SIGLIP_IMAGE,
    );
    this.productIndexVoyageTextSiglipImage_sparse = this.pc.Index(
      PINECONE_INDEX_VOYAGE_TEXT_SIGLIP_IMAGE_SPARSE,
    );
    this.productIndexVoyageTextSiglipImage_sparse_clean = this.pc.Index(
      PINECONE_INDEX_VOYAGE_TEXT_SIGLIP_IMAGE_SPARSE_CLEAN,
    );
    this.productIndexVoyageTextSiglipImage_sparse_clean_with_semantic_metadata = this.pc.Index(
      PINECONE_INDEX_VOYAGE_TEXT_SIGLIP_IMAGE_SPARSE_CLEAN_WITH_SEMANTIC_METADATA,
    );
  }

  public getIndexAndNamespaceForSearchMethod(searchMethod: SearchMethod): Index {
    let index = undefined,
      namespace = undefined;
    namespace = undefined;
    switch (searchMethod) {
      case SearchMethod.SEARCH_METHOD_IMAGE:
        index = this.productIndexSiglip_averagedByDefault;
        namespace = 'image-only';
        break;
      case SearchMethod.SEARCH_METHOD_TEXT:
        index = this.productIndexSiglip_averagedByDefault;
        namespace = 'text-only';
        break;
      case SearchMethod.SEARCH_METHOD_IMAGE_TEXT_AVERAGE:
        index = this.productIndexSiglip_averagedByDefault;
        break;
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT:
        index = this.productIndexVoyageEmbedding;
        break;
      case SearchMethod.SEARCH_METHOD_VOYAGE_MULTIMODAL:
        index = this.productIndexVoyageMultimodal;
        break;
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE:
        index = this.productIndexVoyageTextSiglipImage_defaultOnlyFirstImage;
        break;
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE:
        index = this.productIndexVoyageTextSiglipImage_defaultOnlyFirstImage;
        namespace = 'image-averaged-equal-weight';
        break;
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE:
        index = this.productIndexVoyageTextSiglipImage_sparse;
        break;
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN:
        index = this.productIndexVoyageTextSiglipImage_sparse_clean;
        break;
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN_WITH_SEMANTIC_METADATA:
        index = this.productIndexVoyageTextSiglipImage_sparse_clean_with_semantic_metadata;
        break;
      case SearchMethod.SEARCH_METHOD_UNSPECIFIED:
        throw new Error('Search method is required');
      case SearchMethod.UNRECOGNIZED:
        throw new Error('Search method is required');
      default:
        assertNever(searchMethod);
    }
    return namespace ? index.namespace(namespace) : index;
  }

  public getSparseVectorOptions(searchMethod: SearchMethod): {
    alpha: number;
    shouldUseSparseVector: boolean;
  } {
    switch (searchMethod) {
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE:
        return { alpha: 0.9, shouldUseSparseVector: true };
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN:
        return { alpha: 0.9, shouldUseSparseVector: true };
      default:
        return { alpha: 1, shouldUseSparseVector: false };
    }
  }

  public getEmbeddingModelForSearchMethod(searchMethod: SearchMethod): EmbeddingModelType {
    switch (searchMethod) {
      case SearchMethod.SEARCH_METHOD_IMAGE:
        return EmbeddingModel.EMBEDDING_MODEL_SIGLIP;
      case SearchMethod.SEARCH_METHOD_TEXT:
        return EmbeddingModel.EMBEDDING_MODEL_SIGLIP;
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT: {
        return EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3;
      }
      case SearchMethod.SEARCH_METHOD_VOYAGE_MULTIMODAL: {
        return {
          model: EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3_MULTIMODAL,
          outputDimension: 1024,
        };
      }
      case SearchMethod.SEARCH_METHOD_IMAGE_TEXT_AVERAGE:
        return EmbeddingModel.EMBEDDING_MODEL_SIGLIP;
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE:
        return [
          EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3,
          EmbeddingModel.EMBEDDING_MODEL_SIGLIP,
        ];
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE:
        return [
          EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3,
          EmbeddingModel.EMBEDDING_MODEL_SIGLIP,
        ];
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE:
        return [
          EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3,
          EmbeddingModel.EMBEDDING_MODEL_SIGLIP,
        ];
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN:
        return [
          EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3,
          EmbeddingModel.EMBEDDING_MODEL_SIGLIP,
        ];
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN_WITH_SEMANTIC_METADATA:
        const secondaryMultiplier = 0;
        return [
          { model: EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3, multiplier: 1 }, // Main
          { model: EmbeddingModel.EMBEDDING_MODEL_SIGLIP, multiplier: 1 },
          { model: EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3, multiplier: secondaryMultiplier }, // Color
          // { model: EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3, multiplier: 0.8 }, // Brand
          { model: EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3, multiplier: secondaryMultiplier }, // Style
          { model: EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3, multiplier: secondaryMultiplier }, // Materials
        ];
      case SearchMethod.SEARCH_METHOD_UNSPECIFIED:
        throw new Error('Search method is required');
      case SearchMethod.UNRECOGNIZED:
        throw new Error('Search method is required');
      default:
        assertNever(searchMethod);
    }
  }

  public async searchProducts(
    query: string,
    searchMethod: SearchMethod = DEFAULT_SEARCH_METHOD,
    topK: number = 10,
    metadataFilter?: ProductMetadataFilter,
  ): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
    return this.perfService.track('PineconeService.searchProducts', async () => {
      this.logService.info(
        `Searching Pinecone with query: ${query}, searchMethod: ${searchMethod}, topK: ${topK}, metadataFilter: ${JSON.stringify(
          metadataFilter,
        )}`,
      );

      const embeddingModel = this.getEmbeddingModelForSearchMethod(searchMethod);
      const queryEmbedding = await this.embeddingsService.getQueryEmbedding(query, embeddingModel);

      return this._searchProducts(query, queryEmbedding, topK, searchMethod, metadataFilter);
    });
  }

  public async searchSimilarProducts(
    product: Product,
    searchMethod: SearchMethod,
    topK: number = 10,
    searchQuery?: SearchQuery,
  ): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
    this.logService.info(
      `Searching similar products for product ${product.id}, searchMethod: ${searchMethod}, topK: ${topK}`,
    );

    const productEmbedding = await this.getItemEmbedding(product.id, searchMethod);
    if (!productEmbedding) {
      throw new Error(`Could not find embedding for product ${product.id}`);
    }

    const query = await this.generateProductMarkdownDescription(product);
    const metadataFilter = searchQuery
      ? convertSearchQueryToProductMetadataFilter(searchQuery)
      : undefined;
    return this._searchProducts(query, productEmbedding, topK, searchMethod, metadataFilter);
  }

  public async cleanIndexForSearchMethod(searchMethod: SearchMethod): Promise<void> {
    const index = this.getIndexAndNamespaceForSearchMethod(searchMethod);
    await index.deleteAll().catch(error => {
      this.logService.error(
        `Error deleting all records from index ${index._describeIndexStats}: ${error}`,
      );
    });
  }

  public async batchInsertProducts(
    products: Product[],
    searchMethod: SearchMethod,
  ): Promise<{
    averageTimeToGetImage: number;
    averageTimeToGetEmbedding: number;
    averageTimeToUpsert: number;
  }> {
    const failedProducts: { productId: string; error: Error }[] = [];

    // First, fetch all images in parallel
    const startTimeImage = Date.now();
    const imageResults = await Promise.allSettled(
      products.map(product =>
        product.compressedImageUrls?.[0]
          ? this.s3Service.getImageSafeOrFail(product.compressedImageUrls[0])
          : Promise.reject(new Error(`No image URL available for product ${product.id}`)),
      ),
    );

    // Process results and prepare valid images for batch embedding
    const validProducts: { product: Product; imageBuffer: Buffer }[] = [];
    const validImageBuffers: Buffer[] = [];

    imageResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        validProducts.push({
          product: products[index],
          imageBuffer: result.value,
        });
        validImageBuffers.push(result.value);
      } else {
        failedProducts.push({
          productId: products[index].id,
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        });
      }
    });

    const totalTimeToGetImage = Date.now() - startTimeImage;

    // Batch process all valid images for embeddings and sparse vectors in parallel
    const startTimeEmbedding = Date.now();
    const [embeddingResults, sparseVectorsResults] = await Promise.all([
      Promise.allSettled(
        validProducts.map(({ product }) =>
          this.getProductEmbeddingWithSearchMethod(product, searchMethod),
        ),
      ),
      Promise.allSettled(
        validProducts.map(({ product }) => {
          const productString = `${product.title} ${product.colors?.join(
            ', ',
          )} ${product.materials?.join(', ')} ${product.category} ${product.style} ${
            product.gender
          } ${product.price} ${product.generatedDescription}`;
          return this.sparseService.getSparseVector(productString, 'passage');
        }),
      ),
    ]);

    // Filter out failed embeddings and sparse vectors
    const successfulProducts: {
      product: Product;
      embedding: number[];
      sparseVector: RecordSparseValues;
    }[] = [];

    for (let i = 0; i < validProducts.length; i++) {
      const embeddingResult = embeddingResults[i];
      const sparseVectorResult = sparseVectorsResults[i];

      if (embeddingResult.status === 'fulfilled' && sparseVectorResult.status === 'fulfilled') {
        successfulProducts.push({
          product: validProducts[i].product,
          embedding: embeddingResult.value,
          sparseVector: sparseVectorResult.value,
        });
      } else {
        failedProducts.push({
          productId: validProducts[i].product.id,
          error:
            embeddingResult.status === 'rejected'
              ? embeddingResult.reason instanceof Error
                ? embeddingResult.reason
                : new Error(String(embeddingResult.reason))
              : sparseVectorResult.status === 'rejected'
              ? sparseVectorResult.reason instanceof Error
                ? sparseVectorResult.reason
                : new Error(String(sparseVectorResult.reason))
              : new Error('Unknown error'),
        });
      }
    }
    const totalTimeToGetEmbedding = Date.now() - startTimeEmbedding;

    if (successfulProducts.length === 0) {
      this.logService.warn('No products were successfully processed');
      return {
        averageTimeToGetEmbedding: 0,
        averageTimeToGetImage: 0,
        averageTimeToUpsert: 0,
      };
    }

    try {
      // Prepare upsert data using only successful products
      const metadata = successfulProducts.map(item =>
        this.generateUpdatedProductMetadata(item.product.id, item.product),
      );

      const upsertStartTime = Date.now();
      const upsertData = successfulProducts.map((item, index) => {
        // Filter out empty sparse vectors to avoid Pinecone error
        const sparseVector =
          item.sparseVector && item.sparseVector.indices && item.sparseVector.indices.length > 0
            ? item.sparseVector
            : undefined;

        return {
          id: item.product.id,
          values: item.embedding,
          metadata: metadata[index],
          sparseValues: sparseVector,
        };
      });

      const index = this.getIndexAndNamespaceForSearchMethod(searchMethod);
      await index.upsert(upsertData);
      const upsertEndTime = Date.now();

      if (failedProducts.length > 0) {
        this.logService.warn(`Failed to process ${failedProducts.length} products`, {
          metadata: { failedProducts },
        });
      }

      return {
        averageTimeToGetImage: totalTimeToGetImage,
        averageTimeToGetEmbedding: totalTimeToGetEmbedding,
        averageTimeToUpsert: upsertEndTime - upsertStartTime,
      };
    } catch (error) {
      this.logService.error('Failed to upsert products to Pinecone', {
        error,
        metadata: {
          successfulCount: successfulProducts.length,
          failedCount: failedProducts.length,
        },
      });
      throw error;
    }
  }

  private async _searchProducts(
    query: string,
    queryEmbedding: number[],
    topK: number,
    searchMethod: SearchMethod,
    metadataFilter?: ProductMetadataFilter,
  ): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
    const index = this.getIndexAndNamespaceForSearchMethod(searchMethod);

    const metadataFilterDict = metadataFilter
      ? Object.fromEntries(
          Object.entries(metadataFilter).filter(
            ([_, v]) => v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : true),
          ),
        )
      : undefined;

    console.log('[MetadataFilterDict]', metadataFilterDict);
    let sparseVector: RecordSparseValues | undefined = undefined;
    let denseVector: number[] = queryEmbedding;

    const { alpha, shouldUseSparseVector } = this.getSparseVectorOptions(searchMethod);
    if (shouldUseSparseVector) {
      sparseVector = await this.sparseService.getSparseVector(query, 'query');
      console.log('[SparseVector]', sparseVector);
      [denseVector, sparseVector] = hybridScoreNorm(denseVector, sparseVector, alpha);
    }

    const queryRequest: {
      vector: number[];
      topK: number;
      includeMetadata: boolean;
      filter?: Record<string, unknown>;
      sparseVector?: RecordSparseValues;
    } = {
      vector: denseVector,
      topK: topK,
      includeMetadata: true,
      filter: metadataFilterDict,
      sparseVector: sparseVector,
    };

    this.logService.info(
      `Searching Pinecone index with queryRequest: ${JSON.stringify(queryRequest)}`,
      {
        metadata: {
          index,
        },
      },
    );

    const result = await index.query({
      ...queryRequest,
      topK: topK,
    });

    const matches = result.matches || [];
    this.logService.info(`Pinecone returned ${matches.length} results`);

    const searchResults = matches.map((match: ScoredVector) => ({
      id: match.id,
      score: match.score,
      metadata: (match.metadata || {}) as Record<string, unknown>,
    }));

    this.logService.info(`First few search results: ${JSON.stringify(searchResults.slice(0, 2))}`);

    return searchResults.map(result => ({
      id: result.id,
      score: result.score || 0,
      metadata: result.metadata || {},
    }));
  }

  public async getItemEmbedding(
    productId: string,
    searchMethod: SearchMethod,
  ): Promise<number[] | null> {
    const index = this.getIndexAndNamespaceForSearchMethod(searchMethod);
    try {
      const result = await index.fetch([productId]);
      if (result && result.records && result.records[productId]) {
        return result.records[productId].values;
      }
      return null;
    } catch (error) {
      this.logService.error(`Error fetching embedding for product ${productId}: ${error}`);
      return null;
    }
  }

  public async batchGetItemEmbeddings(
    productIds: string[],
    searchMethod: SearchMethod,
  ): Promise<Array<number[] | null>> {
    const index = this.getIndexAndNamespaceForSearchMethod(searchMethod);

    try {
      const result = await index.fetch(productIds);
      const embeddings = productIds.map(productId => {
        if (result && result.records && result.records[productId]) {
          return result.records[productId].values;
        } else {
          return null;
        }
      });
      return embeddings;
    } catch (error) {
      this.logService.error(`Error fetching embeddings for products ${productIds}: ${error}`);
      return productIds.map(() => null);
    }
  }

  private async generateProductMarkdownDescription(product: Product): Promise<string> {
    const markdownDescription = `
    # ${product.title}
    
    **Brand:** ${product.brandName + (product.subBrandName ? ` (${product.subBrandName})` : '')}
    **Price:** $${product.price}
    **Gender:** ${convertGenderToDbGender(product.gender)}
    
    ${product.generatedDescription || ''}
    
    ## Details
    - **Colors:** ${product.colors?.join(', ') || 'Unknown'}
    - **Materials:** ${product.materials?.join(', ') || 'Unknown'}
    - **Category:** ${convertCategoryToDbCategory(
      product.category || ProductCategory.PRODUCT_CATEGORY_UNSPECIFIED,
    )}
    - **Style:** ${product.style || 'Unknown'}
    `;

    return markdownDescription;
  }

  public async generateTextEmbedding(
    text: string,
    searchMethod: SearchMethod = DEFAULT_SEARCH_METHOD,
  ): Promise<number[]> {
    const embeddingModel = this.getEmbeddingModelForSearchMethod(searchMethod);
    return await this.embeddingsService.getQueryEmbedding(text, embeddingModel);
  }

  private async _generateTextEmbedding_onlyUsesProductText(
    product: Product,
    searchMethod: SearchMethod,
  ): Promise<number[]> {
    if (searchMethod === SearchMethod.SEARCH_METHOD_IMAGE_TEXT_AVERAGE) {
      this.logService.error(
        'Image text average is not supported through _generateTextEmbedding. Use getProductEmbeddingWithSearchMethod instead.',
      );
      throw new Error('Image text average is not supported for text embedding');
    }

    const markdownDescription = await this.generateProductMarkdownDescription(product);

    product.fullGeneratedDescription = markdownDescription;

    const embeddingModel = this.getEmbeddingModelForSearchMethod(searchMethod);
    return await this.embeddingsService.getQueryEmbedding(
      product.fullGeneratedDescription,
      embeddingModel,
    );
  }

  private generateUpdatedProductMetadata(
    id: string,
    productUpdate: Partial<Product>,
  ): RecordMetadata {
    const existingMetadata = {}; // Fetch existing metadata if necessary

    const newMetadata: RecordMetadata = {};

    const formatValue = (value: unknown): RecordMetadataValue | null => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
      }
      if (Array.isArray(value)) {
        return value.filter(item => item !== null && item !== undefined).map(String);
      }
      if (
        Object.prototype.hasOwnProperty.call(value, 'value') &&
        typeof (value as { value: unknown }).value === 'string'
      ) {
        return (value as { value: string }).value;
      }
      return String(value);
    };

    const updateDict = { ...productUpdate };

    for (const key in updateDict) {
      let value: unknown;
      if (key === 'gender') {
        value = productUpdate.gender ? convertGenderToDbGender(productUpdate.gender) : null;
      } else if (key === 'category') {
        value = productUpdate.category ? convertCategoryToDbCategory(productUpdate.category) : null;
      } else {
        value = (updateDict as Record<string, unknown>)[key];
      }
      const formattedValue = formatValue(value);
      if (formattedValue !== null && formattedValue !== '') {
        newMetadata[key] = formattedValue;
      }
    }

    const metadata = {
      ...existingMetadata,
      ...newMetadata,
      product_id: id,
    };

    const finalMetadata = Object.fromEntries(
      Object.entries(metadata).filter(([_, v]) => v !== null && v !== ''),
    );

    return finalMetadata;
  }

  public async insertProductForEverySearchMethod(product: Product): Promise<boolean> {
    const validSearchMethods = Object.values(SearchMethod).filter(
      method =>
        typeof method === 'number' &&
        method !== SearchMethod.UNRECOGNIZED &&
        method !== SearchMethod.SEARCH_METHOD_UNSPECIFIED,
    );

    try {
      const results = await Promise.all(
        validSearchMethods.map(searchMethod => this._insertProduct(product, searchMethod)),
      );

      if (results.every(result => result === false)) {
        this.logService.error(`Failed to insert product ${product.id} for all search methods`);
        throw new Error(`Failed to insert product ${product.id} for all search methods`);
      }

      return true;
    } catch (error) {
      this.logService.error(
        `Error inserting product ${product.id} for all search methods: ${error}`,
      );
      throw error;
    }
  }

  public async insertProduct(product: Product, searchMethod: SearchMethod): Promise<boolean> {
    return this._insertProduct(product, searchMethod);
  }

  public async getProductImageEmbeddingWithSearchMethod(
    productImage: Buffer,
    productText: string,
    searchMethod: SearchMethod = DEFAULT_SEARCH_METHOD,
  ): Promise<number[]> {
    switch (searchMethod) {
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN:
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE:
        let voyageTextEmbedding: number[];
        let imageEmbeddings: number[][];

        try {
          const results = await Promise.all([
            this.embeddingsService.getQueryEmbedding(
              productText,
              this.getEmbeddingModelForSearchMethod(SearchMethod.SEARCH_METHOD_VOYAGE_TEXT),
            ),
            this.embeddingsService.getImageEmbedding(productImage, { useSafeS3: true }),
          ]);

          voyageTextEmbedding = results[0];
          imageEmbeddings = results.slice(1);
        } catch (error) {
          this.logService.error(`Error getting embeddings for product image: ${error}`);
          throw error;
        }

        // Average all image embeddings
        const averagedImageEmbedding = imageEmbeddings[0].map(
          (_, idx: number) =>
            imageEmbeddings.reduce((sum: number, embedding: number[]) => sum + embedding[idx], 0) /
            imageEmbeddings.length,
        );

        return [...voyageTextEmbedding, ...averagedImageEmbedding];
      default:
        throw new Error('Search method is not supported for product image embedding');
    }
  }

  public async getProductEmbeddingWithSearchMethod(
    product: Product,
    searchMethod: SearchMethod,
  ): Promise<number[]> {
    switch (searchMethod) {
      case SearchMethod.SEARCH_METHOD_TEXT:
        return this._generateTextEmbedding_onlyUsesProductText(product, searchMethod);
      case SearchMethod.SEARCH_METHOD_IMAGE:
        try {
          return this.embeddingsService.getImageEmbedding(product.compressedImageUrls[0]);
        } catch (error) {
          this.logService.error(
            `Error getting image embedding for product ${product.id}: ${error}`,
          );
          throw error;
        }
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT:
        return this._generateTextEmbedding_onlyUsesProductText(product, searchMethod);
      case SearchMethod.SEARCH_METHOD_VOYAGE_MULTIMODAL:
        return this.voyageService.embedMultimodal(product.title, product.compressedImageUrls[0]);
      case SearchMethod.SEARCH_METHOD_IMAGE_TEXT_AVERAGE: {
        if (!product.compressedImageUrls || product.compressedImageUrls.length === 0) {
          this.logService.error(`No image URLs available for product ${product.id}`);
          throw new Error('No image URLs available for product');
        }

        let imageEmbedding: number[];
        try {
          imageEmbedding = await this.embeddingsService.getImageEmbedding(
            product.compressedImageUrls[0],
          );
        } catch (error) {
          this.logService.error(
            `Error getting image embedding for product ${product.id}: ${error}`,
          );
          throw error;
        }

        const textEmbedding = await this._generateTextEmbedding_onlyUsesProductText(
          product,
          SearchMethod.SEARCH_METHOD_TEXT,
        );

        const combinedEmbedding = imageEmbedding.map(
          (val, idx) => val * EMBEDDING_IMAGE_WEIGHT + textEmbedding[idx] * EMBEDDING_TEXT_WEIGHT,
        );

        return combinedEmbedding;
      }
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE:
        const [voyageEmbedding, siglipImageEmbedding] = await Promise.all([
          this.getProductEmbeddingWithSearchMethod(product, SearchMethod.SEARCH_METHOD_VOYAGE_TEXT),
          this.getProductEmbeddingWithSearchMethod(product, SearchMethod.SEARCH_METHOD_IMAGE),
        ]);
        return [...voyageEmbedding, ...siglipImageEmbedding];
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE:
        if (!product.compressedImageUrls || product.compressedImageUrls.length === 0) {
          this.logService.error(`No image URLs available for product ${product.id}`);
          throw new Error('No image URLs available for product');
        }
        let voyageTextEmbedding: number[];
        let imageEmbeddings: number[][];

        try {
          const results = await Promise.all([
            this.getProductEmbeddingWithSearchMethod(
              product,
              SearchMethod.SEARCH_METHOD_VOYAGE_TEXT,
            ),
            ...product.compressedImageUrls.map(url =>
              this.embeddingsService.getImageEmbedding(url, { useSafeS3: true }),
            ),
          ]);

          voyageTextEmbedding = results[0];
          imageEmbeddings = results.slice(1);
        } catch (error) {
          this.logService.error(`Error getting embeddings for product ${product.id}: ${error}`);
          throw error;
        }

        // Average all image embeddings
        const averagedImageEmbedding = imageEmbeddings[0].map(
          (_, idx: number) =>
            imageEmbeddings.reduce((sum: number, embedding: number[]) => sum + embedding[idx], 0) /
            imageEmbeddings.length,
        );

        return [...voyageTextEmbedding, ...averagedImageEmbedding];
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE:
        return this.getProductEmbeddingWithSearchMethod(
          product,
          SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE,
        );
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN:
        return this.getProductEmbeddingWithSearchMethod(
          product,
          SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE,
        );
      case SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN_WITH_SEMANTIC_METADATA:
        const [
          voyageEmbeddingFull,
          siglipImageEmbeddingFull,
          colorEmbeddings,
          brandEmbeddings,
          styleEmbeddings,
          materialEmbeddings,
        ] = await Promise.all([
          this._generateTextEmbedding_onlyUsesProductText(
            product,
            SearchMethod.SEARCH_METHOD_VOYAGE_TEXT,
          ),
          this.getProductEmbeddingWithSearchMethod(product, SearchMethod.SEARCH_METHOD_IMAGE),
          this.embeddingsService.getQueryEmbedding(
            product.colors?.join(', '),
            EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3,
          ),
          this.embeddingsService.getQueryEmbedding(
            product.brandName,
            EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3,
          ),
          this.embeddingsService.getQueryEmbedding(
            product.style || '',
            EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3,
          ),
          this.embeddingsService.getQueryEmbedding(
            product.materials?.join(', ') || '',
            EmbeddingModel.EMBEDDING_MODEL_VOYAGE_LARGE_3,
          ),
        ]);

        // console.log(
        //   voyageEmbeddingFull.length,
        //   siglipImageEmbeddingFull.length,
        //   colorEmbeddings.length,
        //   brandEmbeddings.length,
        //   styleEmbeddings.length,
        //   materialEmbeddings.length,
        // );

        return [
          ...voyageEmbeddingFull,
          ...siglipImageEmbeddingFull,
          ...colorEmbeddings,
          ...brandEmbeddings,
          ...styleEmbeddings,
          ...materialEmbeddings,
        ];

      case SearchMethod.SEARCH_METHOD_UNSPECIFIED:
        throw new Error('Search method is not specified');
      case SearchMethod.UNRECOGNIZED:
        throw new Error('Search method is not recognized');
      default:
        assertNever(searchMethod);
    }
  }

  private async _insertProduct(
    product: Product,
    searchMethod: SearchMethod,
    retries: number = 3,
  ): Promise<boolean> {
    try {
      const index = this.getIndexAndNamespaceForSearchMethod(searchMethod);
      const embedding = await this.getProductEmbeddingWithSearchMethod(product, searchMethod);
      const sparseVector = await this.sparseService.getSparseVector(
        product.fullGeneratedDescription,
        'passage',
      );
      const metadata: RecordMetadata = this.generateUpdatedProductMetadata(
        product.id || '',
        product as Partial<Product>,
      );

      if (searchMethod === SearchMethod.SEARCH_METHOD_IMAGE_TEXT_AVERAGE) {
        metadata[
          'embedding_weights'
        ] = `image=${EMBEDDING_IMAGE_WEIGHT},text=${EMBEDDING_TEXT_WEIGHT}`;
        metadata['text_source'] = product.description ? 'title_and_description' : 'title_only';
      }

      await index.upsert([
        { id: product.id, values: embedding, metadata: metadata, sparseValues: sparseVector },
      ]);
      this.logService.info(`Uploaded product ${product.id} to Pinecone`);
      return true;
    } catch (error) {
      this.logService.error(`Error uploading product ${product.id} to Pinecone: ${error}`);
      if (retries > 0) {
        return this._insertProduct(product, searchMethod, retries - 1);
      }
      return false;
    }
  }

  public async updateProductMetadataBatchForAllSearchMethods(
    updates: Array<{
      productId: string;
      productUpdate: Partial<Product>;
      fullProduct: Product;
    }>,
  ): Promise<Record<string, boolean>> {
    const validSearchMethods = Object.values(SearchMethod).filter(
      method =>
        typeof method === 'number' &&
        method !== SearchMethod.UNRECOGNIZED &&
        method !== SearchMethod.SEARCH_METHOD_UNSPECIFIED,
    );

    const results: Record<string, boolean> = {};

    // Initialize all results to false
    updates.forEach(update => {
      results[update.productId] = false;
    });

    try {
      const updatePromises = updates.map(async update => {
        try {
          const productResults = await Promise.all(
            validSearchMethods.map(async searchMethod => {
              try {
                return await this.updateProductMetadataBatch([update], undefined, searchMethod);
              } catch (error) {
                this.logService.error(
                  `Failed to update product ${update.productId} for search method ${searchMethod}: ${error}`,
                );
                return { [update.productId]: false };
              }
            }),
          );

          results[update.productId] = productResults.every(result =>
            Object.values(result).every(success => success),
          );
        } catch (error) {
          this.logService.error(
            `Failed to process update for product ${update.productId}: ${error}`,
          );
          // Result already initialized to false, so we can just continue
        }
      });

      await Promise.all(updatePromises);
    } catch (error) {
      this.logService.error(`Error in batch update process: ${error}`);
      // Results already initialized to false
    }

    return results;
  }

  public async updateProductMetadataBatch(
    updates: Array<{
      productId: string;
      productUpdate: Partial<Product>;
      fullProduct: Product;
    }>,
    batchSize: number = 100,
    searchMethod: SearchMethod,
  ): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    try {
      const productIds = updates.map(u => u.productId);
      const fetchResponse = await this.productIndexSiglip_averagedByDefault.fetch(productIds);

      if (!fetchResponse.records || Object.keys(fetchResponse.records).length === 0) {
        this.logService.warn('No products found in Pinecone index');
        productIds.forEach(id => {
          results[id] = false;
        });
        return results;
      }

      const tasks = updates.map(async update => {
        try {
          const record = fetchResponse.records[update.productId];
          const updatedMetadata = this.generateUpdatedProductMetadata(
            update.productId,
            update.productUpdate,
          );

          let newEmbedding: number[];
          let newSparseVector: RecordSparseValues;

          const currentImageUrl = record.metadata?.image_url || '';
          const newImageUrl = update.productUpdate.compressedImageUrls?.[0] || '';

          if (newImageUrl && newImageUrl !== currentImageUrl) {
            const embedding = await this.getProductEmbeddingWithSearchMethod(
              update.fullProduct,
              searchMethod,
            );
            const sparseVector = await this.sparseService.getSparseVector(
              update.fullProduct.fullGeneratedDescription,
              'passage',
            );
            newEmbedding = [...embedding];
            newSparseVector = sparseVector;
          } else {
            newEmbedding = record.values;
            if (!record.sparseValues) {
              newSparseVector = {
                indices: [],
                values: [],
              };
            } else {
              newSparseVector = record.sparseValues;
            }
          }

          return {
            id: update.productId,
            values: newEmbedding,
            metadata: updatedMetadata,
            sparseValues: newSparseVector,
          };
        } catch (error) {
          this.logService.error(`Error preparing update for product ${update.productId}: ${error}`);
          results[update.productId] = false;
          return null;
        }
      });

      const updateVectors = (await Promise.all(tasks)).filter(v => v !== null && v !== undefined);

      if (updateVectors.length > 0) {
        const index = this.getIndexAndNamespaceForSearchMethod(searchMethod);
        for (let i = 0; i < updateVectors.length; i += batchSize) {
          const batch = updateVectors.slice(i, i + batchSize);
          try {
            await index.upsert(batch);
            this.logService.info(`Updated batch of ${batch.length} products in averaged index`);
            batch.forEach(vector => {
              results[vector.id] = true;
            });
          } catch (error) {
            this.logService.error(`Error updating batch in averaged index: ${error}`);
            batch.forEach(vector => {
              results[vector.id] = false;
            });
          }
        }
      }

      return results;
    } catch (error) {
      this.logService.error(`Error in batch update: ${error}`);
      updates.forEach(update => {
        results[update.productId] = false;
      });
      return results;
    }
  }

  public async updateProductMetadata(
    productId: string,
    productUpdate: Partial<Product>,
    fullProduct: Product,
  ): Promise<boolean> {
    const results = await this.updateProductMetadataBatchForAllSearchMethods([
      { productId, productUpdate, fullProduct },
    ]);
    return results[productId];
  }
}
