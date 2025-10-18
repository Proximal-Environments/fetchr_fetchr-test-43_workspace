// __LOCKED_FILE__
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
// BE VERY CAREFUL WHEN CHANGING THIS FILE
import { MessageRole } from '@fetchr/schema/core/core';
import { PopulatedExploreMessage, Product, ProductPreferenceItem } from '@fetchr/schema/base/base';
import { FetchrContentBlock, FetchrMessage } from '../../../chat/chatHistory';
import {
  SuggestProductsToUserRequestPayload,
  SuggestProductsToUserResponsePayload,
} from '../../../chat/tools/explore/suggest_products_to_user_tool';
import { MessageUserRequestPayload } from '../../../chat/tools/explore/message_user_tool';
import { FinishFindingProductRequestPayload } from '../../../chat/tools/explore/finish_finding_product_tool';
import {
  SuggestStylesToUserRequestPayload,
  SuggestStylesToUserResponsePayload,
} from '../../../chat/tools/explore/suggest_styles_to_user_tool';
import { ToolUsageRequest, ToolUsageResponse } from '../../../chat/types';
import { productImageService } from '../../../../base/service_injection/global';
import { v4 as uuidv4 } from 'uuid';
import { logService } from '../../../../base/logging/logService';

export const convertFetchrMessageToExploreMessage = (
  message: FetchrMessage,
): PopulatedExploreMessage | null => {
  if (typeof message.content === 'string') {
    if (message.role === 'user') {
      return {
        message: {
          $case: 'basicMessage',
          basicMessage: {
            role: MessageRole.MESSAGE_ROLE_USER,
            content: message.content,
            images: [],
            imageUrls: [],
          },
        },
      };
    } else if (message.role === 'assistant') {
      return {
        message: {
          $case: 'basicMessage',
          basicMessage: {
            role: MessageRole.MESSAGE_ROLE_ASSISTANT,
            content: message.content,
            images: [],
            imageUrls: [],
          },
        },
      };
    }
    return null;
  }

  // Handle array content blocks
  const blocks = message.content;
  const basicExploreMessage: PopulatedExploreMessage & {
    message: { $case: 'basicMessage' };
  } = {
    message: {
      $case: 'basicMessage',
      basicMessage: {
        role:
          message.role === 'user'
            ? MessageRole.MESSAGE_ROLE_USER
            : MessageRole.MESSAGE_ROLE_ASSISTANT,
        content: '',
        images: [],
        imageUrls: [],
      },
    },
  };

  for (const [index, block] of blocks.entries()) {
    void index;
    if (message.role === 'user') {
      if (block.type === 'text') {
        basicExploreMessage.message.basicMessage.content += block.text;
      }
      if (block.type === 'image' && 'imageUrl' in block) {
        basicExploreMessage.message.basicMessage.imageUrls.push(block.imageUrl);
      }
    }

    if (message.role === 'assistant') {
      if (block.type === 'text') {
        basicExploreMessage.message.basicMessage.content += block.text;
      }
      if (block.type === 'image' && 'imageUrl' in block) {
        basicExploreMessage.message.basicMessage.imageUrls.push(block.imageUrl);
      }
    }
    // Handle tool usage request blocks
    if (typeof block === 'object' && block.type === 'tool_use') {
      if (block.name === 'suggest_products_to_user') {
        const payload = block.payload as SuggestProductsToUserRequestPayload;
        return {
          message: {
            $case: 'productPreferencesRequestMessage',
            productPreferencesRequestMessage: {
              products: payload.metadata?.rankedProducts ?? [],
              unrankedProducts: payload.metadata?.unrankedProducts ?? [],
              intermediateQueries: payload.searchQueries.map(query => query.query),
              toolUseId: block.id,
            },
          },
        };
      } else if (block.name === 'message_user') {
        const payload = block.payload as MessageUserRequestPayload;
        if (payload.suggestedResponses && payload.suggestedResponses.length > 0) {
          return {
            message: {
              $case: 'predefinedRequestMessage',
              predefinedRequestMessage: {
                message: {
                  role: MessageRole.MESSAGE_ROLE_ASSISTANT,
                  content: payload.message,
                  images: [],
                  imageUrls: [],
                },
                suggestedResponses: payload.suggestedResponses,
              },
            },
          };
        }
        return {
          message: {
            $case: 'basicMessage',
            basicMessage: {
              role: MessageRole.MESSAGE_ROLE_ASSISTANT,
              content: (block.payload as MessageUserRequestPayload).message,
              images: [],
              imageUrls: [],
            },
          },
        };
      } else if (block.name === 'finish_finding_product') {
        const payload = block.payload as FinishFindingProductRequestPayload;
        return {
          message: {
            $case: 'finishFindingProductRequestMessage',
            finishFindingProductRequestMessage: {
              userRequirements: payload.userRequirements ?? [],
              productSuggestions: payload.metadata?.productSuggestions ?? [],
              message: payload.message && payload.message.length > 0 ? payload.message : undefined,
            },
          },
        };
      } else if (block.name === 'suggest_styles_to_user') {
        return {
          message: {
            $case: 'gridImagesRequestMessage',
            gridImagesRequestMessage: {
              imageUrls:
                (block.payload as SuggestStylesToUserRequestPayload).getMetadata()?.images ?? [],
              toolUseId: block.id,
            },
          },
        };
      } else if (block.name === 'place_order') {
        // Deprecated tool - We do not use this tool anymore
        return null;
      }
    }

    // Handle tool usage response blocks
    if (typeof block === 'object' && block.type === 'tool_result') {
      if (block.payload.fetchrLLMToolType === 'suggest_products_to_user') {
        const payload = block.payload as SuggestProductsToUserResponsePayload;
        return {
          message: {
            $case: 'productPreferencesResponseMessage',
            productPreferencesResponseMessage: {
              toolUseId: block.tool_use_id,
              preferences: payload.productPreferences
                .map(preference => {
                  if (!preference.preferenceItem) {
                    return null;
                  }
                  return preference.preferenceItem;
                })
                .filter(Boolean) as ProductPreferenceItem[],
            },
          },
        };
      } else if (block.payload.fetchrLLMToolType === 'suggest_styles_to_user') {
        const payload = block.payload as SuggestStylesToUserResponsePayload;
        return {
          message: {
            $case: 'gridImagesResponseMessage',
            gridImagesResponseMessage: {
              imagePreferenceItems: payload.imagePreferences,
              toolUseId: block.tool_use_id,
            },
          },
        };
      }
    }
  }

  // Return the userExploreMessage if it has content
  if (
    basicExploreMessage.message.basicMessage.content.length > 0 ||
    basicExploreMessage.message.basicMessage.imageUrls.length > 0
  ) {
    return basicExploreMessage;
  }

  return null;
};

export const convertExploreMessageToFetchrMessage = (
  exploreMessage: PopulatedExploreMessage,
  productsCache: Record<string, Product>,
  imageStylesCache: Record<string, string>,
): FetchrMessage | null => {
  try {
    if (!exploreMessage.message) {
      return null;
    }

    switch (exploreMessage.message.$case) {
      case 'basicMessage': {
        const contentBlocks: FetchrContentBlock[] = [
          ...(exploreMessage.message.basicMessage.content.trim().length > 0
            ? [
                {
                  type: 'text' as const,
                  text: exploreMessage.message.basicMessage.content,
                },
              ]
            : []),
          ...(exploreMessage.message.basicMessage.imageUrls ?? []).map(imageUrl => ({
            type: 'image' as const,
            imageUrl,
          })),
        ];

        if (contentBlocks.length > 0) {
          return {
            role:
              exploreMessage.message.basicMessage.role === MessageRole.MESSAGE_ROLE_USER
                ? 'user'
                : 'assistant',
            content: contentBlocks,
          };
        }
        return null;
      }
      case 'productPreferencesResponseMessage':
        return {
          role: 'user',
          content: [
            ToolUsageResponse.createFromPayload(
              new SuggestProductsToUserResponsePayload({
                productPreferences:
                  exploreMessage.message.productPreferencesResponseMessage.preferences.map(
                    preference => {
                      const product = productsCache[preference.itemId];
                      if (!product) {
                        throw new Error(`Product not found in cache: ${preference.itemId}`);
                      }
                      return {
                        preferenceItem: preference,
                        product,
                      };
                    },
                  ),
              }),
              exploreMessage.message.productPreferencesResponseMessage.toolUseId,
            ),
          ],
        };
      case 'gridImagesResponseMessage':
        return {
          role: 'user',
          content: [
            ToolUsageResponse.createFromPayload(
              new SuggestStylesToUserResponsePayload({
                imagePreferences:
                  exploreMessage.message.gridImagesResponseMessage.imagePreferenceItems.map(
                    item => ({
                      ...item,
                      style:
                        (item.imagePreferenceItem?.imageUrl &&
                          imageStylesCache[item.imagePreferenceItem?.imageUrl]) ??
                        'Default (Generated from user query + profile)',
                    }),
                  ),
              }),
              exploreMessage.message.gridImagesResponseMessage.toolUseId,
            ),
          ],
        };
      case 'finishFindingProductRequestMessage': {
        const payload = new FinishFindingProductRequestPayload({
          user_requirements:
            exploreMessage.message.finishFindingProductRequestMessage.userRequirements,
          message: exploreMessage.message.finishFindingProductRequestMessage.message || '',
        });

        payload.addMetadata({
          product_suggestions:
            exploreMessage.message.finishFindingProductRequestMessage.productSuggestions,
        });

        return {
          role: 'assistant',
          content: [ToolUsageRequest.createFromPayload(payload, uuidv4())],
        };
      }
      case 'gridImagesRequestMessage': {
        const payload = new SuggestStylesToUserRequestPayload({
          styleQuery: 'Default (Generated from user query + profile)',
        });

        payload.addMetadata({
          images: exploreMessage.message.gridImagesRequestMessage.imageUrls,
        });

        return {
          role: 'assistant',
          content: [
            ToolUsageRequest.createFromPayload(
              payload,
              exploreMessage.message.gridImagesRequestMessage.toolUseId,
            ),
          ],
        };
      }
      case 'productPreferencesRequestMessage': {
        const payload = new SuggestProductsToUserRequestPayload({
          searchQueries:
            exploreMessage.message.productPreferencesRequestMessage.intermediateQueries.map(
              query => ({
                query,
                explanation: '',
              }),
            ),
        });

        payload.addMetadata({
          rankedProducts: exploreMessage.message.productPreferencesRequestMessage.products,
          unrankedProducts: [],
        });

        return {
          role: 'assistant',
          content: [
            ToolUsageRequest.createFromPayload(
              payload,
              exploreMessage.message.productPreferencesRequestMessage.toolUseId,
            ),
          ],
        };
      }
      case 'predefinedRequestMessage': {
        const payload = new MessageUserRequestPayload({
          message: exploreMessage.message.predefinedRequestMessage.message?.content ?? '',
          suggestedResponses: exploreMessage.message.predefinedRequestMessage.suggestedResponses,
          blocking: false,
        });
        return {
          role: 'assistant',
          content: [ToolUsageRequest.createFromPayload(payload, uuidv4())],
        };
      }
      case 'gridProductsRequestMessage':
        throw new Error('Not implemented');
      case 'placeOrderRequestMessage':
        throw new Error('Not implemented');
      case 'gridProductsResponseMessage':
        throw new Error('Not implemented');
      case 'updateStatusMessage':
        return null;
      default:
        return null;
    }
  } catch (error) {
    logService.error('Error converting explore message to fetchr message', {
      error,
      metadata: {
        exploreMessage,
      },
    });
    return null;
  }
};

export const convertExploreMessagesToFetchrMessages = async (
  messages: PopulatedExploreMessage[],
): Promise<FetchrMessage[]> => {
  const productsCache: Record<string, Product> = {};
  for (const message of messages) {
    if (message.message?.$case === 'productPreferencesRequestMessage') {
      const productPreferencesRequestMessage = message.message.productPreferencesRequestMessage;
      for (const product of productPreferencesRequestMessage.products) {
        if (product.product) {
          productsCache[product.product.id] = product.product;
        }
      }
    }
  }

  const imageStylesCache: Record<string, string> = {};
  for (const message of messages) {
    if (message.message?.$case === 'gridImagesRequestMessage') {
      const gridImagesRequestMessage = message.message.gridImagesRequestMessage;
      for (const image of gridImagesRequestMessage.imageUrls) {
        const imageStyle = await productImageService.getImageAndWaitForStyleIfProcessing(
          image.imageUrl,
        );
        if (imageStyle && imageStyle.style) {
          imageStylesCache[image.imageUrl] = imageStyle.style;
        }
      }
    }
  }

  const fetchrMessages = messages
    .map(message => convertExploreMessageToFetchrMessage(message, productsCache, imageStylesCache))
    .filter(message => message !== null);

  return fetchrMessages;
};

export const convertFetchrMessagesToExploreMessages = (
  messages: FetchrMessage[],
): PopulatedExploreMessage[] => {
  console.log('[Initial Message]', JSON.stringify(messages, null, 2));
  return messages
    .map(message => {
      try {
        if (!message) return null;
        return convertFetchrMessageToExploreMessage(message);
      } catch (error) {
        logService.error('Error converting message', {
          metadata: { message },
          error,
        });
        return null;
      }
    })
    .filter((message): message is PopulatedExploreMessage => message !== null);
};
