import { injectable, inject } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { S3Service } from '../../core/aws/s3/s3Service';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { Gender, ProductCategory, ProductFit } from '@fetchr/schema/base/base';

const ProductSchema = z.object({
  title: z.string(),
  price: z.number(),
  originalPrice: z.number().optional(),
  description: z.string(),
  availableSizes: z.array(z.string()),
  productImageUrls: z
    .array(z.string())
    .describe(
      'The urls of the product images. Please extract readable urls (ie: do not include //s in the beginning). Only include urls of images. Include all images for the main product (And none for other products / other recommendations / other products on the page). Scroll down if you need to',
    ),
  isAvailable: z.boolean(),
  brandName: z.string().describe('The name of the brand'),
});

type ScrapedProduct = z.infer<typeof ProductSchema>;

// interface ParsedOpenAIResponse {
//   gender: Gender;
//   category: ProductCategory;
//   fit: ProductFit;
// }

@injectable()
export class ProductScraperService extends BaseService {
  constructor(
    @inject(S3Service) private s3Service: S3Service,
    @inject(OpenAIService) private openAIService: OpenAIService,
  ) {
    super('ProductScraperService');
  }

  private async extractProductAttributes(
    product: ScrapedProduct,
    s3ImageUrls: string[],
  ): Promise<{
    gender: Gender;
    category: ProductCategory;
    fit: ProductFit;
  }> {
    void product;
    void s3ImageUrls;
    //     const chatId = randomUUID();
    //     const chatHistory = new PersistedChatHistory(chatId);
    //     await chatHistory.init();

    //     // Add product images to the chat
    //     for (const imageUrl of s3ImageUrls) {
    //       const imageBuffer = await this.s3Service.getImageSafeOrFail(imageUrl);
    //       await chatHistory.addMessage({
    //         role: 'user',
    //         content: [
    //           {
    //             type: 'image',
    //             image: imageBuffer,
    //             caption: 'Product Image',
    //           },
    //         ],
    //       });
    //     }

    //     // Add product information and request
    //     await chatHistory.addMessage({
    //       role: 'user',
    //       content: `Based on the product images and information provided, determine the gender, category, and fit of this product. Use the exact enum values provided.

    // Product Title: ${product.title}
    // Description: ${product.description}
    // Brand: ${product.brandName}

    // Please analyze the information and return a structured response with gender, category, and fit.
    // If you're unsure about any attribute, use the UNSPECIFIED value.`,
    //     });

    //     const result = await this.openAIService.submitChatCompletion<{
    //       gender: string;
    //       category: string;
    //       fit: string;
    //     }>(await chatHistory.getOpenAiMessages(), {
    //       zodSchema: z.object({
    //         gender: z.enum(['UNISEX', 'MALE', 'FEMALE']),
    //         category: z.enum([
    //           'TOPS',
    //           'BOTTOMS',
    //           'ACCESSORIES',
    //           'SHOES',
    //           'DRESSES',
    //           'UNDERWEAR',
    //           'OTHER',
    //         ]),
    //         fit: z.enum([
    //           'SLIM',
    //           'REGULAR',
    //           'LOOSE',
    //           'RELAXED',
    //           'OVERSIZED',
    //           'ATHLETIC',
    //           'TAILORED',
    //           'BAGGY',
    //           'CROPPED',
    //         ]),
    //       }),
    //       temperature: 0,
    //     });

    // JUST RETURN PLACEHOLDER FOR NOW
    return {
      gender: Gender.GENDER_UNISEX,
      category: ProductCategory.PRODUCT_CATEGORY_OTHER,
      fit: ProductFit.PRODUCT_FIT_REGULAR,
    };
  }

  private async createStagehand(env: 'BROWSERBASE' | 'LOCAL'): Promise<Stagehand> {
    console.log('Creating new stagehand instance');
    const stagehand = new Stagehand({
      modelName: 'gpt-4o',
      env: env,
      apiKey: process.env.OPENAI_API_KEY,
    });
    await stagehand.init();
    console.log('Stagehand instance created');
    return stagehand;
  }

  async scrapeProduct(
    url: string,
    env: 'BROWSERBASE' | 'LOCAL',
  ): Promise<
    ScrapedProduct & {
      gender: Gender;
      category: ProductCategory;
      fit: ProductFit;
      s3ImageUrls: string[];
    }
  > {
    const stagehand = await this.createStagehand(env);

    try {
      // Navigate to the product page
      await stagehand.page.goto(url);

      // Wait for network activity to settle
      await stagehand.page
        .waitForLoadState('networkidle', { timeout: 20_000 })
        .catch((err: Error) => {
          this.logService.error('[Error] Network timeout', { error: err });
        });

      const pageUrl = await stagehand.page.url();

      await stagehand.page.act({
        action: 'Close any popups etc if they exist. DO NOT CHANGE THE PAGE',
      });

      const newPageUrl = await stagehand.page.url();
      if (newPageUrl !== pageUrl) {
        this.logService.error('Page changed after closing popups', {
          metadata: { url, pageUrl, newPageUrl },
        });

        await stagehand.page.goto(url);

        await stagehand.page
          .waitForLoadState('networkidle', { timeout: 10_000 })
          .catch((err: Error) => {
            this.logService.error('[Error] Network timeout', { error: err });
          });
      }

      // Extract product information using the schema
      const result = await stagehand.page.extract({
        instruction:
          'Extract the product information from the page. Make sure you capture all product images for the main product!',
        schema: ProductSchema,
        useTextExtract: false,
      });

      this.logService.info('Successfully scraped product', {
        metadata: { url, product: result },
      });

      // Upload images to S3
      const s3ImageUrls = await this.s3Service.uploadImagesToS3(result.productImageUrls);

      // Extract product attributes using OpenAI with images
      const attributes = await this.extractProductAttributes(result, s3ImageUrls);

      return {
        ...result,
        s3ImageUrls,
        ...attributes,
      };
    } catch (error) {
      this.logService.error('Error scraping product', {
        metadata: { url },
        error,
      });
      throw error;
    } finally {
      await stagehand.close();
    }
  }

  async scrapeMultipleProducts(
    urls: string[],
    env: 'BROWSERBASE' | 'LOCAL',
  ): Promise<
    Array<
      ScrapedProduct & {
        gender: Gender;
        category: ProductCategory;
        fit: ProductFit;
        s3ImageUrls: string[];
      }
    >
  > {
    const results = await Promise.all(
      urls.map(async url => {
        try {
          return await this.scrapeProduct(url, env);
        } catch (error) {
          this.logService.error('Error scraping product in batch', {
            metadata: { url },
            error,
          });
          return null;
        }
      }),
    );

    return results.filter(
      (
        result:
          | (ScrapedProduct & {
              gender: Gender;
              category: ProductCategory;
              fit: ProductFit;
              s3ImageUrls: string[];
            })
          | null,
      ): result is ScrapedProduct & {
        gender: Gender;
        category: ProductCategory;
        fit: ProductFit;
        s3ImageUrls: string[];
      } => result !== null,
    );
  }
}
