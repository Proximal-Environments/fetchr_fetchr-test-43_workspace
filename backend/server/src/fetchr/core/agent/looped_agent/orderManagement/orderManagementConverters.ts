import {
  PopulatedOrderManagementMessage,
  PopulatedOrderManagementRequestMessage,
  PopulatedOrderManagementResponseMessage,
} from '@fetchr/schema/base/base';
import { FetchrMessage } from '../../../chat/chatHistory';
import {
  SendStylistSuggestionsRequestPayload,
  SendStylistSuggestionsResponsePayload,
} from '../../../chat/tools/orderManagement/send_stylist_suggestions_tool';
import { ProductRecommendation } from '@fetchr/schema/base/base';
import { logService } from '../../../../base/logging/logService';
import { JsonArray, JsonValue } from '@prisma/client/runtime/library';

export const convertFetchrMessageToOrderManagementMessage = (
  message: FetchrMessage,
  orderId: string,
):
  | PopulatedOrderManagementRequestMessage
  | PopulatedOrderManagementResponseMessage
  | PopulatedOrderManagementMessage
  | null => {
  if (typeof message.content === 'string') return null;

  const blocks = message.content;
  for (const block of blocks) {
    switch (block.type) {
      case 'tool_use': {
        if (block.name === 'send_stylist_suggestions') {
          const payload = block.payload as SendStylistSuggestionsRequestPayload;
          return {
            message: {
              $case: 'stylistSuggestionsRequestMessage',
              stylistSuggestionsRequestMessage: {
                mainSuggestion: {
                  ...payload.mainSuggestion,
                  userRequirements: payload.mainSuggestion.userRequirements ?? [],
                },
                secondarySuggestions:
                  payload.secondarySuggestions?.map(suggestion => ({
                    ...suggestion,
                    userRequirements: suggestion.userRequirements ?? [],
                  })) ?? [],
                orderId,
              },
            },
          } as PopulatedOrderManagementRequestMessage;
        } else {
          logService.warn('tool name not supported for order management', {
            metadata: { block },
          });
        }
        break;
      }
      case 'tool_result': {
        if (block.payload.fetchrLLMToolType === 'send_stylist_suggestions') {
          const payload = block.payload as SendStylistSuggestionsResponsePayload;
          return {
            message: {
              $case: 'stylistSuggestionsResponseMessage',
              stylistSuggestionsResponseMessage: {
                orderId,
                modificationRequest: payload.modificationRequest,
                acceptedProduct: payload.acceptedProduct,
              },
            },
          } as PopulatedOrderManagementResponseMessage;
        } else {
          logService.warn('tool type not supported for order management', {
            metadata: { block },
          });
        }
        break;
      }
      default: {
        throw new Error(`block type not supported for order management: ${block.type}`);
      }
    }
  }

  return null;
};

export const convertProductRecommendationsToDbProductRecommendations = (
  productRecommendations: ProductRecommendation[],
): JsonArray => {
  return productRecommendations.map(recommendation => ({
    productName: recommendation.productName,
    isSelected: recommendation.isSelected,
  }));
};

export const convertDbProductRecommendationsToProductRecommendations = (
  dbProductRecommendations: JsonValue,
): ProductRecommendation[] => {
  if (!Array.isArray(dbProductRecommendations)) {
    throw new Error('dbProductRecommendations is not an array');
  }
  return dbProductRecommendations
    .map(recommendation => {
      if (typeof recommendation !== 'object' || recommendation === null) {
        throw new Error('recommendation is not an object');
      }

      if (
        !('productName' in recommendation && typeof recommendation.productName === 'string') ||
        !('isSelected' in recommendation && typeof recommendation.isSelected === 'boolean')
      ) {
        logService.error('recommendation is not an object', {
          metadata: { recommendation },
        });
        return null;
      }

      return {
        productName: recommendation.productName,
        isSelected: recommendation.isSelected,
      };
    })
    .filter(recommendation => recommendation !== null);
};
