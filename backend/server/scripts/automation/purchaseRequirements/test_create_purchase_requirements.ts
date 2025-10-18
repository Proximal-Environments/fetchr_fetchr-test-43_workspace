/* eslint-disable @typescript-eslint/no-unused-vars */
// import { z } from 'zod';
import { OpenAIModel } from '@fetchr/schema/core/core';
import {
  openAIService,
  orderAutomationService,
  orderManagementService,
  productService,
} from '../../../src/fetchr/base/service_injection/global';
import { PersistedChatHistory } from '../../../src/fetchr/core/chat/chatHistory';
import { TemporaryChatHistory } from '../../../src/fetchr/core/chat/chatHistory';
import { z } from 'zod';

// const chats: {
//   [key: string]: string;
// } = {
//   //   'manuelle-hat': '6069d64e-4e32-4945-bb07-0736dfa383f2',
//   //   'date-outfit': '4dad521b-5a9c-4a44-8be2-274284d96c0c',
//   //   'jevi-white-cotton-tshirt': '20f775a4-5e54-441d-b1b8-90f5a1a4e7f3',
//   //   'ibiza-outfit': '2baa534c-954d-44f7-8159-6073b5f52414',
//   //   'ivory-dress': '51b7490c-a2bc-4d50-804f-09937db16f93',
//   //   'bomber-jacket': '6968e5ed-d75f-4951-b7c2-5bd9f8e4b2f0',
//   //   'aman-overshirt': '4458cc0a-d445-4603-bf53-2eae21cca7cf',
//   //   'kerry-business-casual-outfit': 'a430918e-00a7-482c-8b73-d7f086e02ac0',
//   //   'kerry-ski-trip': '18b4d6b9-46bb-4c36-a874-3733d596c9b0',
//   'alexandra-dress': '5d53f639-bfe5-4547-a525-b7f94f6ffec3',
// };

// Types for the response
type Product = {
  title: string;
  options: string[];
  requirements?: string[];
};

type Outfit = {
  title: string;
  products: Product[];
  requirements?: string[];
};

type RequirementsOutput = {
  chat_id: string;
  chat_url: string;
  outfits: Outfit[];
  products: Product[];
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

async function getRequirementsForChat(chatId: string): Promise<RequirementsOutput | null> {
  const chatHistory = await PersistedChatHistory.getExistingChatHistory(chatId);

  if (!chatHistory) {
    console.log(`Chat history not found for chat ID: ${chatId}`);
    return null;
  }

  const clonedChatHistory = await chatHistory.cloneIntoTemporaryChatHistory();

  const order = await orderManagementService.getOrderByChatId(chatId);

  if (order && order.note) {
    clonedChatHistory.addMessage({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Here is my note on the order: ${order.note}`,
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

Do not include shoes and accessories unless the user explicitly mentions them in the chat.`,
      },
    ],
  });

  try {
    const response = await openAIService.submitChatCompletion(
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

        const outfitRequirements = await openAIService.submitChatCompletion(
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

Make sure the requirements applies to this specific product, not for other products.`,
            },
          ],
        });

        const productRequirements = await openAIService.submitChatCompletion(
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
    ) as Product[];

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

async function scoreProductForRequirements(
  productId: string,
  requirements: string[],
): Promise<ProductScoringResult> {
  // Get product details
  const product = await productService.getProductOrFail(productId);

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
  const scoringResponse = await openAIService.submitChatCompletion(scoringMessages, {
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

// Function to score multiple products
async function scoreProductsForChat(
  chatId: string,
  productIds: string[],
): Promise<ProductScoringResult[]> {
  // First get the requirements for the chat
  const requirementsData = await getRequirementsForChat(chatId);
  if (!requirementsData) {
    throw new Error(`No requirements found for chat ${chatId}`);
  }

  // Score each product
  const scoringPromises = productIds.map(async productId => {
    // Get product details
    const product = await productService.getProductOrFail(productId);

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

    // Create a message to evaluate the product's suitability
    const scoringChatHistory = new TemporaryChatHistory();
    scoringChatHistory.addMessage({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Here's what the user is looking for:

Individual Products:
${requirementsData.products
  .map(
    p =>
      `- ${p.title} (options: ${p.options.join(', ')})${
        p.requirements ? `\n  Requirements: ${p.requirements.join(', ')}` : ''
      }`,
  )
  .join('\n')}

Outfits:
${requirementsData.outfits
  .map(
    o =>
      `- ${o.title}:${
        o.requirements ? `\n  Outfit Requirements: ${o.requirements.join(', ')}` : ''
      }\n${o.products.map(p => `  - ${p.title} (options: ${p.options.join(', ')})`).join('\n')}`,
  )
  .join('\n')}

Please evaluate if this product would be a good purchase for the user:

Product Name: ${product.name}
Product Description: ${product.description}
Price: ${productPrice}${productOriginalPrice ? ` - (Original: ${productOriginalPrice})` : ''}
Brand: ${product.brandName}${product.subBrandName ? ` (${product.subBrandName})` : ''}
Product URL: ${product.url}

Evaluate this product's suitability for the user's needs. Consider all aspects including style, price, and specific requirements.
Break down your evaluation by each relevant requirement and provide an overall assessment.`,
        },
        ...(product.compressedImageUrls?.map(url => ({
          type: 'image' as const,
          imageUrl: url,
        })) ?? []),
      ],
    });

    const scoringResponse = await openAIService.submitChatCompletion(
      await scoringChatHistory.getOpenAiMessages(),
      {
        model: OpenAIModel.O3,
        zodSchema: z.object({
          requirements_scores: z.array(
            z.object({
              requirement_description: z.string(),
              suitability_score: z.number().min(0).max(100),
              reason: z.string(),
            }),
          ),
          overall_suitability_score: z.object({
            score: z.number().min(0).max(100),
            reason: z.string(),
          }),
        }),
      },
    );

    return {
      product_id: productId,
      product_name: product.name,
      requirements_scores: scoringResponse.requirements_scores,
      overall_suitability_score: scoringResponse.overall_suitability_score,
    };
  });

  return Promise.all(scoringPromises);
}

// Example usage:
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function example1(): Promise<void> {
  const chatId = '88fca997-b5ae-4ed9-b0aa-e397aebc6023';
  try {
    const requirements = await getRequirementsForChat(chatId);
    if (requirements) {
      console.log(`Results for chat ${chatId}:`);
      console.log(`Chat URL: ${requirements.chat_url}`);
      console.log(JSON.stringify(requirements, null, 2));
    }
  } catch (error) {
    console.error('Failed to get requirements:', error);
  }
}

async function example2(): Promise<void> {
  const chatId = 'c1b1c5e8-8da0-494a-9f7d-48ba5a71084f';

  const productIds = [
    'c023b22a-853f-44e0-909a-db386b889ad5',
    'a9723439-d84f-419a-b555-05aaabc58d33',
  ];

  try {
    const scores = await scoreProductsForChat(chatId, productIds);
    console.log('Product Scores:');
    scores.forEach(score => {
      // Get icon for overall score
      const overallIcon =
        score.overall_suitability_score.score >= 80
          ? '✨'
          : score.overall_suitability_score.score >= 70
          ? '✅'
          : '❌';

      console.log(`\nProduct: ${score.product_name}`);
      console.log(`${overallIcon} Overall Score: ${score.overall_suitability_score.score}%`);
      console.log('Individual Requirement Scores:');
      score.requirements_scores.forEach(req => {
        // Get icon for requirement score
        const reqIcon =
          req.suitability_score >= 80 ? '✨' : req.suitability_score >= 70 ? '✅' : '❌';

        console.log(`${reqIcon} ${req.requirement_description}: ${req.suitability_score}%`);
        console.log(`   Reason: ${req.reason}`);
      });
    });
  } catch (error) {
    console.error('Failed to score products:', error);
  }
}

// example1();
// example2();

await orderAutomationService.judgeOrderSuggestion('47c64976-d93d-4112-bcd2-4824ee1ead98');
