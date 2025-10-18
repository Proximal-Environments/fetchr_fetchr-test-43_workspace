import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { supabaseDb } from '../../base/database/supabaseDb';
import {
  PreferenceType,
  ImagePreferenceItem,
  PopulatedImagePreferenceItem,
} from '@fetchr/schema/base/base';
import {
  convertDbPreferenceTypeToPreferenceType,
  convertPreferenceTypeToDbPreferenceType,
} from '../../base/types/utils';
import { z } from 'zod';
import { RedisService } from '../../core/redis/redisService';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { PinterestService } from '../pinterest/pinterestService';
import { TemporaryChatHistory } from '../../core/chat/chatHistory';
import { ProductImageService } from '../../core/productImage/productImageService';

@injectable()
export class ImagePreferenceService extends BaseService {
  constructor(
    @inject(RedisService) private redisService: RedisService,
    @inject(OpenAIService) private openAIService: OpenAIService,
    @inject(PinterestService) private pinterestService: PinterestService,
    @inject(ProductImageService) private productImageService: ProductImageService,
  ) {
    super('ImagePreferenceService');
  }

  async insertImagePreferences(
    preferenceRecords: ImagePreferenceItem[],
    userId: string,
    requestId: string,
  ): Promise<void> {
    try {
      this.logService.debug(
        `Inserting ${preferenceRecords.length} image preferences into the db for user ${userId} and request ${requestId}`,
        {
          metadata: { preferenceRecords },
        },
      );

      await supabaseDb.image_preferences.createMany({
        data: preferenceRecords.map(record => ({
          user_id: userId,
          image_url: record.imageUrl,
          explore_request_id: requestId,
          preference_type: record.preferenceType
            ? convertPreferenceTypeToDbPreferenceType(record.preferenceType)
            : null,
          comments: null,
        })),
      });
    } catch (error) {
      this.logService.error(`Error inserting image preferences: ${error}`, { error });
      throw error;
    }
  }

  async updateImagePreferences(
    preferenceRecords: ImagePreferenceItem[],
    userId: string,
    requestId: string,
  ): Promise<void> {
    try {
      for (const record of preferenceRecords) {
        await supabaseDb.image_preferences.updateMany({
          where: {
            user_id: userId,
            explore_request_id: requestId,
            image_url: record.imageUrl,
          },
          data: {
            preference_type: record.preferenceType
              ? convertPreferenceTypeToDbPreferenceType(record.preferenceType)
              : undefined,
          },
        });
      }
    } catch (error) {
      this.logService.error(`Error updating image preferences: ${error}`);
      throw error;
    }
  }

  async extractStyleFromImage(image: Buffer, userBio?: string, query?: string): Promise<string> {
    try {
      const chatHistory = new TemporaryChatHistory([
        {
          role: 'system',
          content: `
You are a professional fashion stylist expert at analyzing clothing styles. Your task is to extract and describe the key style elements of fashion items from images with precise, industry-standard terminology.

Focus on these key aspects:
1. Core style category (e.g., minimalist, bohemian, streetwear, etc.)
2. Silhouette and fit
3. Materials and textures
4. Detailed description of colors and patterns
5. Distinctive design elements
6. Current fashion trends it aligns with

Format your response exactly as:

Product Title with Style: {Concise 5-12 word product / style name - should include both the product and the style}
Style Description: {Detailed 30-50 word description focusing on distinguishing features}
Product Description: {Detailed 50-70 word description of the specific product (searched by user) shown in the image}

Be extremely specific and use professional fashion terminology. Avoid generic descriptions. Your analysis should help identify similar items in this style category.`,
        },
      ]);

      if (userBio || query) {
        chatHistory.addMessage({
          role: 'user',
          content: `${userBio ? `My bio is: ${userBio}` : ''}\n${
            query ? `I'm looking for this item: ${query}` : ''
          }`,
        });
      }

      chatHistory.addMessage({
        role: 'user',
        content: [
          {
            type: 'image',
            image: image,
            caption: 'I like this style',
          },
        ],
      });

      const { productTitleWithStyle, styleDescription, productDescription } =
        await this.openAIService.submitChatCompletion(await chatHistory.getOpenAiMessages(), {
          zodSchema: z.object({
            productTitleWithStyle: z.string(),
            styleDescription: z.string(),
            productDescription: z.string(),
          }),
        });

      // Cache the result in Redis with 24h expiration
      const fullStyle = `# ${productTitleWithStyle}\nStyle: ${styleDescription}\nProduct: ${productDescription}`;

      return fullStyle;
    } catch (error) {
      this.logService.error(`Error extracting style from image: ${error}`, { error });
      throw error;
    }
  }

  async batchUpdateImagePreferencesFromSwipes(
    exploreRequestId: string,
    userId: string,
    preferences: {
      imageUrl: string;
      preferenceType?: PreferenceType;
      comments?: string;
    }[],
  ): Promise<void> {
    await Promise.all(
      preferences.map(pref =>
        this.updateImagePreferenceFromSwipe({
          exploreRequestId,
          userId,
          imageUrl: pref.imageUrl,
          preferenceType: pref.preferenceType,
          comments: pref.comments,
        }),
      ),
    );
  }

  async updateImagePreferenceFromSwipe({
    exploreRequestId,
    userId,
    imageUrl,
    preferenceType,
    comments,
  }: {
    exploreRequestId: string;
    userId: string;
    imageUrl: string;
    preferenceType?: PreferenceType;
    comments?: string;
  }): Promise<void> {
    try {
      this.logService.info('Updating image preference', {
        metadata: {
          requestId: exploreRequestId,
          userId,
          imageUrl,
          preferenceType: preferenceType
            ? convertPreferenceTypeToDbPreferenceType(preferenceType)
            : undefined,
          comments,
        },
      });

      // Prepare the preference data
      const preferenceData = {
        preference_type: preferenceType
          ? convertPreferenceTypeToDbPreferenceType(preferenceType)
          : null,
        comments: comments || null,
      };

      // Use upsert with a proper unique identifier
      await supabaseDb.image_preferences.upsert({
        where: {
          // Use findFirst to get the ID if it exists
          id:
            (
              await supabaseDb.image_preferences.findFirst({
                where: {
                  explore_request_id: exploreRequestId,
                  user_id: userId,
                  image_url: imageUrl,
                },
                select: { id: true },
              })
            )?.id || BigInt(-1), // Use a dummy ID that won't exist if no record found
        },
        update: preferenceData,
        create: {
          explore_request_id: exploreRequestId,
          user_id: userId,
          image_url: imageUrl,
          ...preferenceData,
        },
      });
    } catch (error) {
      this.logService.error(`Error updating image preference: ${error}`);
      throw error;
    }
  }

  async getNumImagePreferencesForUser(userId: string): Promise<number> {
    const preferences = await supabaseDb.image_preferences.count({
      where: {
        user_id: userId,
      },
    });

    return preferences;
  }

  async getImagePreferencesForUser(userId: string): Promise<ImagePreferenceItem[]> {
    const preferences = await supabaseDb.image_preferences.findMany({
      where: {
        user_id: userId,
      },
      take: 1000,
    });

    return preferences.map(preference => ({
      imageUrl: preference.image_url,
      preferenceType:
        (preference.preference_type
          ? convertDbPreferenceTypeToPreferenceType(
              preference.preference_type ?? PreferenceType.UNSPECIFIED,
            )
          : PreferenceType.UNSPECIFIED) ?? PreferenceType.UNSPECIFIED,
    }));
  }

  async getImagePreferencesForRequest(
    exploreRequestId: string,
    shuffle: boolean = false,
  ): Promise<PopulatedImagePreferenceItem[]> {
    try {
      this.logService.info('Getting image preferences for request', {
        metadata: { exploreRequestId },
      });

      const preferencesDb = await supabaseDb.image_preferences.findMany({
        where: {
          explore_request_id: exploreRequestId,
        },
      });

      this.logService.info(
        `Pulled ${preferencesDb.length} image preferences from db for request ${exploreRequestId}`,
        {
          metadata: { preferencesDb },
        },
      );

      let preferences: PopulatedImagePreferenceItem[] = await Promise.all(
        preferencesDb.map(async preference => {
          const image = await this.productImageService.getImageAndWaitForEmbeddingIfProcessing(
            preference.image_url,
          );

          return {
            imagePreferenceItem: {
              imageUrl: preference.image_url,
              preferenceType:
                (preference.preference_type
                  ? convertDbPreferenceTypeToPreferenceType(preference.preference_type)
                  : PreferenceType.UNSPECIFIED) ?? PreferenceType.UNSPECIFIED,
            },
            embeddings: image?.embeddings ?? [],
            style: image?.style,
          };
        }),
      );

      if (shuffle) {
        preferences = this.shuffleArray(preferences);
      }

      return preferences;
    } catch (error) {
      this.logService.error(
        `Error getting image preferences for request ${exploreRequestId}: ${error}`,
        {
          error,
          metadata: { exploreRequestId },
        },
      );
      return [];
    }
  }

  async deleteImagePreferencesForRequest(exploreRequestId: string): Promise<void> {
    try {
      await supabaseDb.image_preferences.deleteMany({
        where: {
          explore_request_id: exploreRequestId,
        },
      });
    } catch (error) {
      this.logService.error(
        `Error deleting image preferences for request ${exploreRequestId}: ${error}`,
      );
      throw error;
    }
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
