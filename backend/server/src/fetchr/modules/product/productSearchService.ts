import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { DEFAULT_SEARCH_METHOD, PineconeService } from '../../core/pinecone/pineconeService';
import {
  ProductCategory,
  ProductWithScore,
  SearchQuery,
  SearchMethod,
  ProductWithSearchQuery,
  PopulatedUserProductPreference,
  ProductWithScoreAndSearchQuery,
  ExploreRequest,
  PopulatedImagePreferenceItem,
} from '@fetchr/schema/base/base';
import { OpenAIModel } from '@fetchr/schema/core/core';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { ProductService } from './productService';
import { convertSearchQueryToProductMetadataFilter } from '../../core/pinecone/pineconeUtils';
import { convertDbCategoryToCategory } from '../../../shared/converters';
import { product_category as dbCategory } from '@prisma/client';
import { z } from 'zod';
import { GENERATE_CATEGORIES_FROM_QUERY_PROMPT } from '../explore/explorePrompts';
import { ProductPreferenceService } from '../explore/productPreferencesService';
import { ExploreRequestService } from '../explore/exploreRequestService';
import { Perf } from '../../core/performance/performance';

@injectable()
export class ProductSearchService extends BaseService {
  constructor(
    @inject(PineconeService) private pineconeService: PineconeService,
    @inject(ProductService) private productService: ProductService,
    @inject(OpenAIService) private openAIService: OpenAIService,
    @inject(ProductPreferenceService) private productPreferenceService: ProductPreferenceService,
    @inject(ExploreRequestService) private exploreRequestService: ExploreRequestService,
    @inject(Perf) private perfService: Perf,
  ) {
    super('ProductSearchService');
  }

  public async getProductCategoryFromQuery(
    query: string,
    imageUrls: string[],
  ): Promise<ProductCategory | undefined> {
    const categoriesList = Object.values(ProductCategory)
      .map(category => category.toString().replace('PRODUCT_CATEGORY_', ''))
      .join(', ');
    const prompt = GENERATE_CATEGORIES_FROM_QUERY_PROMPT.replace('{{query}}', query).replace(
      '{{categories_list}}',
      categoriesList,
    );

    const categoryStrings = await this.openAIService
      .submitChatCompletion(
        [
          {
            role: 'user',
            content: prompt,
          },
          ...this.openAIService.imageUrlsToOpenAIMessages(imageUrls),
        ],
        {
          model: OpenAIModel.GPT_4O,
          zodSchema: z.object({
            categories: z.array(z.string()),
          }),
        },
      )
      .then(result => result.categories);

    try {
      const categories: ProductCategory[] = categoryStrings
        .map(category => {
          try {
            if (!(category in dbCategory)) {
              this.logService.warn(`Invalid category: ${category}, skipping`);
              return undefined;
            }

            return convertDbCategoryToCategory(category as dbCategory);
          } catch (error) {
            this.logService.warn(`Invalid category: ${category}, skipping`, {
              error,
              metadata: { category },
            });
            return undefined;
          }
        })
        .filter(category => category !== undefined);

      return categories.length === 1 ? categories[0] : undefined;
    } catch (error) {
      this.logService.error(`Error parsing categories from response`, {
        error,
        metadata: { categoriesList },
      });
      return undefined;
    }
  }

  public async rerankProductsUsingQueryBio(
    products: ProductWithScore[],
    query: string,
    bio: string,
  ): Promise<ProductWithScore[]> {
    const prompt = `
    You are a fashion expert. You are given a list of products and a user's bio.
    You need to rerank the products based on the user's bio.

    The user's query is: ${query}

    The user's bio is: ${bio}

    The products are: ${products.map(product => `${product.product?.id}: ${product.product?.generatedDescription}`).join(', ')}
    `;

    const response = await this.openAIService.submitChatCompletion(prompt, {
      model: OpenAIModel.GPT_4O,
      zodSchema: z.object({
        rerankedProductIds: z.array(z.string()),
      }),
    });

    return response.rerankedProductIds
      .map(id => products.find(product => product.product?.id === id))
      .filter((product): product is ProductWithScoreAndSearchQuery => product !== undefined);
  }

  public async findProductsUsingStyleQueries(
    styleQueries: SearchQuery[],
    params: {
      exploreRequest: ExploreRequest;
      productPreferences: PopulatedUserProductPreference[];
      seenProductIds: string[];
      lastCohort: number;
      rerankSearchMethod: SearchMethod;
      requestId: string;
    },
  ): Promise<{
    rankedProducts: ProductWithScoreAndSearchQuery[];
    unrankedProducts: ProductWithSearchQuery[];
  }> {
    this.logService.info('Finding products using queries and product preferences', {
      metadata: { styleQueries, params },
    });
    const { exploreRequest, productPreferences, lastCohort, rerankSearchMethod, requestId } =
      params;

    const searchResults = await Promise.all(
      styleQueries.map(async styleQuery => {
        this.logService.info(`Searching with query: ${styleQuery.query}`);

        const results = await this.searchProducts(styleQuery);
        return results.map(productWithScore => ({
          ...productWithScore,
          query: styleQuery.query,
        }));
      }),
    );

    // Interleave results from different queries
    const productsWithQueries: ProductWithSearchQuery[] = [];
    const maxLength = Math.max(...searchResults.map(results => results.length));

    for (let i = 0; i < maxLength; i++) {
      for (let j = 0; j < searchResults.length; j++) {
        if (searchResults[j][i]) {
          productsWithQueries.push(searchResults[j][i]);
        }
      }
    }

    if (productsWithQueries.length === 0) {
      this.logService.warn('No search results found for any query.');
      return {
        rankedProducts: [],
        unrankedProducts: [],
      };
    }
    // First, filter out duplicates and kid products
    const uniqueProductsWithQueries =
      this.productService.filterDuplicateProducts(productsWithQueries);
    this.logService.info(`Total unique products found: ${uniqueProductsWithQueries.length}`);

    const nonKidProducts = uniqueProductsWithQueries.filter(
      product => !product.product?.isKidProduct,
    );

    // Group products by style query
    const productsByStyle = new Map<string, ProductWithSearchQuery[]>();
    for (const product of nonKidProducts) {
      if (!productsByStyle.has(product.query)) {
        productsByStyle.set(product.query, []);
      }
      productsByStyle.get(product.query)?.push(product);
    }

    // Get the top product from each style
    const topProductsPerStyle: ProductWithSearchQuery[] = [];
    productsByStyle.forEach((products, _) => {
      if (products.length > 0) {
        topProductsPerStyle.push(products[0]);
      }
    });

    this.logService.info(`Selected one product per style: ${topProductsPerStyle.length} products`);

    // Rerank the selected products
    const rerankedProducts = await this.productService.rerankProductsUsingPreferences(
      topProductsPerStyle,
      productPreferences,
      rerankSearchMethod,
    );

    // const finalProducts = shuffleArray(rerankedProducts.slice(0, numProducts ?? 10));

    await this.productPreferenceService.insertProductPreferences(
      rerankedProducts
        .filter(productWithQuery => productWithQuery.product)
        .map(productWithQuery => {
          if (!productWithQuery.product || !productWithQuery.product.id) {
            this.logService.error('Product is null or has no id', {
              metadata: { productWithQuery },
            });
            return null;
          }

          return {
            userId: exploreRequest.userId,
            productId: productWithQuery.product.id,
            requestId: requestId,
            cohort: lastCohort + 1,
            query: productWithQuery.query,
            preferenceType: undefined,
          };
        })
        .filter(preference => preference !== null),
    );

    return {
      rankedProducts: rerankedProducts,
      unrankedProducts: uniqueProductsWithQueries,
    };
  }

  public async findProductsUsingQueriesAndPreferences(
    searchQueries: SearchQuery[],
    params: {
      exploreRequest: ExploreRequest;
      productPreferences: PopulatedUserProductPreference[];
      productImagePreferences: PopulatedImagePreferenceItem[];
      seenProductIds: string[];
      lastCohort: number;
      rerankSearchMethod: SearchMethod;
      requestId: string;
    },
  ): Promise<{
    rankedProducts: ProductWithScoreAndSearchQuery[];
    unrankedProducts: ProductWithSearchQuery[];
  }> {
    return this.perfService.track(
      'ProductSearchService.findProductsUsingQueriesAndPreferences',
      async () => {
        this.logService.info('Finding products using queries and product preferences', {
          metadata: { searchQueries, params },
        });
      const {
        exploreRequest,
        productPreferences,
        lastCohort,
        rerankSearchMethod,
        requestId,
        productImagePreferences,
      } = params;

      const searchResults = await Promise.all(
        searchQueries.map(async searchQuery => {
          this.logService.info(`Searching with query: ${searchQuery.query}`);

          const results = await this.searchProducts(searchQuery);
          return results.map(productWithScore => ({
            ...productWithScore,
            query: searchQuery.query,
          }));
        }),
      );

      // Interleave results from different queries
      const productsWithQueries: ProductWithSearchQuery[] = [];
      const maxLength = Math.max(...searchResults.map(results => results.length));

      for (let i = 0; i < maxLength; i++) {
        for (let j = 0; j < searchResults.length; j++) {
          if (searchResults[j][i]) {
            productsWithQueries.push(searchResults[j][i]);
          }
        }
      }

      if (productsWithQueries.length === 0) {
        this.logService.warn('No search results found for any query.');
        return {
          rankedProducts: [],
          unrankedProducts: [],
        };
      }

      const uniqueProductsWithQueries =
        this.productService.filterDuplicateProducts(productsWithQueries);
      this.logService.info(`Total unique products found: ${uniqueProductsWithQueries.length}`);

      const nonKidProducts = uniqueProductsWithQueries.filter(
        product => !product.product?.isKidProduct,
      );

      const rerankedProducts = await this.productService.rerankProductsUsingPreferences(
        nonKidProducts,
        productPreferences,
        rerankSearchMethod,
        undefined,
        undefined,
        productImagePreferences,
      );

      // const finalProducts = shuffleArray(rerankedProducts.slice(0, numProducts ?? 10));

      this.productPreferenceService.insertProductPreferences(
        rerankedProducts
          .filter(productWithQuery => productWithQuery.product)
          .map(productWithQuery => {
            if (!productWithQuery.product || !productWithQuery.product.id) {
              this.logService.error('Product is null or has no id', {
                metadata: { productWithQuery },
              });
              return null;
            }

            return {
              userId: exploreRequest.userId,
              productId: productWithQuery.product.id,
              requestId: requestId,
              cohort: lastCohort + 1,
              query: productWithQuery.query,
              preferenceType: undefined,
            };
          })
          .filter(preference => preference !== null),
      );

      return {
        rankedProducts: rerankedProducts,
        unrankedProducts: uniqueProductsWithQueries,
      };
      });
  }

  public async searchProducts(
    searchQuery: SearchQuery,
    targetUserId?: string,
    targetExploreRequestId?: string,
  ): Promise<ProductWithScore[]> {
    return this.perfService.track('ProductSearchService.searchProducts', async () => {
      const targetExploreRequest = targetExploreRequestId
        ? await this.exploreRequestService.getRequestOrFail(targetExploreRequestId)
        : undefined;

      const metadataFilter = convertSearchQueryToProductMetadataFilter(searchQuery);

      this.logService.info(`Final metadata filter: ${JSON.stringify(metadataFilter)}`);

      const searchMethod = searchQuery.searchMethod ?? DEFAULT_SEARCH_METHOD;

      const searchResults = await this.pineconeService.searchProducts(
        searchQuery.query,
        searchMethod,
        (searchQuery.topK || 10) * 5,
        metadataFilter,
      );

      this.logService.info(`Pinecone returned ${searchResults.length} results`);

      if (!searchResults.length) {
        this.logService.warn('No matches found in Pinecone results');
        return [];
      }

      const products = await this.productService.getProductsInParallel(
        searchResults.map(result => result.id),
        searchQuery.gender,
        undefined, // brandId is already filtered by Pinecone
        searchQuery.minPrice,
        searchQuery.maxPrice,
      );

      const productPreferences = targetExploreRequest
        ? await this.productPreferenceService.getProductPreferencesForRequest(targetExploreRequest)
        : [];

      const rerankedProducts = await this.productService.rerankProductsUsingPreferences(
        products.map(product => ({
          ...product,
          score: searchResults.find(result => result.id === product.id)?.score ?? 0,
        })),
        productPreferences,
        searchMethod,
      );

      const productsWithImages = this.productService.removeProductsWithoutImages(rerankedProducts);

      return productsWithImages.slice(0, searchQuery.topK || 10);
    });
  }
}
