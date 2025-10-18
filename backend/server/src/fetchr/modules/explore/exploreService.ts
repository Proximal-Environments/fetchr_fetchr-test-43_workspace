import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { EmbeddingsService } from '../../core/embeddings/embeddingsService';
import { ProductService } from '../product/productService';
import { ProductSearchService } from '../product/productSearchService';
import {
  ExploreRequest, Gender,
  ImageWithWidthAndHeight,
  PopulatedExploreMessage,
  PopulatedUserProductPreference,
  PreferenceType,
  ProductWithSearchQuery,
  SearchMethod,
  SearchQuery,
  UserProfile
} from '@fetchr/schema/base/base';
import { MessageRole, OpenAIModel } from '@fetchr/schema/core/core';
import { convertGenderToDbGender } from '../../../shared/converters';
import {
  GENERATE_STYLES_PROMPT
} from './explorePrompts';
import { AnthropicService } from '../../core/anthropic/anthropicService';
import {
  ProcessMessageRequest,
  ProcessMessageResponse,
  CreateExploreRequestRequest,
  CreateExploreRequestResponse,
  ReplyToChatRequest,
  ReplyToChatResponse,
} from '@fetchr/schema/explore/explore';
import { ExploreRequestService } from './exploreRequestService';
import { ProductPreferenceService } from './productPreferencesService';
import { UserService } from '../user/userService';
import { PineconeService } from '../../core/pinecone/pineconeService';
import {
  getRequestUser,
  greaterOrEqualToVersion_ONLY_ON_PROD,
} from '../../base/logging/requestContext';
import { ExploreAgent } from '../../core/agent/looped_agent/explore/ExploreAgent';
import { assertNever } from '../../../shared/utils';
import { MessageUserRequestPayload } from '../../core/chat/tools/explore/message_user_tool';
import { SuggestStylesToUserRequestPayload } from '../../core/chat/tools/explore/suggest_styles_to_user_tool';
import { ImagePreferenceService } from './imagePreferencesService';
import { ToolUsageRequest } from '../../core/chat/types';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { NotificationsService } from '../notifications/notificationsService';
import { NOTIFICATION_TYPE } from '../../../shared/notifications';
import { ExecutingNonBlockingResponsePayload, ExecutingOutsideResponsePayload } from '../../core/chat/tools/common_tools';
import { SuggestProductsToUserRequestPayload } from '../../core/chat/tools/explore/suggest_products_to_user_tool';
import { ExploreDifferentStylesRequestPayload } from '../../core/chat/tools/explore/explore_different_styles_tool';
import { FinishFindingProductRequestPayload } from '../../core/chat/tools/explore/finish_finding_product_tool';
import { convertExploreMessagesToFetchrMessages } from '../../core/agent/looped_agent/explore/exploreConverters';
import { PersistedChatHistory } from '../../core/chat/chatHistory';
import { ProductImageService } from '../../core/productImage/productImageService';
import { logService } from '../../base/logging/logService';
import { PinterestService } from '../pinterest/pinterestService';
import { Perf } from '../../core/performance/performance';
import { getFirstTwoMessages } from './utils';
@injectable()
export class ExploreService extends BaseService {
  constructor(
    @inject(OpenAIService) private readonly openaiService: OpenAIService,
    @inject(EmbeddingsService)
    private readonly embeddingService: EmbeddingsService,
    @inject(ProductService) private readonly productService: ProductService,
    @inject(ProductSearchService)
    private readonly productSearchService: ProductSearchService,
    @inject(AnthropicService) private readonly anthropicService: AnthropicService,
    @inject(ExploreRequestService)
    private readonly exploreRequestService: ExploreRequestService,
    @inject(ProductPreferenceService)
    private readonly productPreferenceService: ProductPreferenceService,
    @inject(UserService) private readonly profileService: UserService,
    @inject(PineconeService) private readonly pineconeService: PineconeService,
    @inject(ImagePreferenceService)
    private readonly imagePreferenceService: ImagePreferenceService,
    @inject(ProductImageService)
    private readonly productImageService: ProductImageService,
    @inject(NotificationsService)
    private readonly notificationsService: NotificationsService,
    @inject(UserService) private readonly userService: UserService,
    @inject(PinterestService) private readonly pinterestService: PinterestService,
    @inject(Perf) private perfService: Perf,
  ) {
    super('ExploreService');
  }

  async generateStyles(
    query: string,
    gender: Gender,
    numStyles: number | string = 10,
  ): Promise<string[]> {
    try {
      const prompt = GENERATE_STYLES_PROMPT.replace('{query}', query)
        .replace('{gender}', convertGenderToDbGender(gender))
        .replace('{num_styles}', numStyles.toString());

      this.logService.info('Generating style descriptions');
      const response = (
        await this.openaiService.submitChatCompletion(prompt, {
          model: OpenAIModel.O1_MINI,
        })
      ).choices[0].message.content;

      if (!response) {
        this.logService.error('Failed to generate style descriptions');
        return [];
      }

      // Extract styles using regex
      const styleRegex = /<style>(.*?)<\/style>/gs;
      const matches = response.match(styleRegex);
      const styles = matches ? matches.map(match => match.replace(/<\/?style>/g, '').trim()) : [];

      // Clean and validate styles
      const validStyles = styles.filter(
        style => style && style.length > 20, // Ensure minimum length for quality
      );

      if (!validStyles.length) {
        this.logService.warn('No valid styles generated');
        return [];
      }

      this.logService.info(`Successfully generated ${validStyles.length} style descriptions`);
      return validStyles;
    } catch (error) {
      this.logService.error('Error generating style descriptions', {
        metadata: { error, query, gender },
      });
      return [];
    }
  }

  async getProductsWithDifferentStylesAsync(
    searchQuery: SearchQuery,
    numProducts: number | string = 10,
  ): Promise<ProductWithSearchQuery[]> {
    try {
      if (!searchQuery.gender) {
        throw new Error('Gender is required to generate style variations');
      }

      // Generate style variations
      const styleQueries = await this.generateStyles(
        searchQuery.query,
        searchQuery.gender,
        numProducts,
      );
      this.logService.info(`Generated ${styleQueries.length} style variations`);

      // Create search queries for each style
      const searchQueries = styleQueries.map(styleQuery => ({
        ...searchQuery,
        category: undefined,
        query: styleQuery,
      }));

      this.logService.info('Generated search queries', {
        metadata: { searchQueries },
      });

      // Search products in parallel
      const productsList = await Promise.all(
        searchQueries.map(query => this.productSearchService.searchProducts(query)),
      );

      this.logService.info(
        `Found ${productsList
          .map(products => products.length)
          .reduce((total, count) => total + count, 0)} products in total with different styles`,
      );

      // Combine results with their queries
      const results = styleQueries
        .map((query, index) => ({
          query,
          products: productsList[index],
        }))
        .filter(result => result.products && result.products.length > 0); // Only include results that have products

      if (!results.length) {
        this.logService.error('No results found for any style variation');
        return [];
      }

      this.logService.info(`Found results for ${results.length} different styles`, {
        metadata: { results },
      });

      return results.map(result => ({
        product: result.products[0].product,
        query: result.query,
      }));
    } catch (error) {
      this.logService.error('Error generating products with different styles', {
        metadata: { error, searchQuery },
      });
      return [];
    }
  }

  async *createExploreRequest(
    request: CreateExploreRequestRequest,
  ): AsyncGenerator<CreateExploreRequestResponse> {
    try {
      const user = getRequestUser();
      if (!user) {
        throw new Error('User not logged in when creating explore request.');
      }
      let message;
      switch (request.message?.message?.$case) {
        case 'basicMessage':
          message = request.message.message.basicMessage;
          break;
        default:
          throw new Error('Unsupported message type');
      }

      logService.info('Received explore submit_request:', {
        metadata: { request },
      });

      let category = request.category;
      if (!category) {
        console.log('Getting category from query...');
        category = await this.productSearchService.getProductCategoryFromQuery(
          message.content,
          message.imageUrls,
        );
      }

      if (!user.metadata?.gender) {
        throw new Error('User has no gender set');
      }

      const exploreRequest: Omit<
        ExploreRequest,
        'id' | 'generatedTitle' | 'createdAt' | 'messages'
      > = {
        userId: user.id,
        query: message.content,
        lowerBudget: request.lowerBudget,
        upperBudget: request.upperBudget,
        brandIds: request.brandIds,
        category: category,
        gender: user.metadata.gender,
        devIsDevOnly: request.isDevOnly || false,
        productId: request.productId,
      };

      logService.info('Request:', { metadata: { exploreRequest } });

      const createdRequest = await this.exploreRequestService.insertRequest(
        exploreRequest,
        user.id,
        request.id,
        message.imageUrls,
      );
      logService.info('Request submitted successfully.', {
        metadata: { requestId: createdRequest },
      });

      yield {
        response: {
          $case: 'exploreRequestResult',
          exploreRequestResult: {
            request: createdRequest,
          },
        },
      };

      const processMessageGenerator = this.processMessage({
        requestId: createdRequest.id,
        message: {
          message: {
            $case: 'basicMessage',
            basicMessage: message,
          },
        },
      });

      for await (const response of processMessageGenerator) {
        yield {
          response: {
            $case: 'processMessageResponse',
            processMessageResponse: response,
          },
        };
      }
    } catch (error) {
      console.error('Detailed error in createExploreRequest:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });

      logService.error('Error in submit_request:', {
        error: error as Error,
        metadata: {
          method: 'createExploreRequest',
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }

  async *respondToFirstMessage(
    exploreRequest: ExploreRequest,
    userProfile: UserProfile,
    exploreAgent: ExploreAgent,
  ): AsyncGenerator<ProcessMessageResponse | { type: 'skip_pinterest' }> {
    logService.info('First message, forcing pinterest style images.', {
      metadata: { exploreRequest },
    });

    if (exploreRequest.productId) {
      yield { type: 'skip_pinterest' };
      return;
    }

    const shouldUsePinterestPromise = this.openaiService
      .submitChatCompletion(
        `You are evaluating whether to show the user a Pinterest-style board of images to help determine their fashion style preferences.

User query: "${exploreRequest.query}"
User profile: ${userProfile.generatedProfileDescription?.description || 'Not available'}
Category: ${exploreRequest.category || 'Not specified'}

FIRST: Determine if this is a fashion query. We ONLY support fashion items (clothing, shoes, accessories, etc.).
If it's not fashion-related, always set shouldShowStyleBoard to false.

For fashion queries, DO SHOW a style board when:
- The query is vague or open-ended (e.g., "summer dresses", "work outfits")
- The query uses subjective style terms (e.g., "elegant", "casual", "trendy")
- The user hasn't specified exact visual attributes (specific colors, patterns, etc.)
- The user seems to be exploring options rather than searching for something specific
- The product category has significant style variation (e.g., dresses, tops, outfits)

For fashion queries, DO NOT show a style board when:
- The user has given us a brand & product combination (e.g., "Gucci belt", "Nike sneakers")
- The user is searching for a specific brand/model (e.g., "Levi 501 jeans")
- The query appears to be for a replacement of something specific
- The query is primarily about functional features (e.g., "waterproof winter boots")

Return a JSON response with:
- shouldShowStyleBoard: boolean
- reasoning: brief explanation of your decision
- suggestedBoardTitle: a title for the board if shouldShowStyleBoard is true`,
        {
          model: OpenAIModel.GPT_4O,
          zodSchema: z.object({
            shouldShowStyleBoard: z.boolean(),
            reasoning: z.string(),
            suggestedBoardTitle: z.string(),
          }),
        },
      )
      .then(response => {
        logService.info('Should show style board', {
          metadata: { response },
        });
        return response.shouldShowStyleBoard;
      });

    const pinterestQueriesPromise = this.openaiService
      .submitChatCompletion(
        [
          {
            role: 'user',
            content: `I'm searching for new products: "${exploreRequest.query}".
${
  userProfile.generatedProfileDescription?.description
    ? `My bio based on my previous searches: ${userProfile.generatedProfileDescription.description}\n`
    : ''
}

Please propose 1-2 concise Pinterest search queries. Incorporate relevant and non-conflicting parts of my bio into my search query. Do not include any parts of my bio that conflict with the query.

Here are some guidelines:
1. Keep each query under 6 words. 
2. Exclude any references to gender, weight, height, or age—only include item or style details.
3. Avoid extra words like "fashion," "style," "outfit," "look," "vibe," "trending," "popular,"  "new", "trending", "popular", "best", "favorite", "favorite things", etc.
4. Use specific, descriptive terms that define the aesthetic or item.
5. Include relevant occasions or settings if mentioned in the query / bio (as long as it doesn't conflict with the query).
6. Consider seasonal context if applicable.
7. If the query does not include colors, add color terms if specifically mentioned or hinted in the bio (as long as it doesn't go against the query)
8. Remove phrases like "I want," "I'm looking for," etc.
9. Only include bio elements that do not conflict with the query.
10. DO NOT INCLUDE WEIGHT RELATED BODY MEASUREMENTS in the queries. IE: Avoid saying things like "plus size", "petite", "curvy", etc.
11. Include the occasion if mentioned in the query.
12. Do not write more than 2 queries.

This is a new order by the user. We are trying to use the bio to find the perfect pinterest queries (underneath this query). You should not change the query completely (for example changing the style they've mentioned in the query or the color or something similar). Please provide 3 distinct but related queries that capture different aspects of what the user is looking for.
`,
          },
        ],
        {
          model: OpenAIModel.GPT_4O,
          zodSchema: z.object({
            pinterestQueries: z.array(z.string()),
          }),
        },
      )
      .then(response => response.pinterestQueries);

    const [shouldUsePinterest, pinterestQueries] = await Promise.all([
      shouldUsePinterestPromise,
      pinterestQueriesPromise,
    ]);

    if (!shouldUsePinterest) {
      yield { type: 'skip_pinterest' };
      return;
    }

    if (greaterOrEqualToVersion_ONLY_ON_PROD('1.4.0', '175')) {
      yield {
        message: {
          message: {
            $case: 'updateStatusMessage',
            updateStatusMessage: {
              statusString: 'Finding style inspirations...',
            },
          },
        },
      };
    }

    this.logService.info('Pinterest queries', {
      metadata: { pinterestQueries },
    });

    // Add the original query to the list of queries
    pinterestQueries.push(exploreRequest.query);

    const pinterestImages = await Promise.all(
      pinterestQueries.map(async query =>
        (
          await this.pinterestService.searchPinterestImages(query, userProfile.metadata?.gender)
        ).slice(0, 30),
      ),
    );

    let flattenedPinterestImages = [
      // First batch: first 10 from each query
      ...pinterestImages.map(queryImages => queryImages.slice(0, 10)).flat(),
      // Second batch: next 10 from each query (10-20)
      ...pinterestImages.map(queryImages => queryImages.slice(10, 20)).flat(),
      // Third batch: remaining images (20-30)
      ...pinterestImages.map(queryImages => queryImages.slice(20, 30)).flat(),
      ...pinterestImages.map(queryImages => queryImages.slice(30)).flat(),
    ]
      .filter((image, index, self) => index === self.findIndex(i => i.original === image.original))
      .sort(() => Math.random() - 0.5);

    if (flattenedPinterestImages.length === 0) {
      const { newQuery } = await this.openaiService.submitChatCompletion(
        `The user has tried to search pinterest for "${pinterestQueries[0]}", but we didn't find any results. Please simplify the query for search so that we can find results. For example, you can remove the brand name or price point.`,
        {
          model: OpenAIModel.GPT_4O,
          zodSchema: z.object({
            newQuery: z.string(),
          }),
        },
      );
      if (!newQuery) {
        throw new Error('No new query found');
      }
      flattenedPinterestImages = await this.pinterestService.searchPinterestImages(
        newQuery,
        userProfile.metadata?.gender,
      );
    }

    if (flattenedPinterestImages.length > 0) {
      // If we have images from pinterest, we can suggest styles to the user
      const uuid = uuidv4();
      const toolUseRequest: ToolUsageRequest<'suggest_styles_to_user'> =
        ToolUsageRequest.createFromPayload(
          new SuggestStylesToUserRequestPayload({
            styleQuery: exploreRequest.query,
          }),
          uuid,
        );

      // Start downloading images in the background (DO NOT MAKE THIS AWAIT)
      // pinterestImages.map(image => imageDownloaderService.downloadImage(image.original));

      const suggestStylesToUserPayload =
        toolUseRequest.payload as SuggestStylesToUserRequestPayload;
      const convertedImages: ImageWithWidthAndHeight[] = flattenedPinterestImages
        .map(image => ({
          imageUrl: image.original,
          width: image.original_width,
          height: image.original_height,
        }))
        .filter(image => image.width && image.height);
      suggestStylesToUserPayload.addMetadata({
        images: convertedImages,
      });
      exploreAgent.addMessage({
        role: 'assistant',
        content: [toolUseRequest],
      });
      yield {
        message: {
          message: {
            $case: 'gridImagesRequestMessage',
            gridImagesRequestMessage: {
              toolUseId: uuid,
              imageUrls: convertedImages,
            },
          },
        },
      };
      return;
    }
  }

  async *processMessage(request: ProcessMessageRequest): AsyncGenerator<ProcessMessageResponse> {
    const perfHandle = this.perfService.start('processMessage');
    try {
      const requestUser = getRequestUser();
      const [exploreRequest, userProfile] = await Promise.all([
        this.exploreRequestService.getRequestOrFail(request.requestId),
        this.userService.getUserOrFail(requestUser?.id || ''),
      ]);
      if (!requestUser || requestUser.id !== exploreRequest.userId) {
        throw new Error('User does not have access to this request in processMessage');
      }
      // Before creating ExploreAgent in processMessage

      const exploreAgent = new ExploreAgent({
        maxSteps: 5,
        chatId: request.requestId,
        userProfile: userProfile,
        exploreRequest: exploreRequest,
      });
      await exploreAgent.init();

      const snapshotIdPromise = exploreAgent.chatHistory.takeSnapshot();
      // Error handling flag
      let didError = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let error: any = null;
      try {
        if (request.message) {
          // Process the user's message directly
          this.logService.info('Processing user message', {
            metadata: {
              message: request.message.message,
            },
          });
        } else {
          this.logService.info(
            'User message was empty. Skipping adding it to the request context.',
          );
        }

        this.perfService.track('processMessage.processIncomingUserMessage', async () => {
          if (request.message) {
            if (!request.message.message?.$case || !request.message.message) {
              throw new Error('Request message is undefined');
            }
            switch (request.message.message?.$case) {
              case 'basicMessage': {
                const contentBlocks = [
                  ...(request.message.message.basicMessage.imageUrls ?? []).map(imageUrl => ({
                    type: 'image' as const,
                    imageUrl: imageUrl,
                  })),
                  ...(request.message.message.basicMessage.content.trim().length > 0
                    ? [
                        {
                          type: 'text' as const,
                          text: request.message.message.basicMessage.content,
                        },
                      ]
                    : []),
                ];
                if (contentBlocks.length > 0) {
                  exploreAgent.addMessage({
                    role: 'user',
                    content: contentBlocks,
                  });
                }
                break;
              }
              case 'productPreferencesResponseMessage':
                await this.productPreferenceService.batchUpdateProductPreferencesFromSwipes(
                  exploreRequest.id,
                  request.message.message.productPreferencesResponseMessage.preferences.map(
                    pref => ({
                      productId: pref.itemId,
                      preferenceType: pref.preferenceType,
                      comments: pref.comments,
                    }),
                  ),
                );
                if (request.message.message?.productPreferencesResponseMessage?.preferences) {
                  this.logService.info(
                    'We no longer process the product preferences response manually...',
                  );
                }
                break;
              case 'gridProductsResponseMessage':
                this.productPreferenceService.batchUpdateProductPreferencesFromSwipes(
                  exploreRequest.id,
                  request.message.message.gridProductsResponseMessage.preferences.map(pref => ({
                    productId: pref.itemId,
                    preferenceType: pref.preferenceType,
                    comments: pref.comments,
                  })),
                );
                if (request.message.message?.gridProductsResponseMessage?.preferences) {
                  this.logService.info(
                    'We no longer process the product preferences response manually...',
                  );
                }
                break;
              case 'gridImagesResponseMessage':
                await this.imagePreferenceService.batchUpdateImagePreferencesFromSwipes(
                  exploreRequest.id,
                  requestUser.id,
                  request.message.message.gridImagesResponseMessage.imagePreferenceItems
                    .filter(pref => pref.imagePreferenceItem?.imageUrl)
                    .map(pref => ({
                      imageUrl: pref.imagePreferenceItem?.imageUrl ?? '',
                      preferenceType: pref.imagePreferenceItem?.preferenceType,
                    })),
                );
                break;
              default:
                assertNever(request.message.message);
            }
          }
        });

        if (exploreAgent.chatHistory.messages.length <= 3) {
          const respondToFirstMessagePerfHandle = this.perfService.start(
            'processMessage.respondToFirstMessage',
          );
          try {
            const agentGenerator = this.respondToFirstMessage(
              exploreRequest,
              userProfile,
              exploreAgent,
            );
            let processedPinterest = true;
            for await (const responseChunk of agentGenerator) {
              if ('type' in responseChunk && responseChunk.type === 'skip_pinterest') {
                this.logService.info(
                  `Skipping pinterest board for query: ${exploreRequest.query}`,
                  {
                    metadata: { responseChunk },
                  },
                );
                processedPinterest = false;
              } else if ('message' in responseChunk) {
                yield responseChunk;
              }
            }
            if (processedPinterest) {
              return;
            }
          } finally {
            this.perfService.end(respondToFirstMessagePerfHandle);
          }
        }

        const processFullAgentRunPerfHandle = this.perfService.start('processMessage.processAgent');
        try {
          // Run the agent in non-blocking way
          const agentGenerator = exploreAgent.run();
          // While the agent is running, check and yield any status updates
          for await (const responseChunk of agentGenerator) {
            this.logService.info('Yielding Process Message Response Chunk', {
              metadata: { responseChunk },
            });
            const type = responseChunk.type;
            switch (type) {
              case 'status': {
                this.logService.info('Yielding status update', {
                  metadata: { status: responseChunk.status },
                });
                yield {
                  message: {
                    message: {
                      $case: 'updateStatusMessage',
                      updateStatusMessage: {
                        statusString: responseChunk.status,
                      },
                    },
                  },
                };
                break;
              }
              case 'pending_tool_usage': {
                const pendingToolUse = responseChunk.request;
                if (!pendingToolUse) {
                  this.logService.error('No pending tool use found');
                  throw new Error('No pending tool use found');
                }
                this.logService.info('Pending tool use', {
                  metadata: { pendingToolUse },
                });
                switch (pendingToolUse.payload.fetchrLLMToolType) {
                  case 'suggest_products_to_user':
                    const payload = pendingToolUse.payload as SuggestProductsToUserRequestPayload;
                    const metadata = payload.getMetadata();
                    if (!metadata) {
                      this.logService.error('No metadata found');
                      throw new Error('No metadata found');
                    }
                    this.logService.info(
                      `Suggesting ${metadata.rankedProducts.length} products to user`,
                    );

                    const { rankedProducts, unrankedProducts } = metadata;
                    yield {
                      message: {
                        message: {
                          $case: 'productPreferencesRequestMessage',
                          productPreferencesRequestMessage: {
                            toolUseId: pendingToolUse.id,
                            products: rankedProducts.slice(0, 10),
                            unrankedProducts,
                            intermediateQueries: payload.searchQueries.map(query => query.query),
                          },
                        },
                      },
                    };
                    break;
                  case 'suggest_styles_to_user': {
                    const suggestStylesToUserPayload =
                      pendingToolUse.payload as SuggestStylesToUserRequestPayload;
                    const metadata = suggestStylesToUserPayload.getMetadata();
                    if (!metadata) {
                      this.logService.error('No metadata found');
                      throw new Error('No metadata found');
                    }
                    const { images } = metadata;
                    yield {
                      message: {
                        message: {
                          $case: 'gridImagesRequestMessage',
                          gridImagesRequestMessage: {
                            toolUseId: pendingToolUse.id,
                            imageUrls: images.map(image => ({
                              imageUrl: image.imageUrl,
                              width: image.width,
                              height: image.height,
                            })),
                          },
                        },
                      },
                    };
                    break;
                  }
                  case 'explore_different_styles':
                    const exploreDifferentStylesPayload =
                      pendingToolUse.payload as ExploreDifferentStylesRequestPayload;
                    const exploreDifferentStylesMetadata =
                      exploreDifferentStylesPayload.getMetadata();
                    if (!exploreDifferentStylesMetadata) {
                      this.logService.error('No metadata found');
                      throw new Error('No metadata found');
                    }
                    const {
                      rankedProducts: rankedStyleProducts,
                      unrankedProducts: unrankedStyleProducts,
                    } = exploreDifferentStylesMetadata;
                    yield {
                      message: {
                        message: {
                          $case: 'gridProductsRequestMessage',
                          gridProductsRequestMessage: {
                            toolUseId: pendingToolUse.id,
                            products: rankedStyleProducts.slice(0, 10),
                            unrankedProducts: unrankedStyleProducts,
                            intermediateQueries: exploreDifferentStylesPayload.styleQueries,
                          },
                        },
                      },
                    };
                    break;
                  case 'message_user': {
                    const messageUserPayload = pendingToolUse.payload as MessageUserRequestPayload;
                    const message = messageUserPayload.message;
                    if (
                      messageUserPayload.suggestedResponses &&
                      messageUserPayload.suggestedResponses.length > 0
                    ) {
                      yield {
                        message: {
                          message: {
                            $case: 'predefinedRequestMessage',
                            predefinedRequestMessage: {
                              message: {
                                role: MessageRole.MESSAGE_ROLE_ASSISTANT,
                                content: message,
                                images: [],
                                imageUrls: [],
                              },
                              suggestedResponses: messageUserPayload.suggestedResponses,
                            },
                          },
                        },
                      };
                    } else {
                      yield {
                        message: {
                          message: {
                            $case: 'basicMessage',
                            basicMessage: {
                              role: MessageRole.MESSAGE_ROLE_ASSISTANT,
                              content: message,
                              imageUrls: [],
                              images: [],
                            },
                          },
                        },
                      };
                    }
                    if (!messageUserPayload.blocking) {
                      exploreAgent.addToolUsageResult(
                        new ExecutingNonBlockingResponsePayload(),
                        pendingToolUse.id,
                      );
                    }
                    break;
                  }
                  case 'finish_finding_product':
                    const finishFindingProductPayload =
                      pendingToolUse.payload as FinishFindingProductRequestPayload;
                    const filteredMessages = await exploreAgent.chatHistory.filterMessages(
                      message => {
                        if (typeof message.content === 'string') {
                          return true;
                        } else if (Array.isArray(message.content)) {
                          // For message with content blocks, check each text block
                          for (const block of message.content) {
                            if (block.type === 'tool_use' && block.name === 'message_user') {
                              return true;
                            }

                            if (message.role === 'user') {
                              if (block.type === 'text') {
                                return true;
                              }
                              if (
                                block.type === 'tool_use' &&
                                block.payload.fetchrLLMToolType === 'suggest_products_to_user'
                              ) {
                                return true;
                              }
                            }
                          }
                          return false;
                        }
                        return false;
                      },
                    );

                    logService.info('Filtered messages', {
                      metadata: { filteredMessages },
                    });
                    // Get initial list of items
                    filteredMessages.addMessage({
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

Each title should be in title format (like a title of a card in our app)`,
                        },
                      ],
                    });

                    const response = await this.openaiService.submitChatCompletion(
                      await filteredMessages.getOpenAiMessages(),
                      {
                        model: OpenAIModel.GPT_4_1_MINI,
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

                    // Each outfit/product is a product suggestion
                    const productSuggestions: { productName: string; isSelected: boolean }[] = [];

                    // Add products from outfits
                    if (response.outfits) {
                      for (const outfit of response.outfits) {
                        // productSuggestions.push({
                        //   productName: outfit.title,
                        //   isSelected: true,
                        // });
                        for (const product of outfit.products) {
                          productSuggestions.push({
                            productName: product.title,
                            isSelected: true,
                          });
                        }
                      }
                    }

                    // Add standalone products
                    if (response.products) {
                      for (const product of response.products) {
                        productSuggestions.push({
                          productName: product.title,
                          isSelected: true,
                        });
                      }
                    }

                    await exploreAgent.chatHistory.addMetadataToToolUseRequest(pendingToolUse.id, {
                      productSuggestions: productSuggestions,
                    });

                    yield {
                      message: {
                        message: {
                          $case: 'finishFindingProductRequestMessage',
                          finishFindingProductRequestMessage: {
                            userRequirements: finishFindingProductPayload.userRequirements ?? [],
                            productSuggestions: productSuggestions ?? [],
                            message:
                              finishFindingProductPayload.message &&
                              finishFindingProductPayload.message.length > 0
                                ? finishFindingProductPayload.message
                                : undefined,
                          },
                        },
                      },
                    };
                    break;
                  default:
                    this.logService.error('Invalid external tool use type', {
                      metadata: { pendingToolUse },
                    });
                    throw new Error('Invalid external tool use type');
                }
                break;
              }
              case 'complete': {
                this.logService.info('Agent complete', {
                  metadata: { responseChunk },
                });
                break;
              }
              case 'error': {
                this.logService.error('Agent error', {
                  metadata: { error: responseChunk.error },
                  error: responseChunk.error,
                });
                break;
              }
              default:
                assertNever(responseChunk);
            }
          }
        } finally {
          this.perfService.end(processFullAgentRunPerfHandle);
        }
      } catch (err) {
        this.logService.error(
          'Error processing message. Restoring to initial chat history snapshot',
          {
            metadata: { error: err },
          },
        );
        didError = true;
        error = err;
      } finally {
        // If we had an error, restore the chat history to the initial snapshot that we took
        if (didError) {
          const snapshotId = await snapshotIdPromise;
          await exploreAgent.chatHistory.restoreFromSnapshot(snapshotId);
        }
      }

      if (error) {
        throw error;
      }
    } finally {
      this.perfService.end(perfHandle);
    }
  }

  async rerankQueriesBasedOnPreferences(
    queries: string[],
    userProductPreferences: PopulatedUserProductPreference[],
    searchMethod: SearchMethod,
  ): Promise<string[]> {
    const embeddingModel = this.pineconeService.getEmbeddingModelForSearchMethod(searchMethod);
    const queryEmbeddings = await this.embeddingService.batchGetQueryEmbeddings(
      queries,
      embeddingModel,
    );
    const productIds = userProductPreferences
      .map(pref => pref.productDetails?.id)
      .filter(Boolean) as string[];
    const productEmbeddings = await this.productService.batchGetProductEmbeddings(
      productIds,
      searchMethod,
    );

    const queryScores = queryEmbeddings.map(queryEmbedding => {
      let score = 0;
      userProductPreferences.forEach((pref, index) => {
        const productEmbedding = productEmbeddings[index];
        if (productEmbedding && pref.preference?.preferenceType) {
          // Calculate cosine similarity
          const similarity = queryEmbedding.reduce(
            (sum, val, i) => sum + val * productEmbedding[i],
            0,
          );

          if (pref.preference.preferenceType === PreferenceType.LIKE) {
            score += similarity;
          } else if (pref.preference.preferenceType === PreferenceType.DISLIKE) {
            score -= similarity;
          } else if (pref.preference.preferenceType === PreferenceType.SUPERLIKE) {
            score += similarity * 3;
          }
        }
      });
      return score;
    });

    // Sort queries by score in descending order
    return queries
      .map((query, index) => ({ query, score: queryScores[index] }))
      .sort((a, b) => b.score - a.score)
      .map(({ query }) => query);
  }

  async sendAiMessageToChat(chatId: string, message: string): Promise<void> {
    const exploreRequest = await this.exploreRequestService.getRequestOrFail(chatId);
    const userProfile = await this.userService.getUserOrFail(exploreRequest.userId);
    const exploreAgent = new ExploreAgent({
      maxSteps: 5,
      chatId: chatId,
      userProfile: userProfile,
      exploreRequest: exploreRequest,
    });

    await exploreAgent.init();

    const toolId = uuidv4();
    exploreAgent.addToolUsageRequest(
      ToolUsageRequest.createFromPayload(
        new MessageUserRequestPayload({
          message,
          blocking: true,
        }),
        toolId,
      ),
    );
    exploreAgent.addToolUsageResult(new ExecutingOutsideResponsePayload(), toolId);

    await this.exploreRequestService.clearCacheForRequest(chatId);

    await this.notificationsService.sendNotification(
      NOTIFICATION_TYPE.NEW_MESSAGE_IN_CHAT,
      userProfile.id,
      {
        chatId,
        title: `New message`,
        body: message,
      },
    );
  }

 

  async syncChatToMessages(
    requestId: string,
    user: UserProfile,
    messages: PopulatedExploreMessage[],
  ): Promise<void> {
    const perfTracker = this.perfService.start('exploreService.syncChatToMessages');
    try {
      const fetchrMessages = await convertExploreMessagesToFetchrMessages(messages);

      const queryMessage = messages[0].message;
      if (!queryMessage || queryMessage.$case !== 'basicMessage') {
        throw new Error('Query message not found');
      }

      let exploreRequest = await this.exploreRequestService.getRequest(requestId);
      if (!exploreRequest) {
        // Create a new explore request if it doesn't exist
        exploreRequest = await this.exploreRequestService.insertRequest(
          {
            query: queryMessage.basicMessage.content,
            gender: user.metadata?.gender ?? Gender.GENDER_UNSPECIFIED,
            brandIds: [],
          },
          user.id,
          requestId,
          queryMessage.basicMessage.imageUrls,
        );
      }

      const { systemMessage, firstUserMessage } = await getFirstTwoMessages(
        exploreRequest,
        user,
      );

      const fullExploreMessages = [systemMessage, firstUserMessage, ...fetchrMessages];

      // Update the chat history in the background (sync with the new value)
      await PersistedChatHistory.setChatHistory(requestId, fullExploreMessages);
    } finally {
      this.perfService.end(perfTracker);
    }
  }

  async *replyToChat(request: ReplyToChatRequest): AsyncGenerator<ReplyToChatResponse> {
    const perfTracker = this.perfService.start('exploreService.replyToChat');
    try {
      const user = getRequestUser();
      if (!user) {
        throw new Error('User not found');
      }
      await this.syncChatToMessages(request.requestId, user, request.messages);

      yield* this.processMessage({
        requestId: request.requestId,
        message: undefined,
      });
    } finally {
      this.perfService.end(perfTracker);
    }
  }
}
