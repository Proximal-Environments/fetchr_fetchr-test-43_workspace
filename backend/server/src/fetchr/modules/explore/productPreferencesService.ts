import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { supabaseDb } from '../../base/database/supabaseDb';
import { ProductService } from '../product/productService';
import {
  PopulatedUserProductPreference,
  UserProductPreference,
  Product,
  PreferenceType,
  ProductPreferenceItem,
  PopulatedProductPreferenceItem,
  ExploreRequest,
} from '@fetchr/schema/base/base';
import {
  convertDbPreferenceTypeToPreferenceType,
  convertPreferenceTypeToDbPreferenceType,
  convertProductPreferenceToDbProductPreference,
} from '../../base/types/utils';
import { Perf } from '../../core/performance/performance';

@injectable()
export class ProductPreferenceService extends BaseService {
  constructor(
    @inject(ProductService) private readonly productService: ProductService,
    @inject(Perf) private readonly perfService: Perf,
  ) {
    super('ProductPreferenceService');
  }

  async populateProductPreference(
    preferenceItem: ProductPreferenceItem,
    _requestId: string,
  ): Promise<PopulatedProductPreferenceItem> {
    const product = await this.productService.getProduct(preferenceItem.itemId);
    return {
      preferenceItem,
      product: product ?? undefined,
    };
  }

  async insertProductPreferences(
    preferenceRecords: Omit<UserProductPreference, 'id'>[],
  ): Promise<void> {
    const perfHandle = this.perfService.start('ProductPreferenceService.insertProductPreferences');
    try {
      this.logService.info('Inserting product preferences', {
        metadata: { preferenceRecords },
      });
      const dbProducts = preferenceRecords.map(convertProductPreferenceToDbProductPreference);
      this.logService.debug(`Inserting ${dbProducts.length} product preferences`, {
        metadata: { dbProducts },
      });
      await supabaseDb.product_preferences.createMany({
        data: dbProducts,
      });
    } catch (error) {
      this.logService.error(`Error inserting product preferences: ${error}`, { error });
      throw error;
    } finally {
      this.perfService.end(perfHandle);
    }
  }

  async updateProductPreferences(preferenceRecords: UserProductPreference[]): Promise<void> {
    try {
      for (const record of preferenceRecords) {
        await supabaseDb.product_preferences.updateMany({
          where: {
            request_id: record.requestId,
            product_id: record.productId,
            cohort: record.cohort,
          },
          data: {
            preference_type: record.preferenceType
              ? convertPreferenceTypeToDbPreferenceType(record.preferenceType)
              : undefined,
            comments: record.comments,
          },
        });
      }
    } catch (error) {
      this.logService.error(`Error updating product preferences: ${error}`);
      throw error;
    }
  }

  async batchUpdateProductPreferencesFromSwipes(
    requestId: string,
    preferences: {
      productId: string;
      preferenceType?: PreferenceType;
      comments?: string;
    }[],
  ): Promise<void> {
    await Promise.all(
      preferences.map(pref =>
        this.updateProductPreferenceFromSwipe({
          requestId,
          cohort: 1,
          productId: pref.productId,
          preferenceType: pref.preferenceType,
          comments: pref.comments,
        }),
      ),
    );
  }

  async updateProductPreferenceFromSwipe({
    requestId,
    cohort,
    productId,
    preferenceType,
    comments,
  }: {
    requestId: string;
    cohort: number;
    productId: string;
    preferenceType?: PreferenceType;
    comments?: string;
  }): Promise<void> {
    try {
      this.logService.info('Updating product preference', {
        metadata: {
          requestId,
          cohort,
          productId,
          preferenceType: preferenceType
            ? convertPreferenceTypeToDbPreferenceType(preferenceType)
            : undefined,
          comments,
        },
      });
      await supabaseDb.product_preferences.updateMany({
        where: {
          request_id: requestId,
          product_id: productId,
        },
        data: {
          preference_type: preferenceType
            ? convertPreferenceTypeToDbPreferenceType(preferenceType)
            : undefined,
          comments: comments,
        },
      });
    } catch (error) {
      this.logService.error(`Error updating product preference: ${error}`);
      throw error;
    }
  }

  private async populateProductDetails(
    preferences: UserProductPreference[],
  ): Promise<PopulatedUserProductPreference[]> {
    this.logService.debug(`Populating product details for ${preferences.length} preferences`);

    const productIds = preferences.map(pref => pref.productId);
    const products = await this.productService.getProductsInParallel(productIds);

    const productMap = new Map<string, Product>();
    products.forEach(product => productMap.set(product.id, product));

    // Log which products were not found
    const foundProductIds = new Set(products.map(p => p.id));
    const missingProductIds = productIds.filter(id => !foundProductIds.has(id));
    if (missingProductIds.length > 0) {
      this.logService.warn(
        `Failed to find ${missingProductIds.length} products: ${missingProductIds.join(', ')}`,
      );
    }

    const populatedPreferences: PopulatedUserProductPreference[] = preferences
      .filter(pref => productMap.has(pref.productId))
      .map(pref => ({
        preference: pref,
        productDetails: productMap.get(pref.productId),
      }));

    this.logService.debug(`Successfully populated ${populatedPreferences.length} preferences`);
    return populatedPreferences;
  }

  async getNumProductPreferencesForUser(userId: string): Promise<number> {
    const preferences = await supabaseDb.product_preferences.count({
      where: {
        user_id: userId,
      },
    });

    return preferences;
  }

  async getProductPreferencesForUser(userId: string): Promise<PopulatedUserProductPreference[]> {
    const preferences = await supabaseDb.product_preferences.findMany({
      where: {
        user_id: userId,
      },
      take: 1000,
    });

    const userProductPreferences: UserProductPreference[] = preferences.map(preference => ({
      id: preference.id,
      userId: preference.user_id,
      productId: preference.product_id,
      requestId: preference.request_id,
      cohort: Number(preference.cohort),
      preferenceType: preference.preference_type
        ? convertDbPreferenceTypeToPreferenceType(preference.preference_type)
        : undefined,
      comments: preference.comments ?? undefined,
    }));

    return this.populateProductDetails(userProductPreferences);
  }

  async getProductPreferencesForRequest(
    exploreRequest: ExploreRequest,
    shuffle: boolean = false,
  ): Promise<PopulatedUserProductPreference[]> {
    try {
      this.logService.info('Getting product preferences for request', {
        metadata: { exploreRequest },
      });

      const chatHistory = exploreRequest.messages ?? [];
      if (!chatHistory.length) {
        this.logService.warn('No chat history found for request', {
          metadata: { exploreRequest },
        });
        return [];
      }

      const preferences: UserProductPreference[] = [];
      chatHistory.forEach(message => {
        if (message.message?.$case === 'productPreferencesRequestMessage') {
          const productsWithQueries = message.message.productPreferencesRequestMessage.products;
          productsWithQueries.forEach(productWithQuery => {
            if (!productWithQuery.product) {
              this.logService.warn('No product found for product id', {
                metadata: { productId: productWithQuery },
              });
              return;
            }

            // Skip if we already have a preference for this request/product/cohort/user combination
            const existingPreference = preferences.find(
              p =>
                p.requestId === exploreRequest.id &&
                p.productId === productWithQuery.product?.id &&
                p.cohort === 1 &&
                p.userId === exploreRequest.userId,
            );

            if (existingPreference) {
              return;
            }

            preferences.push({
              id: crypto.randomUUID(),
              requestId: exploreRequest.id,
              productId: productWithQuery.product.id,
              cohort: 1,
              userId: exploreRequest.userId,
              preferenceType: undefined,
              comments: undefined,
            });
          });
        }
      });

      chatHistory.forEach(message => {
        if (message.message?.$case === 'productPreferencesResponseMessage') {
          const responsePreferences = message.message.productPreferencesResponseMessage.preferences;
          responsePreferences.forEach(preference => {
            const existingPreference = preferences.find(p => p.productId === preference.itemId);
            if (existingPreference) {
              existingPreference.preferenceType = preference.preferenceType;
              existingPreference.comments = preference.comments;
            }
          });
        }
      });

      const likeCount = preferences.filter(
        pref => pref.preferenceType === PreferenceType.LIKE,
      ).length;
      const dislikeCount = preferences.filter(
        pref => pref.preferenceType === PreferenceType.DISLIKE,
      ).length;
      const superlikeCount = preferences.filter(
        pref => pref.preferenceType === PreferenceType.SUPERLIKE,
      ).length;
      const maybeCount = preferences.filter(
        pref => pref.preferenceType === PreferenceType.MAYBE,
      ).length;
      this.logService.info(
        `Retrieved ${preferences.length} preferences for request ${exploreRequest.id}. Breakdown: ${likeCount} likes, ${dislikeCount} dislikes, ${superlikeCount} superlikes, ${maybeCount} maybes`,
      );

      if (!preferences.length) return [];

      // Group by product_id, keeping latest
      const preferenceMap = new Map<string, UserProductPreference>();
      preferences.forEach(pref => {
        const key = pref.productId;
        if (
          (pref.preferenceType === PreferenceType.UNRECOGNIZED ||
            pref.preferenceType === PreferenceType.UNSPECIFIED) &&
          preferenceMap.has(key)
        ) {
          return;
        }

        preferenceMap.set(key, pref);
      });

      let populatedPreferences = await this.populateProductDetails(
        Array.from(preferenceMap.values()),
      );

      if (populatedPreferences.length !== preferences.length) {
        this.logService.warn(
          `Number of populated preferences (${populatedPreferences.length}) does not match number of preferences (${preferences.length})`,
        );
      }

      this.logService.info(
        `Successfully populated ${populatedPreferences.length} preferences for request ${exploreRequest.id}`,
      );

      if (shuffle) {
        populatedPreferences = this.shuffleArray(populatedPreferences);
      }

      return populatedPreferences;
    } catch (error) {
      this.logService.error(
        `Error getting product preferences for request ${exploreRequest.id}: ${error}`,
        {
          error,
          metadata: { exploreRequest },
        },
      );
      return [];
    }
  }

  async deleteProductPreferencesForRequest(
    exploreRequest: ExploreRequest,
    cohort: number,
  ): Promise<void> {
    try {
      await supabaseDb.product_preferences.deleteMany({
        where: {
          request_id: exploreRequest.id,
          cohort: cohort,
        },
      });
    } catch (error) {
      this.logService.error(
        `Error deleting product preferences for request ${exploreRequest.id}: ${error}`,
      );
      throw error;
    }
  }

  async getProductPreferences(
    productPreferences: ProductPreferenceItem[],
  ): Promise<PopulatedProductPreferenceItem[]> {
    const products = await this.productService.getProductsInParallel(
      productPreferences.map(pref => pref.itemId),
    );
    const productMap = new Map<string, Product>();
    products.forEach(product => productMap.set(product.id, product));
    const preferences = productPreferences.map(pref => ({
      preferenceItem: pref,
      product: productMap.get(pref.itemId),
    }));
    return preferences;
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
