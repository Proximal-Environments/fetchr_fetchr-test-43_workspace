import { injectable, inject } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import {
  ExploreRequest,
  ExploreRequestSummary,
  ExploreRequestType,
} from '@fetchr/schema/base/base';
import { supabaseDb } from '../../base/database/supabaseDb';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { explore_requests as DbExploreRequest, Prisma } from '@prisma/client';
import {
  convertCategoryToDbCategory,
  convertDbCategoryToCategory,
  convertDbExploreRequestTypeToExploreRequestType,
  convertDbGenderToGender,
  convertExploreRequestTypeToDbExploreRequestType,
  convertGenderToDbGender,
} from '../../../shared/converters';
import {
  FetchrContentBlock,
  PersistedChatHistory,
  TemporaryChatHistory,
} from '../../core/chat/chatHistory';
import { convertFetchrMessagesToExploreMessages } from '../../core/agent/looped_agent/explore/exploreConverters';
import { OpenAIModel } from '@fetchr/schema/core/core';
import { AnthropicService } from '../../core/anthropic/anthropicService';
import { z } from 'zod';
import { GENERATE_TITLE_PROMPT } from './explorePrompts';
import { CACHE_CONFIGS, RedisService } from '../../core/redis/redisService';
import { ExploreAgent } from '../../core/agent/looped_agent/explore/ExploreAgent';
import { UserService } from '../user/userService';
import { Perf } from '../../core/performance/performance';

const REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE = false;

@injectable()
export class ExploreRequestService extends BaseService {
  constructor(
    @inject(OpenAIService) private readonly openAIService: OpenAIService,
    @inject(AnthropicService) private readonly anthropicService: AnthropicService,
    @inject(RedisService) private readonly redisService: RedisService,
    @inject(UserService) private readonly userService: UserService,
    @inject(Perf) private readonly perfService: Perf,
  ) {
    super('ExploreRequestService');
  }

  async getRequestOrFail(requestId: string): Promise<ExploreRequest> {
    const request = await this.getRequest(requestId);
    if (!request) {
      this.logService.error(`Request with id ${requestId} not found`);
      throw new Error(`Request with id ${requestId} not found`);
    }
    return request;
  }

  async getRequest(requestId: string): Promise<ExploreRequest | null> {
    try {
      const cacheKey = `exploreRequest:${requestId}`;
      if (REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
        const cachedData = await this.redisService.get<DbExploreRequest>(
          cacheKey,
          CACHE_CONFIGS.SEARCH,
        );

        if (cachedData) {
          this.logService.info(`Cached explore request for id: ${requestId}`);
        } else {
          this.logService.info(`No cached explore request for id: ${requestId}`);
        }

        if (cachedData) {
          // Start background refresh without awaiting it
          this.refreshCacheInBackground(requestId, cacheKey);
          return await this.convertDbRequesttoRequest(cachedData);
        }
      }

      const requestData = await supabaseDb.explore_requests.findUnique({
        where: { id: requestId },
      });

      if (!requestData) {
        return null;
      }

      if (REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
        await this.redisService.set(cacheKey, requestData, CACHE_CONFIGS.SEARCH);
      }

      return await this.convertDbRequesttoRequest(requestData);
    } catch (error) {
      this.logService.error(`Error fetching request ${requestId}`, {
        metadata: { requestId },
        error,
      });
      return null;
    }
  }

  // Helper method to refresh cache in background
  private async refreshCacheInBackground(requestId: string, cacheKey: string): Promise<void> {
    if (!REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
      return;
    }

    try {
      // Use Promise.resolve().then() to make this non-blocking
      Promise.resolve().then(async () => {
        try {
          const freshData = await supabaseDb.explore_requests.findUnique({
            where: { id: requestId },
          });

          if (freshData) {
            // First update the raw DB object in cache
            await this.redisService.set(cacheKey, freshData, CACHE_CONFIGS.SEARCH);

            // Then fully populate the request with all related data (chat history, orders, etc.)
            const fullyPopulatedRequest = await this.convertDbRequesttoRequest(freshData);
            this.logService.debug('Background cache refresh completed with full data', {
              metadata: {
                requestId,
                messageCount: fullyPopulatedRequest.messages?.length || 0,
              },
            });
          }
        } catch (innerError) {
          this.logService.error('Error in background refresh process', {
            metadata: { requestId },
            error: innerError,
          });
        }
      });
    } catch (error) {
      // Just log the error but don't throw - this is a background operation
      this.logService.error('Error initiating background cache refresh', {
        metadata: { requestId, cacheKey },
        error,
      });
    }
  }

  async getLastCohort(requestId: string): Promise<number> {
    const result = await supabaseDb.product_preferences.findFirst({
      where: { request_id: requestId },
      orderBy: { cohort: 'desc' },
      select: { cohort: true },
    });

    if (!result) {
      return 0;
    }

    return Number(result.cohort);
  }

  async updateGeneratedTitle(requestId: string): Promise<string | undefined> {
    this.logService.info('Updating generated title', { metadata: { requestId } });
    const chatHistory = new PersistedChatHistory(requestId);
    await chatHistory.init();
    this.logService.info('Chat history initialized', { metadata: { chatHistory } });
    const messages = await chatHistory.getOpenAiMessages();
    messages.push({
      role: 'system',
      content: GENERATE_TITLE_PROMPT,
    });

    this.logService.info('Messages for title generation', { metadata: { messages } });

    const { generated_title } = await this.openAIService.submitChatCompletion(messages, {
      model: OpenAIModel.GPT_4O,
      zodSchema: z.object({
        generated_title: z.string(),
      }),
    });

    this.logService.info('Generated title', { metadata: { requestId, generated_title } });

    await supabaseDb.explore_requests.update({
      where: { id: requestId },
      data: { generated_title },
    });

    // Invalidate individual request cache
    const cacheKey = `exploreRequest:${requestId}`;
    if (REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
      await this.redisService.del(cacheKey, CACHE_CONFIGS.SEARCH);

      // Invalidate list caches
      await this.redisService.delByPattern(`exploreRequests:*`, CACHE_CONFIGS.SEARCH);
    }

    return generated_title;
  }

  async classifyExploreRequest(query: string): Promise<ExploreRequestType> {
    const { isOutfitRequest } = await this.openAIService.submitChatCompletion(
      [
        {
          role: 'system',
          content: `\
You are a helpful assistant that classifies shopping requests into one of the following categories:
- General outfit request
- Specific item request
When unsure, classify as an item request. Single dress requests are always an item request.
If the user says something like "Something for the gym" or "Something for the beach" classify as an outfit request.
If the user names the type of item they are looking for, classify as an item request.

Examples:
Jacket for work: Item request
Dress for the beach: Item request
Clothes for the gym: Outfit request
Dress: Item request
Something for my date night: Outfit request
Outfit for my trip to Europe: Outfit request
`,
        },
        {
          role: 'user',
          content: `
I am a user who is looking for: ${query}.
      `,
        },
      ],
      {
        model: OpenAIModel.GPT_4O,
        zodSchema: z.object({
          isOutfitRequest: z.boolean(),
        }),
      },
    );

    return isOutfitRequest
      ? ExploreRequestType.EXPLORE_REQUEST_TYPE_OUTFIT
      : ExploreRequestType.EXPLORE_REQUEST_TYPE_ITEM;
  }

  async _createNewDbRequest(
    request: Omit<ExploreRequest, 'id' | 'generatedTitle' | 'createdAt' | 'messages' | 'userId'>,
    userId: string,
    imageUrls?: string[],
  ): Promise<
    Omit<
      DbExploreRequest,
      | 'id'
      | 'created_at'
      | 'product_suggestions'
      | 'status'
      | 'order_scheduled_for'
      | 'phase'
      | 'messages'
    >
  > {
    const [generatedTitle, requestType] = await Promise.all([
      this.openAIService
        .submitChatCompletion(
          await new TemporaryChatHistory([
            { role: 'system', content: GENERATE_TITLE_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: `I'm looking for: ${request.query}` },
                ...(imageUrls?.map(
                  (url): FetchrContentBlock => ({ type: 'image', imageUrl: url }),
                ) ?? []),
              ],
            },
          ]).getOpenAiMessages(),
          {
            model: OpenAIModel.GPT_4O,
            zodSchema: z.object({
              generatedTitle: z.string(),
            }),
          },
        )
        .then(r => r.generatedTitle),
      this.classifyExploreRequest(request.query),
    ]);

    this.logService.info('Generated title and request type', {
      metadata: {
        generatedTitle,
        requestType: convertExploreRequestTypeToDbExploreRequestType(requestType),
      },
    });

    return {
      user_id: userId,
      query: request.query,
      image_urls: [],
      lower_budget: request.lowerBudget ? request.lowerBudget.toString() : null,
      upper_budget: request.upperBudget ? request.upperBudget.toString() : null,
      brand_ids: request.brandIds,
      category: request.category ? convertCategoryToDbCategory(request.category) : null,
      gender: convertGenderToDbGender(request.gender),
      dev_is_dev_only: request.devIsDevOnly || false,
      dev_is_deleted: request.devIsDeleted || false,
      original_user_query: request.query,
      generated_title: generatedTitle,
      version: 0,
      request_type: convertExploreRequestTypeToDbExploreRequestType(requestType),
      product_id: request.productId ?? null,
    };
  }

  async insertRequest(
    request: Omit<ExploreRequest, 'id' | 'generatedTitle' | 'createdAt' | 'messages' | 'userId'>,
    userId: string,
    requestId?: string,
    imageUrls?: string[],
  ): Promise<ExploreRequest> {
    try {
      const initialRequest = await this._createNewDbRequest(request, userId, imageUrls);
      const data = {
        ...initialRequest,
        messages: [],
        ...(requestId ? { id: requestId } : {}),
      };

      const result = await supabaseDb.explore_requests.create({
        data,
      });

      // Cache the individual request
      if (REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
        const cacheKey = `exploreRequest:${result.id}`;
        await this.redisService.set(cacheKey, result, CACHE_CONFIGS.SEARCH);

        // Invalidate list caches since we've added a new request
        await this.redisService.delByPattern(`exploreRequests:*`, CACHE_CONFIGS.SEARCH);
      }

      this.logService.info('Inserted request', { metadata: { requestId: result.id } });

      return await this.convertDbRequesttoRequest(result);
    } catch (error) {
      this.logService.error('Error inserting request', {
        metadata: { request, userId },
        error,
      });
      throw error;
    }
  }

  async clearCacheForRequest(requestId: string): Promise<void> {
    if (!REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
      return;
    }

    // Invalidate individual request cache
    const cacheKey = `exploreRequest:${requestId}`;
    await this.redisService.del(cacheKey, CACHE_CONFIGS.SEARCH);

    // Invalidate list caches that might contain this request
    await this.redisService.delByPattern(`exploreRequests:*`, CACHE_CONFIGS.SEARCH);
  }

  async listRequests(
    userId: string | undefined,
    page: number = 1,
    pageSize: number = 100,
    includeDevOnlyRequests: boolean = false,
  ): Promise<ExploreRequest[]> {
    try {
      const cacheKey = `exploreRequests:${
        userId || 'all'
      }:${page}:${pageSize}:${includeDevOnlyRequests}`;

      // Check cache first - specify the type as DbExploreRequest[]
      if (REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
        const cachedValue = await this.redisService.get<DbExploreRequest[]>(
          cacheKey,
          CACHE_CONFIGS.SEARCH,
        );
        if (cachedValue) {
          // Convert cached DB objects to ExploreRequests
          const cachedPromises = cachedValue.map(request =>
            this.convertDbRequesttoRequest(request).catch(error => {
              this.logService.error('Error converting request', {
                metadata: { requestId: request.id },
                error,
              });
              return null;
            }),
          );

          const convertedRequests = await Promise.all(cachedPromises);
          const cachedRequests = convertedRequests.filter((r): r is ExploreRequest => r !== null);

          // Start background refresh without awaiting it
          this.refreshListCacheInBackground(
            userId,
            page,
            pageSize,
            includeDevOnlyRequests,
            cacheKey,
          );
          return cachedRequests;
        }
      }

      const fetchRequestsTracker = this.perfService.start(
        'exploreRequestService.listRequests.fetchRequests',
      );
      const requests = await supabaseDb.explore_requests.findMany({
        where: {
          dev_is_deleted: false,
          ...(includeDevOnlyRequests ? {} : { dev_is_dev_only: false }),
          ...(userId ? { user_id: userId } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
      });
      this.perfService.end(fetchRequestsTracker);

      // const testPerfHandler = perf.start('exploreRequestService.listRequests.testBatched');
      // const chats = await supabaseDb.chats.findMany({
      //   where: {
      //     id: {
      //       in: requests.map(r => r.id),
      //     },
      //   },
      // });
      // console.log('chats', { metadata: { chats } });
      // perf.end(testPerfHandler);

      // Convert requests and attach order summaries
      const fetchChatHistoriesTracker = this.perfService.start(
        'exploreRequestService.listRequests.fetchChatHistories',
      );
      const chatHistories = await PersistedChatHistory.initMultipleChats(requests.map(r => r.id));
      this.perfService.end(fetchChatHistoriesTracker);

      const convertRequestsTracker = this.perfService.start(
        'exploreRequestService.listRequests.convertRequests',
      );
      const exploreRequests = await Promise.all(
        requests.map(async (request, index) => {
          try {
            return await this.convertDbRequesttoRequest(request, chatHistories[index]);
          } catch (error) {
            this.logService.error('Error converting request', {
              metadata: { requestId: request.id },
              error,
            });
            return null;
          }
        }),
      ).then(requests => requests.filter((r): r is ExploreRequest => r !== null));
      this.perfService.end(convertRequestsTracker);

      // Store raw DB objects in cache instead of converted requests
      if (REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
        await this.redisService.set(cacheKey, requests, CACHE_CONFIGS.SEARCH);
      }

      return exploreRequests;
    } catch (error) {
      this.logService.error('Error listing requests', { error });
      return [];
    }
  }

  private convertDbExploreRequestSummaryToExploreRequestSummary = (
    summary: Prisma.explore_requestsGetPayload<{
      select: {
        id: true;
        query: true;
        created_at: true;
        generated_title: true;
      };
    }>,
  ): ExploreRequestSummary => {
    return {
      id: summary.id,
      query: summary.query ?? '',
      createdAt: summary.created_at.toISOString(),
      generatedTitle: summary.generated_title ?? undefined,
    };
  };

  async listRequestSummaries(userId: string): Promise<ExploreRequestSummary[]> {
    const summaries = await supabaseDb.explore_requests.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        query: true,
        created_at: true,
        generated_title: true,
      },
    });
    return summaries.map(this.convertDbExploreRequestSummaryToExploreRequestSummary);
  }

  /**
   * Efficiently fetch generated titles for multiple chat IDs
   * Returns a map of chatId -> generatedTitle for quick lookup
   */
  async getGeneratedTitlesBatch(chatIds: string[]): Promise<Map<string, string>> {
    if (chatIds.length === 0) {
      return new Map();
    }

    const requests = await supabaseDb.explore_requests.findMany({
      where: {
        id: { in: chatIds },
      },
      select: {
        id: true,
        generated_title: true,
      },
    });

    const titlesMap = new Map<string, string>();
    requests.forEach(request => {
      if (request.generated_title) {
        titlesMap.set(request.id, request.generated_title);
      }
    });

    return titlesMap;
  }

  // Update the background refresh to maintain consistency
  private async refreshListCacheInBackground(
    userId: string | undefined,
    page: number,
    pageSize: number,
    includeDevOnlyRequests: boolean,
    cacheKey: string,
  ): Promise<void> {
    if (!REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
      return;
    }

    try {
      Promise.resolve().then(async () => {
        try {
          console.log(`[Time][Refresh List Cache] db query start: ${new Date().toISOString()}`, {
            metadata: { userId, page, pageSize, includeDevOnlyRequests },
          });
          const requests = await supabaseDb.explore_requests.findMany({
            where: {
              dev_is_deleted: false,
              ...(includeDevOnlyRequests ? {} : { dev_is_dev_only: false }),
              ...(userId ? { user_id: userId } : {}),
            },
            orderBy: { created_at: 'desc' },
            take: pageSize,
            skip: (page - 1) * pageSize,
          });

          console.log(`[Time][Refresh List Cache] db query end: ${new Date().toISOString()}`, {
            metadata: { userId, page, pageSize, includeDevOnlyRequests },
          });

          // Store raw DB objects in cache
          if (REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
            await this.redisService.set(cacheKey, requests, CACHE_CONFIGS.SEARCH);
          }

          console.log(`[Time][Refresh List Cache] cache set end: ${new Date().toISOString()}`, {
            metadata: { userId, page, pageSize, includeDevOnlyRequests },
          });
          this.logService.debug('Background list cache refresh completed', {
            metadata: {
              userId,
              page,
              pageSize,
              includeDevOnlyRequests,
              requestCount: requests.length,
            },
          });
        } catch (innerError) {
          this.logService.error('Error in background list refresh process', {
            metadata: { userId, page, pageSize, includeDevOnlyRequests },
            error: innerError,
          });
        }
      });
    } catch (error) {
      this.logService.error('Error initiating background list cache refresh', {
        metadata: { userId, page, pageSize, includeDevOnlyRequests },
        error,
      });
    }
  }

  async updateUserProfileFromRequest(requestId: string): Promise<void> {
    const exploreRequest = await this.getRequestOrFail(requestId);
    this.logService.info('Updating user style profile from new ordered chat', {
      metadata: { exploreRequest },
    });

    const user = await this.userService.getUserOrFail(exploreRequest.userId);

    this.logService.info('Existing user style profile', {
      metadata: { user: user.generatedProfileDescription?.description },
    });

    const exploreAgent = new ExploreAgent({
      chatId: exploreRequest.id,
      maxSteps: 10,
      userProfile: user,
      exploreRequest,
    });
    await exploreAgent.init();

    const { generalStyleInfo, purchaseSpecificInfo } =
      await this.openAIService.submitChatCompletion(
        [
          {
            role: 'system',
            content: `\
I will give you a chat between a user and a stylist alongside a style profile for the user. Your job is to:
1. Extract general style information to update the user's overall style profile
2. Extract purchase-specific information related to this particular shopping request

Keep any useful information from the existing profile while adding new insights. Do not remove any information from the existing profile.

The response has two parts:
- generalStyleInfo: Information about the user's overall style preferences, sizes, etc.
- purchaseSpecificInfo: Information specific to this purchase (occasion, specific preferences for this item/outfit)

Do not include product names in either section.
Do not include points that are already in the existing style profile.
Aim for less accurate points than more points.
    `,
          },
          {
            role: 'user',
            content: `My current style profile: ${user.generatedProfileDescription?.description}`,
          },
          ...(await exploreAgent.chatHistory.getOpenAiMessages()),
          {
            role: 'system',
            content: `Reminder: I gave you a chat between a user and a stylist alongside a style profile for the user. Your job was to extract both general style information and purchase-specific information.

Remember to provide:
- generalStyleInfo: Information about the user's overall style preferences, sizes, etc.
- purchaseSpecificInfo: Information specific to this purchase (occasion, specific preferences for this item/outfit)
    
Do not include points that are already in the existing style profile.
Do not include product names in the response.
    
Current style profile: ${user.generatedProfileDescription?.description}
    
Chat between user and stylist:
    `,
          },
        ],
        {
          model: OpenAIModel.O1,
          zodSchema: z.object({
            generalStyleInfo: z.string(),
            purchaseSpecificInfo: z.string(),
          }),
        },
      );

    this.logService.info('Extracted style information', {
      metadata: { generalStyleInfo, purchaseSpecificInfo },
    });

    // Check if profile has a Purchases section
    const hasPurchasesSection =
      user.generatedProfileDescription?.description?.includes('Purchases:');

    // Prepare updated profile content for merging
    const existingProfile = user.generatedProfileDescription?.description || '';
    let updatedProfile = existingProfile;

    if (hasPurchasesSection) {
      // Add the new purchase info to the existing purchases section
      updatedProfile = `${existingProfile}\n\nNew purchase: ${purchaseSpecificInfo}`;
    } else {
      // Create a new purchases section
      updatedProfile = `${existingProfile}\n\nPurchases:\n- ${purchaseSpecificInfo}`;
    }

    const { mergedProfile } = await this.openAIService.submitChatCompletion(
      [
        {
          role: 'system',
          content: `\
I will give you two style profiles. Your job is to merge them into a single cohesive profile that:
1. Contains all general style information without redundancy
2. Maintains a separate "Purchases" section at the end

Just merge points that are similar under the same point. Do not remove information.
ONLY MERGE. DO NOT REMOVE ANY INFORMATION.
Keep the Purchases section at the end of the profile.

Do not include any strings like "Merged Profile" or "Updated Profile" in the response. Just the profile.`,
        },
        {
          role: 'user',
          content: `Profile 1: ${updatedProfile}
    
Profile 2: ${generalStyleInfo}`,
        },
      ],
      {
        model: OpenAIModel.O1,
        zodSchema: z.object({
          mergedProfile: z.string(),
        }),
      },
    );

    this.logService.info('Merged profile', { metadata: { mergedProfile } });

    this.logService.info('Style Profile Update Summary', {
      metadata: {
        user: user.id,
        existingProfile: user.generatedProfileDescription?.description,
        mergedProfile,
        generalStyleInfo,
        purchaseSpecificInfo,
      },
    });

    await this.userService.updateUserGeneratedProfile(user.id, mergedProfile);
  }

  async markRequestAsDeleted(requestId: string): Promise<void> {
    await supabaseDb.explore_requests.update({
      where: { id: requestId },
      data: { dev_is_deleted: true },
    });

    // Invalidate individual request cache
    if (REDIS_ENABLED_FOR_EXPLORE_REQUEST_SERVICE) {
      const cacheKey = `exploreRequest:${requestId}`;
      await this.redisService.del(cacheKey, CACHE_CONFIGS.SEARCH);

      // Invalidate list caches
      await this.redisService.delByPattern(`exploreRequests:*`, CACHE_CONFIGS.SEARCH);
    }
  }

  private async convertDbRequesttoRequest(
    requestModel: DbExploreRequest,
    chatHistory?: PersistedChatHistory,
  ): Promise<ExploreRequest> {
    if (!requestModel.query) {
      this.logService.critical('Request query is null', {
        metadata: { requestModel },
      });
    }

    if (!chatHistory) {
      chatHistory = new PersistedChatHistory(requestModel.id);
      await chatHistory.init(undefined, true);
    }

    const initialMessages = chatHistory.getMessages();

    const nonPromptMessages = initialMessages.slice(2);
    const exploreMessages = convertFetchrMessagesToExploreMessages(nonPromptMessages);

    return {
      id: requestModel.id,
      userId: requestModel.user_id,
      query: requestModel.query ?? '',
      brandIds: requestModel.brand_ids,
      category: requestModel.category
        ? convertDbCategoryToCategory(requestModel.category)
        : undefined,
      gender: convertDbGenderToGender(requestModel.gender),
      generatedTitle: requestModel.generated_title ?? undefined,
      createdAt: requestModel.created_at.toISOString(),
      devIsDevOnly: requestModel.dev_is_dev_only,
      devIsDeleted: requestModel.dev_is_deleted,
      messages: exploreMessages,
      requestType: requestModel.request_type
        ? convertDbExploreRequestTypeToExploreRequestType(requestModel.request_type)
        : undefined,
      productId: requestModel.product_id ?? undefined,
    };
  }
}
