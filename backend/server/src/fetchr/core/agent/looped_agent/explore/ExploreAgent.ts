import { LoopedAgentConfig, ProcessToolResult, RunStepResultChunk } from '../LoopedAgent';

import {
  getGroqService,
  getOpenAIService,
  getPerfService,
  getProductPreferenceService,
  getProductSearchService,
} from '../../../../core/lazyServices';
import { LoopedAgent } from '../LoopedAgent';
import { ToolUsageRequestType } from '../../../chat/types';
import {
  ExploreRequest,
  PreferenceType,
  ProductWithScore,
  SearchMethod,
  UserProfile,
} from '@fetchr/schema/base/base';
import { convertExploreRequestTypeToDbExploreRequestType } from '../../../../../shared/converters';
import {
  SuggestProductsToUserRequestPayload,
  SuggestProductsToUserTool,
} from '../../../chat/tools/explore/suggest_products_to_user_tool';
import {
  MessageUserRequestPayload,
  MessageUserTool,
} from '../../../chat/tools/explore/message_user_tool';
import { FinishFindingProductTool } from '../../../chat/tools/explore/finish_finding_product_tool';
import { ExploreDifferentStylesRequestPayload } from '../../../chat/tools/explore/explore_different_styles_tool';
import { PersistedChatHistory } from '../../../chat/chatHistory';
import { ExecutingOutsideResponsePayload } from '../../../chat/tools/common_tools';
import { OpenAIModel } from '@fetchr/schema/core/core';
import { z } from 'zod';
import { logService } from '../../../../base/logging/logService';
import { getFirstTwoMessages } from '../../../../modules/explore/utils';

export class ExploreAgent extends LoopedAgent {
  protected override tools = [
    SuggestProductsToUserTool,
    MessageUserTool,
    FinishFindingProductTool,
    // SuggestStylesToUserTool,
  ];

  private userProfile: UserProfile;
  private exploreRequest: ExploreRequest;

  constructor(
    config: LoopedAgentConfig & {
      userProfile: UserProfile;
      exploreRequest: ExploreRequest;
    },
  ) {
    super({ ...config, name: 'ExploreAgent' });
    this.userProfile = config.userProfile;
    this.exploreRequest = config.exploreRequest;
    logService.info(
      `ExploreAgent constructed with tools: ${this.tools.join(', ')}. Waiting for initialization`,
      {
        metadata: {
          config,
          tools: this.tools.map(t => String(t)),
        },
        serviceName: 'ExploreAgent',
      },
    );
  }

  override async init(): Promise<void> {
    await super.init();
    logService.info('Initializing ExploreAgent', {
      metadata: {
        requestType: this.exploreRequest.requestType
          ? convertExploreRequestTypeToDbExploreRequestType(this.exploreRequest.requestType)
          : undefined,
        messages: this.chatHistory.getMessages(),
      },
      serviceName: 'ExploreAgent',
    });

    if (this.chatHistory.getMessages().length === 0) {
      const firstTwoMessages = await getFirstTwoMessages(this.exploreRequest, this.userProfile);

      this.chatHistory.addMessage(firstTwoMessages.systemMessage);
      this.chatHistory.addMessage(firstTwoMessages.firstUserMessage);
    } else {
      const firstTwoMessages = await getFirstTwoMessages(this.exploreRequest, this.userProfile);

      // Override first two messages
      this.chatHistory.messages[0] = firstTwoMessages.systemMessage;
      this.chatHistory.messages[1] = firstTwoMessages.firstUserMessage;

      await this.chatHistory.updateMessagesInDb(true);
    }
    logService.info('ExploreAgent initialized', {
      metadata: {
        messages: this.chatHistory.getMessages(),
      },
      serviceName: 'ExploreAgent',
    });
  }

  override async *processToolUsageRequest(
    toolUsageRequest: ToolUsageRequestType,
  ): AsyncGenerator<ProcessToolResult> {
    const perfService = await getPerfService();
    const productPreferenceService = await getProductPreferenceService();
    const productSearchService = await getProductSearchService();
    const openAIService = await getOpenAIService();
    void openAIService;
    const groqService = await getGroqService();
    void groqService;
    const perfHandle = perfService.start(
      `ExploreAgent.processToolUsageRequest.${toolUsageRequest.name}`,
    );
    try {
      logService.info(`Calling tool ${toolUsageRequest.name}`, {
        metadata: {
          toolUsage: toolUsageRequest,
        },
        serviceName: 'ExploreAgent',
      });
      const tool = this.tools.find(t => t.functionSchema.name === toolUsageRequest.name);
      if (!tool) {
        logService.error(`Tool ${toolUsageRequest.name} not found`, {
          metadata: { toolUsage: toolUsageRequest },
          serviceName: 'ExploreAgent',
        });
        yield { outcome: 'tool_not_found', request: toolUsageRequest };
        return;
      }
      switch (toolUsageRequest.name) {
        case 'suggest_products_to_user': {
          yield {
            outcome: 'status_update',
            status: 'Finding products...',
          };

          const suggestProductsToUserPayload =
            toolUsageRequest.payload as SuggestProductsToUserRequestPayload;

          const findProductsUsingQueriesAndProductPreferences = async function* (
            exploreRequest: ExploreRequest,
            chatHistory: PersistedChatHistory,
            retries: number = 3,
          ): AsyncGenerator<ProcessToolResult> {
            try {
              logService.info('Searching for products using queries and product preferences', {
                metadata: {
                  searchQueries: suggestProductsToUserPayload.searchQueries.map(
                    query => query.query,
                  ),
                },
                serviceName: 'ExploreAgent',
              });

              const productPreferences =
                await productPreferenceService.getProductPreferencesForRequest(exploreRequest);

              // const productImagePreferences =
              //   await imagePreferenceService.getImagePreferencesForRequest(exploreRequest.id);

              // logService.info(`Got ${productImagePreferences.length} image preferences for request`, {
              //   metadata: {
              //     productImagePreferences,
              //   },
              //   serviceName: 'ExploreAgent',
              // });

              // logService.info('Unranked pulled products for suggestions', {
              //   metadata: {
              //     productPreferences,
              //   },
              //   serviceName: 'ExploreAgent',
              // });

              const productSearchService = await getProductSearchService();

              const { rankedProducts } =
                await productSearchService.findProductsUsingQueriesAndPreferences(
                  suggestProductsToUserPayload.searchQueries.map(query => ({
                    query: query.query,
                    minPrice: undefined,
                    maxPrice: undefined,
                    category: undefined,
                    topK: 20,
                    searchMethod:
                      SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN,
                    gender: exploreRequest.gender,
                    brandIds: [],
                    productIdWhitelist: [],
                    productIdBlacklist: [],
                  })),
                  {
                    exploreRequest: exploreRequest,
                    productPreferences: [],
                    productImagePreferences: [],
                    // productPreferences: productPreferences,
                    // productImagePreferences: productImagePreferences,
                    seenProductIds: [],
                    lastCohort: 0,
                    rerankSearchMethod:
                      SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN,
                    requestId: exploreRequest.id,
                  },
                );

              logService.info('Ranked products for suggestions', {
                metadata: {
                  rankedProducts,
                },
                serviceName: 'ExploreAgent',
              });

              yield {
                outcome: 'status_update',
                status: 'Filtering products...',
              };

              let finalProducts: ProductWithScore[] = [];

              const filterProductsPerfHandle = perfService.start(
                'ExploreAgent.processToolUsageRequest.suggest_products_to_user.filterProducts',
              );
              try {
                const initialProductCount = rankedProducts.length;
                const filteredProducts = rankedProducts.filter(
                  product =>
                    !productPreferences.some(
                      preference =>
                        preference.preference?.productId === product.product?.id &&
                        (preference.preference?.preferenceType === PreferenceType.DISLIKE ||
                          preference.preference?.preferenceType === PreferenceType.LIKE ||
                          preference.preference?.preferenceType === PreferenceType.SUPERLIKE),
                    ),
                );

                logService.info('Previous preferences', {
                  metadata: {
                    productPreferences,
                  },
                  serviceName: 'ExploreAgent',
                });

                // Log details of filtered vs remaining products
                logService.info('Product filtering details:', {
                  metadata: {
                    filteredOut: rankedProducts
                      .filter(product =>
                        productPreferences.some(
                          preference =>
                            preference.preference?.productId === product.product?.id &&
                            (preference.preference?.preferenceType === PreferenceType.DISLIKE ||
                              preference.preference?.preferenceType === PreferenceType.LIKE ||
                              preference.preference?.preferenceType === PreferenceType.SUPERLIKE),
                        ),
                      )
                      .map(product => ({
                        id: product.product?.id,
                        name: product.product?.name,
                      })),
                    remaining: filteredProducts.map(product => ({
                      id: product.product?.id,
                      name: product.product?.name,
                    })),
                  },
                  serviceName: 'ExploreAgent',
                });

                const removedProductsCount = initialProductCount - filteredProducts.length;
                logService.info(`Filtered out ${removedProductsCount} disliked products`, {
                  metadata: {
                    initialCount: initialProductCount,
                    filteredCount: filteredProducts.length,
                    removedCount: removedProductsCount,
                  },
                  serviceName: 'ExploreAgent',
                });

                finalProducts = (
                  await Promise.all(
                    filteredProducts.slice(0, 20).map(async candidate => {
                      try {
                        const tempProductFilteringChatHistory =
                          await chatHistory.cloneIntoTemporaryChatHistory();

                        try {
                          // If the tool use request is still pending, add the tool result
                          if (
                            tempProductFilteringChatHistory.getToolUsageIdForPendingToolUseResponse(
                              'suggest_products_to_user',
                            ) === toolUsageRequest.id
                          ) {
                            await tempProductFilteringChatHistory.addToolResult(
                              new ExecutingOutsideResponsePayload(),
                              toolUsageRequest.id,
                            );
                          }
                        } catch (error) {
                          logService.info(`Error adding tool result: ${candidate.product?.name}`, {
                            metadata: { error, product: candidate },
                            serviceName: 'ExploreAgent',
                          });
                        }

                        tempProductFilteringChatHistory.addMessage({
                          role: 'user',
                          content: `I am the user's assitant. I found this product using your search:
\n${candidate.product?.name} (${candidate.product?.id}):\n${candidate.product?.fullGeneratedDescription}\n
Does this product meet the user's requirments mentioned in their chat so far?

Return false if:
- It has already been suggested?
- It does not match the styles / products they have liked & matches styles / products they have disliked
- They have mentioned some specific requirement in chat that this product does not meet
- It is not correct for the user's occassion (ie: too formal, too casual, too dressy - if applicable)
- It does not match what you've told the user you will find for them on your last message to them using message_user tool

General guidelines:
- Ignore price

If you're unsure, default to false.`,
                        });

                        let keep = true;
                        let reason = 'Defaulting to keep due to timeout';

                        try {
                          const result = await Promise.race([
                            openAIService.submitChatCompletion(
                              await tempProductFilteringChatHistory.getOpenAiMessages(),
                              {
                                model: OpenAIModel.GPT_4_1_MINI,
                                zodSchema: z.object({
                                  reason: z.string(),
                                  keep: z.boolean(),
                                }),
                              },
                            ),
                            new Promise<{ keep: boolean; reason: string }>(resolve =>
                              setTimeout(
                                () => resolve({ keep: false, reason: 'Timed out after 2s' }),
                                3000,
                              ),
                            ),
                          ]);

                          keep = result.keep;
                          reason = result.reason;
                        } catch (error) {
                          logService.error('Error during product filtering decision', {
                            metadata: { error, product: candidate?.product?.id },
                            serviceName: 'ExploreAgent',
                          });
                        }

                        logService.info(
                          `${keep ? 'Keeping product' : 'Removing product'}: ${
                            candidate.product?.name
                          }`,
                          {
                            metadata: { keep, product: candidate, reason },
                            serviceName: 'ExploreAgent',
                          },
                        );
                        if (keep) {
                          return candidate;
                        }
                      } catch (error) {
                        logService.error(`Error filtering product: ${candidate.product?.name}`, {
                          metadata: { error, product: candidate },
                          serviceName: 'ExploreAgent',
                        });
                        return undefined;
                      }
                    }),
                  )
                ).filter(p => p !== undefined);
                // const finalProducts = filteredProducts;

                if (finalProducts.length < 6) {
                  chatHistory.addMessage({
                    role: 'system',
                    content: `We were only able to find ${finalProducts.length} new products for this search matching the user's requirments.
We will now suggest the remaining products to the user, but keep this in mind (we might be running out of products for the queries you mentioned in our initial database of items).
                    `,
                  });
                }

                logService.info(
                  'Adding filtered ranked products metadata to suggest products to user tool',
                  {
                    metadata: {
                      rankedProducts: finalProducts.slice(0, 6).map(p => p.product?.id),
                      unrankedProducts: [],
                    },
                    serviceName: 'ExploreAgent',
                  },
                );
              } finally {
                perfService.end(filterProductsPerfHandle);
              }

              if (finalProducts.length === 0) {
                logService.info(
                  `No products found for suggest products to user tool using queries: ${suggestProductsToUserPayload.searchQueries.map(
                    q => q.query,
                  )}`,
                  {
                    metadata: {
                      queries: suggestProductsToUserPayload.searchQueries,
                    },
                    serviceName: 'ExploreAgent',
                  },
                );

                return {
                  outcome: 'tool_execution_failed',
                  message: `No products found matching your search criteria.
Note: We currently only support clothing items - if they are searching for
non-clothing items like electronics or home goods, let them know we cannot help with those categories.`,
                };
              }

              await chatHistory.addMetadataToToolUseRequest(toolUsageRequest.id, {
                rankedProducts: finalProducts.slice(0, 6),
                unrankedProducts: [],
              });

              const pendingExternalToolUsageRequest = chatHistory.getToolUsageRequest(
                toolUsageRequest.id,
              );

              if (!pendingExternalToolUsageRequest) {
                logService.error(
                  'No pending external tool usage request found after adding metadata to suggest products to user tool',
                  {
                    metadata: { toolUsageRequest },
                    serviceName: 'ExploreAgent',
                  },
                );
                yield {
                  outcome: 'error',
                  message:
                    'Internal error in the system trying to run the suggest products to user tool',
                };
                return;
              }

              yield {
                outcome: 'tool_execution_outside_silent',
                request: pendingExternalToolUsageRequest,
              };
              return;
            } catch (error) {
              console.error('[Error]', error);
              logService.error('Error finding products using queries and product preferences', {
                metadata: { queries: suggestProductsToUserPayload.searchQueries },
                error,
                serviceName: 'ExploreAgent',
              });
              if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 30));
                return findProductsUsingQueriesAndProductPreferences(
                  exploreRequest,
                  chatHistory,
                  retries - 1,
                );
              }
              return {
                outcome: 'tool_execution_failed',
                message: 'Error finding products using queries and product preferences',
              };
            }
          };

          yield* findProductsUsingQueriesAndProductPreferences(
            this.exploreRequest,
            this.chatHistory,
          );
          return;
        }
        case 'explore_different_styles': {
          yield {
            outcome: 'status_update',
            status: 'Finding your style...',
          };

          const exploreDifferentStylesPayload =
            toolUsageRequest.payload as ExploreDifferentStylesRequestPayload;

          const findProductsUsingStyleQueries = async (retries: number = 3): Promise<boolean> => {
            try {
              logService.info('Searching for products using queries and product preferences', {
                metadata: {
                  styleQueries: exploreDifferentStylesPayload.styleQueries,
                },
                serviceName: 'ExploreAgent',
              });

              // const productImagePreferences =
              //   await imagePreferenceService.getImagePreferencesForRequest(this.exploreRequest.id);

              // logService.info(`Got ${productImagePreferences.length} image preferences for request`, {
              //   metadata: {
              //     productImagePreferences,
              //   },
              //   serviceName: 'ExploreAgent',
              // });

              const { rankedProducts } =
                await productSearchService.findProductsUsingQueriesAndPreferences(
                  exploreDifferentStylesPayload.styleQueries.map(query => ({
                    query: query,
                    minPrice: 0,
                    maxPrice: 1000,
                    category: this.exploreRequest.category,
                    topK: 20,
                    searchMethod:
                      SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN,
                    gender: this.exploreRequest.gender,
                    brandIds: [],
                    productIdWhitelist: [],
                    productIdBlacklist: [],
                  })),
                  {
                    exploreRequest: this.exploreRequest,
                    productPreferences: [],
                    // productImagePreferences: productImagePreferences,
                    productImagePreferences: [],
                    seenProductIds: [],
                    lastCohort: 0,
                    rerankSearchMethod:
                      SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE_CLEAN,
                    requestId: this.exploreRequest.id,
                  },
                );

              // Filter out disliked & liked products
              const productPreferences =
                await productPreferenceService.getProductPreferencesForRequest(this.exploreRequest);

              logService.info('Previous preferences', {
                metadata: {
                  productPreferences,
                },
                serviceName: 'ExploreAgent',
              });

              const initialProductCount = rankedProducts.length;
              const filteredProducts = rankedProducts.filter(
                product =>
                  !productPreferences.some(
                    preference =>
                      preference.preference?.productId === product.product?.id &&
                      (preference.preference?.preferenceType === PreferenceType.DISLIKE ||
                        preference.preference?.preferenceType === PreferenceType.LIKE ||
                        preference.preference?.preferenceType === PreferenceType.SUPERLIKE),
                  ),
              );

              const removedProductsCount = initialProductCount - filteredProducts.length;
              logService.info(`Filtered out ${removedProductsCount} disliked products`, {
                metadata: {
                  initialCount: initialProductCount,
                  filteredCount: filteredProducts.length,
                  removedCount: removedProductsCount,
                },
                serviceName: 'ExploreAgent',
              });

              // Log details of filtered vs remaining products
              logService.info('Product filtering details:', {
                metadata: {
                  filteredOut: rankedProducts
                    .filter(product =>
                      productPreferences.some(
                        preference =>
                          preference.preference?.productId === product.product?.id &&
                          (preference.preference?.preferenceType === PreferenceType.DISLIKE ||
                            preference.preference?.preferenceType === PreferenceType.LIKE ||
                            preference.preference?.preferenceType === PreferenceType.SUPERLIKE),
                      ),
                    )
                    .map(product => ({
                      id: product.product?.id,
                      name: product.product?.name,
                    })),
                  remaining: filteredProducts.map(product => ({
                    id: product.product?.id,
                    name: product.product?.name,
                  })),
                },
                serviceName: 'ExploreAgent',
              });

              const finalProducts = filteredProducts;

              await this.chatHistory.addMetadataToToolUseRequest(toolUsageRequest.id, {
                rankedProducts: finalProducts,
                unrankedProducts: [],
              });

              return true;
            } catch (error) {
              console.error('[Error]', error);
              logService.error('Error finding products using style queries', {
                metadata: { error, styleQueries: exploreDifferentStylesPayload.styleQueries },
                serviceName: 'ExploreAgent',
              });
              if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 30));
                return findProductsUsingStyleQueries(retries - 1);
              }
              return false;
            }
          };

          const findStylesSuccess = await findProductsUsingStyleQueries();
          if (!findStylesSuccess) {
            yield {
              outcome: 'tool_execution_failed',
              message: 'Can not find products using style queries',
            };
            return;
          }

          const pendingExternalToolUsageRequest = this.chatHistory.getToolUsageRequest(
            toolUsageRequest.id,
          );

          if (!pendingExternalToolUsageRequest) {
            logService.error('No pending external tool usage request found', {
              metadata: { toolUsageRequest },
              serviceName: 'ExploreAgent',
            });
            yield { outcome: 'tool_not_found', request: toolUsageRequest };
            return;
          }

          logService.debug('Suggesting products to search', {
            metadata: {
              styleQueries: exploreDifferentStylesPayload.styleQueries,
            },
            serviceName: 'ExploreAgent',
          });
          this.markComplete();
          yield {
            outcome: 'tool_execution_outside_silent',
            request: pendingExternalToolUsageRequest,
          };
          return;
        }
        case 'view_product_image':
          yield { outcome: 'tool_not_found', request: toolUsageRequest };
          return;
        case 'suggest_styles_to_user': {
          logService.error('suggest_styles_to_user is a passive tool. You cannot use it.', {
            metadata: { toolUsage: toolUsageRequest },
            serviceName: 'ExploreAgent',
          });
          yield {
            outcome: 'tool_execution_failed',
            message: 'suggest_styles_to_user is a passive tool. You cannot use it.',
          };
          return;
        }
        /*
      case: ask user -> Some how terminate and ping above
      Save execution context + remove some information

      For some tools you want to have termporary messages that go away after a bit.
      */
        case 'message_user': {
          const messageUserPayload = toolUsageRequest.payload as MessageUserRequestPayload;
          if (messageUserPayload.blocking || messageUserPayload.suggestedResponses?.length) {
            if (
              messageUserPayload.suggestedResponses &&
              messageUserPayload.suggestedResponses.length > 5
            ) {
              logService.error('Too many suggested responses provided', {
                metadata: {
                  suggestedResponsesCount: messageUserPayload.suggestedResponses.length,
                  maxAllowed: 5,
                },
                serviceName: 'ExploreAgent',
              });

              yield {
                outcome: 'tool_execution_failed',
                message: 'Too many suggested responses provided. Maximum allowed is 5.',
              };
              return;
            }
            this.markComplete();
            yield { outcome: 'tool_execution_outside', request: toolUsageRequest };
            return;
          }
          // yield {
          //   outcome: 'status_update',
          //   status: 'Finding products...',
          // };
          yield { outcome: 'tool_execution_non_blocking', request: toolUsageRequest };
          return;
        }
        case 'finish_finding_product': {
          const pendingExternalToolUsageRequest = this.chatHistory.getToolUsageRequest(
            toolUsageRequest.id,
          );
          if (!pendingExternalToolUsageRequest) {
            logService.error('No pending external tool usage request found', {
              metadata: { toolUsageRequest },
              serviceName: 'ExploreAgent',
            });
            yield { outcome: 'tool_not_found', request: toolUsageRequest };
            return;
          }
          this.markComplete();
          yield {
            outcome: 'tool_execution_outside_silent',
            request: pendingExternalToolUsageRequest,
          };
          return;
        }

        default:
          logService.error(`Tool processing for ${toolUsageRequest.name} not implemented`, {
            metadata: { toolUsage: toolUsageRequest },
            serviceName: 'ExploreAgent',
          });
          yield { outcome: 'tool_not_found', request: toolUsageRequest };
          return;
      }
    } finally {
      perfService.end(perfHandle);
    }
  }

  override async *processOutput(output: string): AsyncGenerator<RunStepResultChunk> {
    this.addMessage({
      role: 'assistant',
      content: output,
    });

    yield {
      status: 'error',
      error: new Error(
        'Output response is not supported (your message was not sent to the user). Instead use the message_user tool to send a message to the user.',
      ),
      shouldContinueAgent: true,
    };
  }
}

// When adding tools: Add to the tools array, make sure it's enabled then process it in processToolUsage
// When adding message type: Add to the ExploreRequest types in proto, update the type converters in utils and
//     make explore agent process it properly in the converters too.
