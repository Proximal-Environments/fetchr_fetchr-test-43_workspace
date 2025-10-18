import {
  productSearchService,
  productService,
  embeddingsService,
  s3Service,
  productPreferenceService,
  exploreRequestService,
  openAIService,
  supabaseStorageService,
  perf,
  stylePickerProductService,
} from '../fetchr/base/service_injection/global';
import {
  Product,
  SearchQuery,
  SearchResponse,
  StyleGenerationRequest,
  StyleGenerationResponse,
  TextEmbeddingRequest,
  ImageEmbeddingRequest,
  EmbeddingResponse,
  BaseServiceImplementation,
  GetProductRequest,
  SearchRequest,
  GetProductResponse,
  HealthCheckResponse,
  CreateProductRequest,
  CreateProductResponse,
  GetBrandsRequest,
  GetBrandsResponse,
  CreateBrandRequest,
  CreateBrandResponse,
  SimilarProductsRequest,
  SimilarProductsResponse,
  UploadImageRequest,
  UploadImageResponse,
  GetProductsRequest,
  GetProductsResponse,
  GetLatestAcceptableAppVersionRequest,
  GetLatestAcceptableAppVersionResponse,
  SearchForProductsByUrlRegexResponse,
  SearchForProductsByUrlRegexRequest,
  UpdateProductRequest,
  UpdateProductResponse,
  ListStylePickerProductsRequest,
  ListStylePickerProductsResponse,
  StylePickerProduct as ProtoStylePickerProduct,
  Gender,
  ProductCategory,
} from '@fetchr/schema/base/base';
import { EmbeddingModel } from '@fetchr/schema/core/core';
import { DEFAULT_SEARCH_METHOD } from '../fetchr/core/pinecone/pineconeService';
import { z } from 'zod';
import { logService } from '../fetchr/base/logging/logService';
import { gender } from '@prisma/client';

export class BaseServer implements BaseServiceImplementation {
  async healthCheck(): Promise<HealthCheckResponse> {
    try {
      return { message: 'Server is running' };
    } catch (error) {
      logService.error('Error in healthCheck', { error });
      throw error;
    }
  }

  async getProduct(getProductRequest: GetProductRequest): Promise<GetProductResponse> {
    const product = await productService.getProductOrFail(getProductRequest.id);
    return { product };
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    if (!request.query) {
      throw new Error('Search query is required');
    }
    logService.info(`Searching for ${request.query.query}`, {
      metadata: {
        query: request.query,
      },
    });

    const { query, targetUserId, targetExploreRequestId } = request;

    // Wrap the search operation with tracing to monitor performance
    const results = await perf.track(
      'search.products',
      async () => {
        return await productSearchService.searchProducts(
          query,
          targetUserId,
          targetExploreRequestId,
        );
      },
      {
        queryText: query.query,
        targetUserId,
        targetExploreRequestId,
      },
    );

    return { results };
  }

  async getTextEmbedding(request: TextEmbeddingRequest): Promise<EmbeddingResponse> {
    const embedding = await embeddingsService.getQueryEmbedding(
      request.query,
      EmbeddingModel.EMBEDDING_MODEL_TEXT_EMBEDDING_3_LARGE,
    );
    return { embedding };
  }

  async getImageEmbedding(request: ImageEmbeddingRequest): Promise<EmbeddingResponse> {
    const embedding = await embeddingsService.getImageEmbedding(Buffer.from(request.imageData));
    return { embedding };
  }

  async generateStyles(request: StyleGenerationRequest): Promise<StyleGenerationResponse> {
    const searchQuery: SearchQuery = {
      query: request.query,
      gender: request.gender,
      category: request.category,
      topK: request.numProducts,
      searchMethod: request.searchMethod,
      brandIds: [],
      productIdWhitelist: [],
      productIdBlacklist: [],
    };

    const results = await productSearchService.searchProducts(searchQuery);

    return {
      results: results.map(r => r.product).filter(p => p !== undefined) as Product[],
    };
  }

  async createProduct(request: CreateProductRequest): Promise<CreateProductResponse> {
    try {
      logService.info('Creating product', {
        metadata: { request },
      });

      if (!request.product) {
        throw new Error('Product is required');
      }

      // Check if product already exists
      let existingProduct = null;
      if (request.product.id) {
        try {
          existingProduct = await productService.getProduct(request.product.id);
        } catch (_err) {
          logService.info(
            `Product with ID ${request.product.id} does not exist, creating new product`,
            { error: _err },
          );
        }
      }

      // Process all images in parallel and fail if any upload fails
      const images = await Promise.all(
        request.product.imageUrls.map(imageUrl =>
          supabaseStorageService.getImageSafeOrFail(imageUrl),
        ),
      );

      const uploadPromises = images.map(async image => {
        const s3Url = await s3Service.uploadFileToRandomLocation(image);
        if (!s3Url) {
          throw new Error('Failed to upload image to S3');
        }
        return s3Url;
      });

      // Wait for all uploads to complete or for any to fail
      const uploadedUrls = await Promise.all(uploadPromises);

      const productWithS3Urls = {
        ...request.product,
        imageUrls: uploadedUrls,
        s3ImageUrls: uploadedUrls,
        compressedImageUrls: uploadedUrls,
      };

      if (existingProduct) {
        logService.info(`Updating existing product with ID ${request.product.id}`, {
          metadata: { productId: request.product.id },
        });
        await productService.updateProduct(request.product.id, productWithS3Urls);
      } else {
        logService.info('Inserting new product', {
          metadata: { productId: request.product.id },
        });
        await productService.insertProduct(productWithS3Urls);
      }

      return { product: productWithS3Urls };
    } catch (error) {
      logService.error('Error in createProduct', { error });
      throw error;
    }
  }

  async getBrands(request: GetBrandsRequest): Promise<GetBrandsResponse> {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    request;
    try {
      const brands = await productService.getBrands();
      return { brands };
    } catch (error) {
      logService.error('Error in getBrands', { error });
      throw error;
    }
  }

  async createBrand(request: CreateBrandRequest): Promise<CreateBrandResponse> {
    try {
      if (!request.brand) {
        throw new Error('Brand is required');
      }

      // Check if brand with same URL exists
      const existingBrands = await productService.getBrands();
      const existingBrand = existingBrands.find(
        brand => brand.url.toLowerCase() === request?.brand?.url.toLowerCase(),
      );

      if (existingBrand) {
        throw new Error('A brand with this URL already exists');
      }

      const brand = await productService.createBrand(request.brand);
      logService.info('Created brand', {
        metadata: { brand },
      });

      return { brand };
    } catch (error) {
      logService.error('Error in createBrand', { error });
      throw error;
    }
  }

  async getSimilarProducts(request: SimilarProductsRequest): Promise<SimilarProductsResponse> {
    try {
      if (!request.productId) {
        throw new Error('Product ID is required');
      }

      const searchMethod = request.searchMethod || DEFAULT_SEARCH_METHOD;
      const topK = request.topK || 10;

      const product = await productService.getProductOrFail(request.productId);
      const { query: searchQuery } = await openAIService.submitChatCompletion(
        `Create a google search query to find this exact same product again: ${product.fullGeneratedDescription}`,
        {
          zodSchema: z.object({
            query: z.string(),
          }),
        },
      );

      const products = await productService.searchProducts(
        {
          minPrice: request.minPrice,
          maxPrice: request.maxPrice,
          query: searchQuery,
          gender: request.gender,
          category: request.category,
          brandIds: request.brandIds,
          productIdWhitelist: [],
          productIdBlacklist: [product.id, ...request.productIdBlacklist],
        },
        topK * 5,
        searchMethod,
      );

      const exploreRequest = request.exploreRequestId
        ? await exploreRequestService.getRequestOrFail(request.exploreRequestId)
        : undefined;

      const preferences = exploreRequest
        ? await productPreferenceService.getProductPreferencesForRequest(exploreRequest)
        : [];

      const productsWithQuery = products.map(p => ({
        product: p,
        query: '',
      }));

      const rerankedProducts = await productService.rerankProductsUsingPreferences(
        productsWithQuery,
        preferences,
        searchMethod,
      );

      return { results: rerankedProducts.slice(0, topK) };
    } catch (error) {
      logService.error('Error in getSimilarProducts', { error });
      throw error;
    }
  }

  async uploadImage(request: UploadImageRequest): Promise<UploadImageResponse> {
    const imageUrl = await s3Service.uploadFileToRandomLocation(Buffer.from(request.imageData));
    return { imageUrl };
  }

  async getProducts(request: GetProductsRequest): Promise<GetProductsResponse> {
    const products = await productService.getProductsByIds(request.productIds);
    return { products };
  }

  async getLatestAcceptableAppVersion(
    _request: GetLatestAcceptableAppVersionRequest,
  ): Promise<GetLatestAcceptableAppVersionResponse> {
    return { version: '1.4.0', buildNumber: '184' };
  }

  async searchForProductsByUrlRegex(
    request: SearchForProductsByUrlRegexRequest,
  ): Promise<SearchForProductsByUrlRegexResponse> {
    const products = await productService.searchForProductsByUrlRegex(request.urlRegex);
    return { products };
  }

  async updateProduct(request: UpdateProductRequest): Promise<UpdateProductResponse> {
    const product = await productService.updateProduct(request.productId, {
      price: request.price,
      originalPrice: request.originalPrice,
      sizes: request.sizes.length > 0 ? request.sizes : undefined,
    });
    return { product };
  }

  async listStylePickerProducts(
    request: ListStylePickerProductsRequest,
  ): Promise<ListStylePickerProductsResponse> {
    try {
      logService.info('Attempting to handle listStylePickerProducts request', {
        metadata: {
          servicePath: 'base.BaseService',
          methodName: 'ListStylePickerProducts',
          request,
        },
      });

      const { limit, offset, category, gender } = request;

      // Log the service injection state
      logService.info('StylePickerProductService injection check', {
        metadata: {
          serviceAvailable: !!stylePickerProductService,
          serviceType: stylePickerProductService?.constructor?.name,
        },
      });

      const dbGender = gender ? this.convertProtoGenderToPrismaGender(gender) : undefined;

      const products = await stylePickerProductService.listStylePickerProducts({
        limit,
        offset,
        category,
        gender: dbGender,
      });

      const totalCount = await stylePickerProductService.getTotalCount({
        category,
        gender: dbGender,
      });

      // Convert the service products to proto products
      const protoProducts: ProtoStylePickerProduct[] = products.map(p => ({
        id: p.id.toString(),
        modelImage: p.modelImage,
        stickerImage: p.stickerImage,
        category: p.category || ProductCategory.PRODUCT_CATEGORY_UNSPECIFIED,
        gender: this.convertPrismaGenderToProtoGender(p.gender),
      }));

      logService.info('Successfully handled listStylePickerProducts request', {
        metadata: {
          productsCount: products.length,
          totalCount,
        },
      });

      return {
        products: protoProducts,
        totalCount,
      };
    } catch (error) {
      logService.error('Error in listStylePickerProducts', {
        error,
        metadata: {
          errorType: error.constructor.name,
          code: error.code,
          details: error.details,
          path: error.path,
        },
      });
      throw error;
    }
  }

  private convertProtoGenderToPrismaGender(protoGender: Gender): gender {
    switch (protoGender) {
      case Gender.GENDER_MALE:
        return 'MALE';
      case Gender.GENDER_FEMALE:
        return 'FEMALE';
      case Gender.GENDER_UNISEX:
        return 'UNISEX';
      default:
        return 'UNISEX';
    }
  }

  private convertPrismaGenderToProtoGender(dbGender: gender | null | undefined): Gender {
    if (!dbGender) return Gender.GENDER_UNSPECIFIED;
    switch (dbGender) {
      case 'MALE':
        return Gender.GENDER_MALE;
      case 'FEMALE':
        return Gender.GENDER_FEMALE;
      case 'UNISEX':
        return Gender.GENDER_UNISEX;
      default:
        return Gender.GENDER_UNSPECIFIED;
    }
  }
}
