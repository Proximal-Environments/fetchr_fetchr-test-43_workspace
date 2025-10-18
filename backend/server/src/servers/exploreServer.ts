import {
  productSearchService,
  userService,
  exploreRequestService,
  productService,
  productPreferenceService,
  exploreService,
  imagePreferenceService,
  productImageService,
  perf,
} from '../fetchr/base/service_injection/global';
import {
  PreferenceType,
  ProductWithSearchQueryAndPreference,
  SearchMethod,
  SearchQuery,
  UserRole,
} from '@fetchr/schema/base/base';
import {
  CreateExploreRequestRequest,
  CreateExploreRequestResponse,
  SubmitPreferenceRequest,
  SubmitPreferenceResponse,
  DeleteCohortRequest,
  DeleteCohortResponse,
  GetExploreRequestRequest,
  GetExploreRequestResponse,
  ListExploreRequestsRequest,
  ListExploreRequestsResponse,
  DuplicateExploreRequestRequest,
  DuplicateExploreRequestResponse,
  DeleteExploreRequestRequest,
  DeleteExploreRequestResponse,
  StyleGenerationRequest,
  StyleGenerationResponse,
  SearchProductsAtCohortRequest,
  SearchProductsAtCohortResponse,
  CohortData,
  ProcessMessageRequest,
  ProcessMessageResponse,
  AdminListAllExploreRequestsResponse,
  AdminListAllExploreRequestsRequest,
  SubmitImagePreferenceRequest,
  SubmitImagePreferenceResponse,
  FinalizeImagePreferencesRequest,
  FinalizeImagePreferencesResponse,
  ListExploreRequestSummariesRequest,
  ListExploreRequestSummariesResponse,
  ReplyToChatRequest,
  ReplyToChatResponse,
} from '@fetchr/schema/explore/explore';
import { ExploreServiceImplementation } from '@fetchr/schema/explore/explore';
import { PersistedChatHistory } from '../fetchr/core/chat/chatHistory';
import { SuggestProductsToUserResponsePayload } from '../fetchr/core/chat/tools/explore/suggest_products_to_user_tool';
import { getRequestUser } from '../fetchr/base/logging/requestContext';
import { convertUserRoleToDbRole } from '../shared/converters';
import { SuggestStylesToUserResponsePayload } from '../fetchr/core/chat/tools/explore/suggest_styles_to_user_tool';
import { CallContext } from 'nice-grpc-common';
import { logService } from '../fetchr/base/logging/logService';

export class ExploreServer implements ExploreServiceImplementation {
  async *createExploreRequest(
    request: CreateExploreRequestRequest,
  ): AsyncGenerator<CreateExploreRequestResponse> {
    yield* exploreService.createExploreRequest(request);
  }

  async *processMessage(request: ProcessMessageRequest): AsyncGenerator<ProcessMessageResponse> {
    try {
      logService.info('Received message request:', {
        metadata: { request },
      });

      yield* exploreService.processMessage(request);
    } catch (error) {
      logService.error(
        `Error in processMessage: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      throw error;
    }
  }

  async submitImagePreference(
    request: SubmitImagePreferenceRequest,
  ): Promise<SubmitImagePreferenceResponse> {
    return perf.track('submitImagePreference', async () => {
      try {
        logService.info('Received image preference request:', {
          metadata: { request },
        });

        const user = getRequestUser();
        if (!user) {
          throw new Error('User not logged in when submitting image preference.');
        }

        const likedImages = request.preferenceItems.filter(
          item => item.preferenceType === PreferenceType.LIKE,
        );

        await Promise.all(
          likedImages.map(async image => {
            await productImageService.insertProductImageFromExternalUrl(image.imageUrl);
          }),
        );

        await imagePreferenceService.batchUpdateImagePreferencesFromSwipes(
          request.requestId,
          user.id,
          request.preferenceItems,
        );

        return {
          message: 'successful',
        };
      } catch (error) {
        logService.error('Error in submitImagePreference', { error });
        throw error;
      }
    });
  }

  async finalizeImagePreferences(
    request: FinalizeImagePreferencesRequest,
  ): Promise<FinalizeImagePreferencesResponse> {
    return perf.track('finalizeImagePreferences', async () => {
      try {
        const chatHistoryNew = new PersistedChatHistory(request.requestId);
        await chatHistoryNew.init(false, false);
        const existingResponse = chatHistoryNew.getToolUsageResponse(request.toolId);
        if (!existingResponse) {
          await chatHistoryNew.addToolResult(
            new SuggestStylesToUserResponsePayload({ imagePreferences: [] }),
            request.toolId,
          );
        }

        const preferenceItems = await imagePreferenceService.getImagePreferencesForRequest(
          request.requestId,
        );

        logService.info('Preference items pulled when finalizing image preferences:', {
          metadata: { preferenceItems },
        });

        const likedImages = preferenceItems.filter(
          item => item.imagePreferenceItem?.preferenceType === PreferenceType.LIKE,
        );

        logService.info('Liked images:', { metadata: { likedImages } });

        const likedItemsWithStyles = (
          await Promise.all(
            likedImages.map(async item => {
              // Ensure imageUrl is not undefined before passing to the service
              const imageUrl = item.imagePreferenceItem?.imageUrl;
              if (!imageUrl) {
                return undefined;
              }

              const image = await productImageService.getImageAndWaitForStyleIfProcessing(imageUrl);
              return {
                preferenceItem: item,
                style: image?.style,
              };
            }),
          )
        ).filter(
          item =>
            item?.style !== undefined &&
            item?.preferenceItem &&
            item?.preferenceItem.imagePreferenceItem &&
            item?.preferenceItem.imagePreferenceItem.imageUrl,
        ) as {
          preferenceItem: (typeof likedImages)[number];
          style: string;
        }[];

        logService.info('Liked items with styles:', { metadata: { likedItemsWithStyles } });

        await chatHistoryNew.updateToolUsageResponsePayload(
          request.toolId,
          async (payload: SuggestStylesToUserResponsePayload) => {
            payload.addImagePreferences(
              likedItemsWithStyles.map(item => ({
                imagePreferenceItem: {
                  imageUrl: item.preferenceItem.imagePreferenceItem?.imageUrl || '',
                  preferenceType:
                    item.preferenceItem.imagePreferenceItem?.preferenceType || PreferenceType.LIKE,
                },
                style: item.style,
              })),
            );
          },
        );

        logService.info('Received finalize image preferences request:', {
          metadata: { request },
        });

        return {
          message: 'successful',
        };
      } catch (error) {
        logService.error('Error in finalizeImagePreferences', { error });
        throw error;
      }
    });
  }

  async submitProductPreference(
    request: SubmitPreferenceRequest,
  ): Promise<SubmitPreferenceResponse> {
    return perf.track('submitProductPreference', async () => {
      try {
        logService.info('Received preference request:', {
          metadata: { request },
        });

        // Submit on the db
        productPreferenceService.batchUpdateProductPreferencesFromSwipes(
          request.requestId,
          request.preferenceItems.map(pref => ({
            productId: pref.itemId,
            preferenceType: pref.preferenceType,
            comments: pref.comments,
          })),
        );

        const chatHistory = new PersistedChatHistory(request.requestId);
        await chatHistory.init(false, false);

        const existingResponse = chatHistory.getToolUsageResponse(request.toolId);
        if (!existingResponse) {
          await chatHistory.addToolResult(
            new SuggestProductsToUserResponsePayload({ productPreferences: [] }),
            request.toolId,
          );
        }

        await chatHistory.updateToolUsageResponsePayload(
          request.toolId,
          async (payload: SuggestProductsToUserResponsePayload) => {
            const PopulatedProductPreferenceItems = await Promise.all(
              request.preferenceItems.map(pref =>
                productPreferenceService.populateProductPreference(pref, request.requestId),
              ),
            );
            payload.addProductPreferences(PopulatedProductPreferenceItems);
          },
        );

        return {
          message: 'successful',
        };
      } catch (error) {
        logService.error('Error in submit_product_preference:', {
          error: error as Error,
          metadata: {
            method: 'submitProductPreference',
          },
          serviceName: 'ExploreServer',
        });
        throw error;
      }
    });
  }

  async deleteProductPreferenceCohort(request: DeleteCohortRequest): Promise<DeleteCohortResponse> {
    try {
      const exploreRequest = await exploreRequestService.getRequestOrFail(request.requestId);
      await productPreferenceService.deleteProductPreferencesForRequest(
        exploreRequest,
        request.cohort,
      );
      return { message: 'successful' };
    } catch (error) {
      logService.error('Error in delete_product_preference_cohort:', {
        error: error as Error,
        metadata: {
          method: 'deleteProductPreferenceCohort',
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }

  async getExploreRequest(request: GetExploreRequestRequest): Promise<GetExploreRequestResponse> {
    try {
      const exploreRequest = await exploreRequestService.getRequestOrFail(request.requestId);
      const exploreUserId = exploreRequest.userId;
      const user = getRequestUser();
      if (
        !user ||
        (user.id !== exploreUserId &&
          user.role !== UserRole.USER_ROLE_ADMIN &&
          user.role !== UserRole.USER_ROLE_STYLIST)
      ) {
        logService.info('User tried to access explore request without permission', {
          metadata: {
            requestId: request.requestId,
            exploreUserId: exploreUserId,
            userId: user?.id,
          },
        });
        throw new Error('User does not have access to this request in getExploreRequest');
      }

      logService.info('Retrieved explore request:', {
        metadata: { exploreRequest },
      });

      const userPreferences = await productPreferenceService.getProductPreferencesForRequest(
        exploreRequest,
      );

      logService.info('Retrieved user preferences:', {
        metadata: { userPreferences },
      });

      // Organize preferences by cohort
      const cohorts: Record<number, CohortData> = {};
      const products = await productService.getProductsInParallel(
        userPreferences.map(pref => pref.productDetails?.id).filter(product => product) as string[],
      );

      logService.info('Retrieved products:', {
        metadata: { products },
      });

      for (const preference of userPreferences) {
        if (!preference.productDetails || !preference.preference?.query) {
          continue;
        }

        // Ensure cohort is always a number, default to 1 if undefined
        const cohortNumber =
          typeof preference.preference.cohort === 'number'
            ? preference.preference.cohort
            : preference.preference.cohort
            ? Number(preference.preference.cohort)
            : 1;

        if (!cohorts[cohortNumber]) {
          cohorts[cohortNumber] = {
            products: [],
            intermediateQueries: [],
            unrankedProducts: [],
          };
        }

        // Find product from the pre-fetched products list
        const product = products.find(p => p.id === preference.productDetails?.id);
        if (!product) {
          continue;
        }

        const productWithQueryAndPreference: ProductWithSearchQueryAndPreference = {
          product,
          query: preference.preference?.query,
          preferenceItem: {
            itemId: product.id,
            preferenceType: preference.preference?.preferenceType ?? PreferenceType.UNSPECIFIED,
            comments: preference.preference?.comments,
          },
        };

        cohorts[cohortNumber].products.push(productWithQueryAndPreference);
        if (!cohorts[cohortNumber].intermediateQueries.includes(preference.preference?.query)) {
          cohorts[cohortNumber].intermediateQueries.push(preference.preference?.query);
        }
      }

      return {
        request: exploreRequest,
        cohorts,
      };
    } catch (error) {
      logService.error('Error in get_explore_request:', {
        error: error as Error,
        metadata: {
          method: 'getExploreRequest',
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }

  async listExploreRequests(
    request: ListExploreRequestsRequest,
  ): Promise<ListExploreRequestsResponse> {
    try {
      return perf.track('listExploreRequests', async () => {
        const userId = getRequestUser()?.id;
        if (!userId) {
          throw new Error('User not logged in when listing explore requests.');
        }

        logService.info('Listing explore requests for user:', {
          metadata: { userId },
        });

        const requests = await exploreRequestService.listRequests(
          userId,
          request.page,
          request.pageSize,
          request.includeDevOnlyRequests || false,
        );

        logService.info('Retrieved explore requests 2:', {
          metadata: { requests },
        });

        return {
          requests: requests,
        };
      });
    } catch (error) {
      logService.error('Error in list_explore_requests:', {
        error: error as Error,
        metadata: {
          method: 'listExploreRequests',
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }

  async listExploreRequestSummaries(
    _request: ListExploreRequestSummariesRequest,
  ): Promise<ListExploreRequestSummariesResponse> {
    try {
      const userId = getRequestUser()?.id;
      if (!userId) {
        throw new Error('User not logged in when listing explore request summaries.');
      }

      const summaries = await exploreRequestService.listRequestSummaries(userId);
      return { summaries: summaries };
    } catch (error) {
      logService.error('Error in list_explore_request_summaries:', {
        error: error as Error,
        metadata: {
          method: 'listExploreRequestSummaries',
        },
      });
      throw error;
    }
  }
  async adminListAllExploreRequests(
    request: AdminListAllExploreRequestsRequest,
  ): Promise<AdminListAllExploreRequestsResponse> {
    const user = getRequestUser();
    if (
      !user ||
      (user.role !== UserRole.USER_ROLE_ADMIN && user.role !== UserRole.USER_ROLE_STYLIST)
    ) {
      logService.error(
        `User does not have permission to list all explore requests. User ${
          user?.email
        } has role: ${user?.role ? convertUserRoleToDbRole(user.role) : 'unknown'}`,
        {
          metadata: {
            user,
          },
        },
      );
      throw new Error(
        'User does not have access to the admin list all explore requests in adminListAllExploreRequests',
      );
    }

    const requests = await exploreRequestService.listRequests(
      undefined,
      request.page || 1,
      request.pageSize || 100,
      true,
    );

    return { requests };
  }

  async duplicateExploreRequest(
    request: DuplicateExploreRequestRequest,
  ): Promise<DuplicateExploreRequestResponse> {
    try {
      const userId = getRequestUser()?.id;
      if (!userId) {
        throw new Error('User not logged in when duplicating explore request.');
      }

      const originalRequest = await exploreRequestService.getRequestOrFail(request.requestId);

      const newRequest = {
        ...originalRequest,
        devIsDevOnly: originalRequest.devIsDevOnly || false,
      };

      const createdRequest = await exploreRequestService.insertRequest(newRequest, userId);
      logService.info('Successfully duplicated request', {
        metadata: {
          originalRequestId: request.requestId,
          createdRequest,
        },
      });

      return {
        newRequestId: createdRequest.id,
      };
    } catch (error) {
      logService.error('Error in duplicate_explore_request:', {
        error: error as Error,
        metadata: {
          method: 'duplicateExploreRequest',
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }

  async deleteExploreRequest(
    request: DeleteExploreRequestRequest,
  ): Promise<DeleteExploreRequestResponse> {
    try {
      await exploreRequestService.markRequestAsDeleted(request.requestId);
      return { message: 'successful' };
    } catch (error) {
      logService.error('Error in delete_explore_request:', {
        error: error as Error,
        metadata: {
          method: 'deleteExploreRequest',
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }

  async deleteCohort(request: DeleteCohortRequest): Promise<DeleteCohortResponse> {
    try {
      const exploreRequest = await exploreRequestService.getRequestOrFail(request.requestId);
      await productPreferenceService.deleteProductPreferencesForRequest(
        exploreRequest,
        request.cohort,
      );
      return {
        message: 'Successful',
      };
    } catch (error) {
      logService.error('Error in delete_cohort:', {
        error: error as Error,
        metadata: {
          method: 'deleteCohort',
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }

  async generateStyles(request: StyleGenerationRequest): Promise<StyleGenerationResponse> {
    try {
      const styles = await exploreService.generateStyles(
        request.query,
        request.gender,
        request.numProducts || 10,
      );

      const productWithDiffernetStyles = await Promise.all(
        styles.map(async style => {
          const products = await productService.searchProducts(
            style,
            5,
            SearchMethod.SEARCH_METHOD_VOYAGE_TEXT_SIGLIP_IMAGE_AVERAGE_SPARSE,
          );
          return {
            product: products[0],
            query: style,
          };
        }),
      );

      return { styles: productWithDiffernetStyles };
    } catch (error) {
      logService.error('Error in generate_styles:', {
        error: error as Error,
        metadata: {
          method: 'generateStyles',
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }

  async searchProductsAtCohort(
    request: SearchProductsAtCohortRequest,
    _context: CallContext,
  ): Promise<SearchProductsAtCohortResponse> {
    try {
      logService.info('Starting searchProductsAtCohort request', {
        metadata: { requestId: request.requestId, cohort: request.cohort },
      });

      // Get the explore request
      const exploreRequest = await exploreRequestService.getRequestOrFail(request.requestId);
      const user = await userService.getProfile(exploreRequest.userId);

      if (!user?.metadata) {
        throw new Error('User metadata is missing');
      }

      const gender = exploreRequest.gender || user.metadata.gender;
      if (!gender) {
        throw new Error('Gender is not specified');
      }

      // Get all product preferences up to and including the specified cohort
      const productPreferences = await productPreferenceService.getProductPreferencesForRequest(
        exploreRequest,
        false,
      );

      // Get seen product IDs to exclude them from search
      const seenProductIds = productPreferences
        .map(pref => pref.productDetails?.id)
        .filter(product => product) as string[];

      // Search for products using the query
      const searchQuery: SearchQuery = {
        query: request.query,
        gender: gender,
        category: exploreRequest.category,
        topK: 200,
        minPrice: exploreRequest.lowerBudget,
        maxPrice: exploreRequest.upperBudget,
        brandIds: exploreRequest.brandIds,
        productIdBlacklist: request.filterOutSeenProducts ? seenProductIds : [],
        productIdWhitelist: [],
        searchMethod: SearchMethod.SEARCH_METHOD_TEXT,
      };

      const productsWithScores = await productSearchService.searchProducts(searchQuery);

      // Rerank products using preferences
      const rerankedProducts = await productService.rerankProductsUsingPreferences(
        productsWithScores.map(p => ({ ...p, query: request.query })),
        productPreferences,
        SearchMethod.SEARCH_METHOD_TEXT,
        request.cohort,
      );

      return {
        rankedProducts: rerankedProducts.map(p => ({
          product: p.product,
          score: p.score,
          query: request.query,
        })),
        unrankedProducts: productsWithScores.map(p => ({
          product: p.product,
          score: p.score,
          query: request.query,
        })),
        intermediateQueries: [request.query],
      };
    } catch (error) {
      logService.error('Error in searchProductsAtCohort:', {
        error: error as Error,
        metadata: {
          method: 'searchProductsAtCohort',
          requestId: request.requestId,
          cohort: request.cohort,
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }

  async *replyToChat(request: ReplyToChatRequest): AsyncGenerator<ReplyToChatResponse> {
    try {
      const userId = getRequestUser()?.id;
      if (!userId) {
        throw new Error('User not logged in when replying to chat.');
      }

      yield* exploreService.replyToChat(request);
    } catch (error) {
      logService.error('Error in replyToChat:', {
        error: error as Error,
        metadata: {
          method: 'replyToChat',
        },
        serviceName: 'ExploreServer',
      });
      throw error;
    }
  }
}
