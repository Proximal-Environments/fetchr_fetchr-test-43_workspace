import { injectable, inject } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { ExploreRequestService } from '../explore/exploreRequestService';
import { ProductService } from '../product/productService';
import { EmailService } from '../../core/email/emailService';
import { NotificationsService } from '../notifications/notificationsService';
import { ProductSearchService } from '../product/productSearchService';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { RedisService } from '../../core/redis/redisService';
import { OrderManagementService } from '../orderManagement/orderManagementsService';
import { CommentingService } from '../commenting/commentingService';
import {
  RateProductForPurchaseRequest,
  RateProductForPurchaseResponse,
} from '@fetchr/schema/automation/automation';
import { PersistedChatHistory, TemporaryChatHistory } from '../../core/chat/chatHistory';
import { OpenAIModel } from '@fetchr/schema/core/core';
import { ThreadType } from '@fetchr/schema/base/comments';
import { z } from 'zod';
import { Product } from '@fetchr/schema/base/base';

type BasicProduct = {
  title: string;
  options: string[];
  requirements?: string[];
};

type Outfit = {
  title: string;
  products: BasicProduct[];
  requirements?: string[];
};

type RequirementsOutput = {
  chat_id: string;
  chat_url: string;
  outfits: Outfit[];
  products: BasicProduct[];
};

// Types for scoring
type RequirementScore = {
  requirement_description: string;
  suitability_score: number;
  reason: string;
};

type OverallScore = {
  score: number;
  reason: string;
};

type ProductScoringResult = {
  product_id: string;
  product_name: string;
  requirements_scores: RequirementScore[];
  overall_suitability_score: OverallScore;
};

@injectable()
export class OrderAutomationService extends BaseService {
  constructor(
    @inject(ProductService) private productService: ProductService,
    @inject(EmailService) private emailService: EmailService,
    @inject(NotificationsService) private notificationsService: NotificationsService,
    @inject(ExploreRequestService) private exploreRequestService: ExploreRequestService,
    @inject(ProductSearchService) private productSearchService: ProductSearchService,
    @inject(OpenAIService) private openaiService: OpenAIService,
    @inject(RedisService) private redisService: RedisService,
    @inject(OrderManagementService) private orderManagementService: OrderManagementService,
    @inject(CommentingService) private commentingService: CommentingService,
  ) {
    super('OrderManagementService');
  }

  async scoreProductForRequirements(
    productId: string,
    requirements: string[],
  ): Promise<ProductScoringResult> {
    // Get product details
    const product = await this.productService.getProductOrFail(productId);

    // Create a new chat history for scoring
    const scoringChatHistory = new TemporaryChatHistory();

    // Add the initial context with requirements
    scoringChatHistory.addMessage({
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'The user is looking for apparel that meets the following requirements: ' +
            requirements.join(', '),
        },
      ],
    });

    let productOriginalPrice =
      product.originalPrice && product.originalPrice !== product.price
        ? `Original Price: ${product.originalPrice}`
        : '';
    let productPrice =
      product.originalPrice && product.originalPrice !== product.price
        ? `Price: ${product.price}`
        : '';

    if (productOriginalPrice && productPrice && productOriginalPrice > productPrice) {
      [productOriginalPrice, productPrice] = [productPrice, productOriginalPrice];
    }

    // Add the product information for evaluation
    scoringChatHistory.addMessage({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Does the following item meet the user's request?
  Product Name: ${product.name}
  Product Description: ${product.description}
  Price: ${productPrice}${productOriginalPrice ? ` - (Original: ${productOriginalPrice})` : ''}
  Product Brand: ${product.brandName}${product.subBrandName ? ` (${product.subBrandName})` : ''}
  Product URL: ${product.url}`,
        },
        ...(product.compressedImageUrls?.map(url => ({
          type: 'image' as const,
          imageUrl: url,
        })) ?? []),
      ],
    });

    // Get scoring from OpenAI
    const scoringMessages = await scoringChatHistory.getOpenAiMessages();
    const scoringResponse = await this.openaiService.submitChatCompletion(scoringMessages, {
      model: OpenAIModel.O3,
      zodSchema: z.object({
        requirements_scores: z.array(
          z.object({
            requirement_description: z
              .string()
              .describe('The requirement that the product either meets or not'),
            suitability_score: z
              .number()
              .describe(
                "A score of how suitable the product is for the user's request ranging from 0 to 100",
              ),
            reason: z.string().describe('A reason for the score'),
          }),
        ),
        overall_suitability_score: z.object({
          score: z
            .number()
            .describe(
              "An overall score of how suitable the product is for the user's request ranging from 0 to 100",
            ),
          reason: z.string().describe('A reason for the score'),
        }),
      }),
    });

    return {
      product_id: productId,
      product_name: product.name,
      requirements_scores: scoringResponse.requirements_scores,
      overall_suitability_score: scoringResponse.overall_suitability_score,
    };
  }

  async getRequirementsForChat(
    chatId: string,
    orderId?: string,
  ): Promise<RequirementsOutput | null> {
    const chatHistory = await PersistedChatHistory.getExistingChatHistory(chatId);

    if (!chatHistory) {
      console.log(`Chat history not found for chat ID: ${chatId}`);
      return null;
    }

    const clonedChatHistory = await chatHistory.cloneIntoTemporaryChatHistory();

    const order = orderId ? await this.orderManagementService.getEnrichedOrder(orderId) : undefined;

    if (order && order.order?.note) {
      clonedChatHistory.addMessage({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Here is my note on the order: ${order.order?.note}`,
          },
        ],
      });
    }

    // Get initial list of items
    clonedChatHistory.addMessage({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `List all the products and outfits that I'm looking for.
  Write them down in bullet points.
  Include all variations and subcategories of the same item in a single bullet point (e.g. if they want a jacket, different styles like bomber, denim, etc just become one option).
  Only include the specific items / outfits I want to purchase, nothing else.
  
  This is going to be sent to a stylist alongside this chat to fulfill my purchase. For each outfit and product category you list, we will select one option to purchase (e.g. if you list "jacket" with options like bomber, denim, etc., we will choose one style to buy).
  
  Use singular nouns for each outfit and product and each option.
  
  If including products in outfits, do not list them in the products list.
  
  Keep the titles short and concise.
  
  Do not include existing items that I own and do not include items from my bio. Only include the product requests included in the chat by the user. Either include items in products or outfits, not both.
  
  Do not include shoes and accessories unless the user explicitly mentions them in the chat.
  
  Only include concerns the user mentioned in the chat, the order note or the user's bio.`,
        },
      ],
    });

    try {
      const response = await this.openaiService.submitChatCompletion(
        await clonedChatHistory.getOpenAiMessages(),
        {
          model: OpenAIModel.O3,
          zodSchema: z.object({
            outfits: z.array(
              z.object({
                title: z.string(),
                products: z.array(
                  z.object({
                    title: z.string(),
                    options: z.array(z.string()),
                  }),
                ),
              }),
            ),
            products: z.array(
              z.object({
                title: z.string(),
                options: z.array(z.string()),
              }),
            ),
          }),
        },
      );

      await clonedChatHistory.addMessage({
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      });

      const requirementsPromises = [
        ...response.outfits.map(async outfit => {
          const reqChatHistory = await clonedChatHistory.cloneIntoTemporaryChatHistory();
          reqChatHistory.addMessage({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `What are the specific requirements for this outfit: "${outfit.title}"?
  
  Some example categories for the example requirements:
  - Occasion/use case
  - Style preferences
  - Color preferences
  - Material preferences
  - Fit preferences
  - Budget constraints
  - Brand preferences
  - Any other specific requirements
  
  Rules:
  - Only include requirements that were explicitly mentioned in the chat. Do not make assumptions or add requirements that weren't directly stated.
  - Be specific and detailed in the requirements, including exact terms used by the user. Also only include requirements for this specific outfit, not for other products.
  - Make sure the requirements applies to this specific outfit, not for other outfits / items.
  - Only include requirements that were explicitly mentioned in the chat. Do not make assumptions or add requirements that weren't directly stated.
  - Be specific and detailed in the requirements, including exact terms used by the user. Also only include requirements for this specific outfit, not for other products.`,
              },
            ],
          });

          const outfitRequirements = await this.openaiService.submitChatCompletion(
            await reqChatHistory.getOpenAiMessages(),
            {
              model: OpenAIModel.O3,
              zodSchema: z.object({
                requirements: z.array(z.string()),
              }),
            },
          );

          return {
            title: outfit.title,
            products: outfit.products,
            requirements: outfitRequirements.requirements,
          };
        }),
        ...response.products.map(async product => {
          const reqChatHistory = await clonedChatHistory.cloneIntoTemporaryChatHistory();
          reqChatHistory.addMessage({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `What are the specific requirements for this product: "${product.title}"?
  
  Extract requirements in these categories:
  - Style preferences
  - Color preferences
  - Material preferences
  - Fit preferences
  - Budget constraints (if mentioned)
  - Brand preferences (if mentioned)
  - Any other specific requirements
  
  Only include requirements that were explicitly mentioned in the chat. Do not make assumptions or add requirements that weren't directly stated.
  Be specific and detailed in the requirements, including exact terms used by the user. Also only include requirements for this specific product, not for other products.

  Include all requirements mentioned in the chat.
  
  Make sure the requirements applies to this specific product, not for other products.`,
              },
            ],
          });

          const productRequirements = await this.openaiService.submitChatCompletion(
            await reqChatHistory.getOpenAiMessages(),
            {
              model: OpenAIModel.O3,
              zodSchema: z.object({
                requirements: z.array(z.string()),
              }),
            },
          );

          return {
            title: product.title,
            options: product.options,
            requirements: productRequirements.requirements,
          };
        }),
      ];

      const requirementsResults = await Promise.all(requirementsPromises);
      const outfitsWithRequirements = requirementsResults.filter(r => 'products' in r) as Outfit[];
      const productsWithRequirements = requirementsResults.filter(
        r => !('products' in r),
      ) as BasicProduct[];

      return {
        chat_id: chatId,
        chat_url: `https://admin.fetchr.so/chats/${chatId}`,
        outfits: outfitsWithRequirements,
        products: productsWithRequirements,
      };
    } catch (error) {
      console.error(`Error processing chat ${chatId}:`, error);
      throw error;
    }
  }

  async scoreProductsForChat(
    chatId: string,
    orderId?: string,
    products: { productId: string; size?: string }[] = [],
  ): Promise<(ProductScoringResult | null)[]> {
    // First get the requirements for the chat
    const requirementsData = await this.getRequirementsForChat(chatId, orderId);
    if (!requirementsData) {
      throw new Error(`No requirements found for chat ${chatId}`);
    }
    // Score each product
    const scoringPromises = products.map(async pr => {
      try {
        // Get product details
        const product = await this.productService.getProductOrFail(pr.productId);

        // Create a message to ask OpenAI which category this product belongs to
        const matchingChatHistory = new TemporaryChatHistory();
        matchingChatHistory.addMessage({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Here are the categories of items a user is looking for:

Individual Products:
${requirementsData.products.map(p => `- ${p.title} (options: ${p.options.join(', ')})`).join('\n')}

Outfits:
${requirementsData.outfits
  .map(
    o =>
      `- ${o.title}:\n${o.products
        .map(p => `  - ${p.title} (options: ${p.options.join(', ')})`)
        .join('\n')}`,
  )
  .join('\n')}

Which category does this product best match?
Product Name: ${product.name}
Product Description: ${product.description}
Brand: ${product.brandName}${product.subBrandName ? ` (${product.subBrandName})` : ''}
Size: ${pr.size}

Return ONLY the exact category title that matches best. If it's part of an outfit, return "outfit:OUTFIT_TITLE:PRODUCT_TITLE". If it's an individual product, just return the product title. If no match is found, return "NO_MATCH".`,
            },
          ],
        });

        const matchResponse = await this.openaiService.submitChatCompletion(
          await matchingChatHistory.getOpenAiMessages(),
          {
            model: OpenAIModel.GPT_4O,
            zodSchema: z.object({
              category: z.string(),
            }),
          },
        );

        let matchingRequirements: string[] = [];

        if (matchResponse.category !== 'NO_MATCH') {
          if (matchResponse.category.startsWith('outfit:')) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [_, outfitTitle, _productTitle] = matchResponse.category.split(':');
            const outfit = requirementsData.outfits.find(o => o.title === outfitTitle);
            if (outfit?.requirements) {
              matchingRequirements = outfit.requirements;
            }
          } else {
            const product = requirementsData.products.find(p => p.title === matchResponse.category);
            if (product?.requirements) {
              matchingRequirements = product.requirements;
            }
          }
        }

        if (matchingRequirements.length === 0) {
          console.warn(`No matching requirements found for product: ${product.name}`);
        }

        return this.scoreProductForRequirements(product.id, matchingRequirements);
      } catch (error) {
        console.error(`Error scoring product ${pr.productId}:`, error);
        return null;
      }
    });

    return Promise.all(scoringPromises);
  }

  async formatScoringResult(scoringResult: ProductScoringResult): Promise<string> {
    // Get icon for overall score
    const overallIcon =
      scoringResult.overall_suitability_score.score >= 80
        ? '✨'
        : scoringResult.overall_suitability_score.score >= 70
        ? '✅'
        : '❌';

    let formattedResult = `\nProduct: ${scoringResult.product_name}\n`;
    formattedResult += `${overallIcon} Overall Score: ${scoringResult.overall_suitability_score.score}%\n`;
    formattedResult += '\nIndividual Requirement Scores:\n';
    formattedResult += `--------------------------------\n`;

    scoringResult.requirements_scores.forEach((req, index) => {
      // Get icon for requirement score
      const reqIcon =
        req.suitability_score >= 80 ? '✨' : req.suitability_score >= 70 ? '✅' : '❌';

      // Add separator between requirements
      if (index > 0) {
        formattedResult += '\n';
      }

      formattedResult += `${reqIcon} ${req.requirement_description}: ${req.suitability_score}%\n`;
      formattedResult += `   Reason: ${req.reason}\n`;
      formattedResult += `--------------------------------`;
    });

    return formattedResult;
  }

  async rateProductForPurchase(
    request: RateProductForPurchaseRequest,
  ): Promise<RateProductForPurchaseResponse> {
    const { productId, orderId, chatId } = request;

    const scoringResults = await this.scoreProductsForChat(chatId, orderId, [{ productId }]);

    return {
      response: scoringResults[0]
        ? await this.formatScoringResult(scoringResults[0])
        : '<<Failed to score product>>',
    };
  }

  private async getProductDoubleCheckPoints(
    product: Product,
    productPrice: string,
    productOriginalPrice: string,
    requirements: string[],
  ): Promise<string> {
    const doubleCheckChatHistory = new TemporaryChatHistory();
    doubleCheckChatHistory.addMessage({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Given this product suggestion:

Product Name: ${product.name}
Product Description: ${product.description}
Price: ${productPrice}${productOriginalPrice ? ` - (Original: ${productOriginalPrice})` : ''}
Product Brand: ${product.brandName}${product.subBrandName ? ` (${product.subBrandName})` : ''}

And these specific requirements:
${requirements.map(req => `- ${req}`).join('\n')}

What specific requirements should we verify before sending this product suggestion to the user?

For each requirement listed, provide detailed verification points to ensure the product fully meets the user's needs.

For each verification point, include everything you want us to check (including any details about the user preferences, bio, chat etc). The person will only see this list of verification points, not the original requirements / chat / bio.

Focus only on verifying the explicit requirements mentioned above. Do not add additional checks beyond what was requested.`,
        },
        ...(product.compressedImageUrls?.map(url => ({
          type: 'image' as const,
          imageUrl: url,
        })) ?? []),
      ],
    });

    // Get double-check points from OpenAI
    const doubleCheckResponse = await this.openaiService.submitChatCompletion(
      await doubleCheckChatHistory.getOpenAiMessages(),
      {
        model: OpenAIModel.O3,
        zodSchema: z.object({
          verification_points: z.array(z.string()),
        }),
      },
    );

    return (
      '\n\nVerify these points before sending the product to the user:\n' +
      doubleCheckResponse.verification_points.map(point => `• ${point}\n`).join('\n')
    );
  }

  async judgeOrderSuggestion(orderSuggestionId: string): Promise<void> {
    const { orderSuggestion, order } = await this.orderManagementService.getOrderSuggestionAndOrder(
      orderSuggestionId,
    );

    if (!order.chatId) {
      throw new Error(`Order ${order.id} has no chat ID`);
    }

    // Get chat history
    const chatHistory = await PersistedChatHistory.getExistingChatHistory(order.chatId);
    if (!chatHistory) {
      throw new Error(`Chat history not found for chat ID: ${order.chatId}`);
    }

    // Process each product suggestion
    const promises = orderSuggestion.productSuggestions.map(async productSuggestion => {
      try {
        // Get product details
        const product = await this.productService.getProductOrFail(productSuggestion.productId);

        // Create a temporary chat history for this evaluation
        const evalChatHistory = new TemporaryChatHistory();

        // Add the chat history context
        const messages = await chatHistory.getMessages();
        messages.forEach(msg => evalChatHistory.addMessage(msg));

        // Add order note if exists
        if (order.note) {
          evalChatHistory.addMessage({
            role: 'user',
            content: [{ type: 'text', text: `Additional note about what I want: ${order.note}` }],
          });
        }

        // Add the product for evaluation
        let productOriginalPrice =
          product.originalPrice && product.originalPrice !== product.price
            ? `Original Price: ${product.originalPrice}`
            : '';

        let productPrice =
          product.originalPrice && product.originalPrice !== product.price
            ? `Price: ${product.price}`
            : '';

        if (productOriginalPrice && productPrice && productOriginalPrice > productPrice) {
          [productOriginalPrice, productPrice] = [productPrice, productOriginalPrice];
        }

        evalChatHistory.addMessage({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Based on our conversation and my requirements, please evaluate this product:

Product Name: ${product.name}
Product Description: ${product.description}
Price: ${productPrice}${productOriginalPrice ? ` - (Original: ${productOriginalPrice})` : ''}
Product Brand: ${product.brandName}${product.subBrandName ? ` (${product.subBrandName})` : ''}
Product URL: ${product.url}

Please analyze how well this product matches my requirements and preferences. For each requirement you identify from our conversation, provide:
1. A score from 0-100
2. A detailed explanation of why you gave that score

In your requirements, also predict what type of brand the user is looking for and predict if this product's brand is a good fit.

Here is the scoring rubric:
70-100: Complete certainty - I am 100% confident this product meets the requirement perfectly exactly as specified (no risk of mismatch with our requirements)
60-69: Moderate certainty - I am somewhat confident but have some uncertainty - product somewhat meets the requirement but there is some risk of mismatch with our requirements
50-59: Low certainty - I have major doubts about whether this meets the requirement - product does not meet the requirement most likely (major risk of mismatch with our requirements)
0-49: No certainty - I cannot determine if this meets the requirement or am confident it does not

The score should reflect how certain you are that the product meets the requirement, not how well it matches. If you are unsure about any aspect, score it lower to indicate the need for verification.

Then provide an overall suitability score from 0-100 with explanation.`,
            },
            ...(product.compressedImageUrls?.map(url => ({
              type: 'image' as const,
              imageUrl: url,
            })) ?? []),
          ],
        });

        // Get evaluation from OpenAI
        const scoringResponse = await this.openaiService.submitChatCompletion(
          await evalChatHistory.getOpenAiMessages(),
          {
            model: OpenAIModel.O3,
            zodSchema: z.object({
              requirements_scores: z.array(
                z.object({
                  requirement_description: z.string(),
                  suitability_score: z.number(),
                  reason: z.string(),
                }),
              ),
              overall_suitability_score: z.object({
                score: z.number(),
                reason: z.string(),
              }),
            }),
          },
        );

        const analysis = await this.formatScoringResult({
          product_id: product.id,
          product_name: product.name,
          requirements_scores: scoringResponse.requirements_scores,
          overall_suitability_score: scoringResponse.overall_suitability_score,
        });

        const commentContent = `Analysis:\n${analysis}`;

        // Create a comment thread with the AI analysis instead of attaching directly
        await this.commentingService.createThreadOnProductPurchaseSuggestion({
          productPurchaseSuggestionId: productSuggestion.id,
          userId: 'fetchr-bot', // Using 'ai-judge' as the user ID for AI-generated comments
          userName: 'Fetchr Bot',
          threadType: ThreadType.THREAD_TYPE_COMMENT,
          content: commentContent,
        });

        // Create separate issue comments for each failed requirement (scores < 70)
        const failedRequirements = scoringResponse.requirements_scores.filter(
          req => req.suitability_score < 70,
        );

        for (const failedReq of failedRequirements) {
          // Create a new chat history for generating stylist-specific comments
          const stylistCommentChatHistory = await evalChatHistory.cloneIntoTemporaryChatHistory();

          // Add a prompt asking for a concise comment for the stylist
          stylistCommentChatHistory.addMessage({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Write a concise comment (50 words max) for a stylist to understand the failed requirement, why it failed and how they can check if it's actually a good fit considering this.

Reference the specific information from the chat history that shows this requirement isn't met.
Tell the stylist exactly what they need to check to verify if this assessment is correct.
Failed requirement: ${failedReq.requirement_description}
Current assessment: ${failedReq.reason}
Current score: ${failedReq.suitability_score}%

Make the comment easily readable. Use simple language.`,
              },
            ],
          });

          // Get the stylist-specific comment from OpenAI
          const { comment_to_stylist } = await this.openaiService.submitChatCompletion(
            await stylistCommentChatHistory.getOpenAiMessages(),
            {
              model: OpenAIModel.GPT_4_1_NANO,
              zodSchema: z.object({
                comment_to_stylist: z.string(),
              }),
            },
          );

          await this.commentingService.createThreadOnProductPurchaseSuggestion({
            productPurchaseSuggestionId: productSuggestion.id,
            userId: 'fetchr-bot',
            userName: 'Fetchr Bot',
            threadType: ThreadType.THREAD_TYPE_ISSUE,
            content: comment_to_stylist,
          });
        }
      } catch (error) {
        console.error(`Error evaluating product suggestion ${productSuggestion.id}:`, error);
      }
    });

    await Promise.all(promises);
  }
}
