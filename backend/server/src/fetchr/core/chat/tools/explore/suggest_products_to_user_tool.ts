import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import {
  PopulatedProductPreferenceItem,
  PreferenceType,
  ProductWithScoreAndSearchQuery,
  ProductWithSearchQuery,
} from '@fetchr/schema/base/base';
import { z } from 'zod';
import { ToolFunctionInputType } from '../../types';
import { JsonValue } from '@bufbuild/protobuf/dist/cjs/json-value';
import { logService } from '../../../../base/logging/logService';
import { ChatCompletionMessageToolCall } from 'openai/resources';

// @ts-expect-error - temporary workaround for type compatibility. Nothing is wrong with the type.
export class SuggestProductsToUserRequestPayload extends BaseToolUsageRequestPayload {
  public searchQueries: {
    query: string;
    explanation: string;
  }[];

  public override metadata?: {
    rankedProducts: ProductWithScoreAndSearchQuery[];
    unrankedProducts: ProductWithSearchQuery[];
  } = undefined;

  constructor({ searchQueries }: ToolFunctionInputType<'suggest_products_to_user'>) {
    super('suggest_products_to_user');
    logService.info('[Debug] SuggestProductsToUserRequestPayload constructor', {
      metadata: { searchQueries },
    });
    this.searchQueries = searchQueries;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & {
      input: ToolFunctionInputType<'suggest_products_to_user'>;
    },
  ): SuggestProductsToUserRequestPayload {
    return new SuggestProductsToUserRequestPayload({
      searchQueries: toolUseBlock.input.searchQueries,
    });
  }

  static override fromChatCompletionMessageToolCall(
    toolCall: ChatCompletionMessageToolCall,
  ): SuggestProductsToUserRequestPayload {
    const input = JSON.parse(toolCall.function.arguments);
    return new SuggestProductsToUserRequestPayload({
      searchQueries: input.searchQueries,
    });
  }
  // For backward compatibility with older product object - manually migrate
  static override fromJson(json: JsonValue): SuggestProductsToUserRequestPayload {
    const superInstance = super.fromJson(json) as SuggestProductsToUserRequestPayload;
    superInstance.metadata = {
      rankedProducts: (superInstance.metadata?.rankedProducts ?? []).map(p => ({
        ...p,
        product: p.product
          ? {
              ...p.product,
              highresWebpUrls: p.product?.highresWebpUrls ?? [],
            }
          : undefined,
      })),
      unrankedProducts: (superInstance.metadata?.unrankedProducts ?? []).map(p => ({
        ...p,
        product: p.product
          ? {
              ...p.product,
              highresWebpUrls: p.product?.highresWebpUrls ?? [],
            }
          : undefined,
      })),
    };
    return superInstance;
  }

  override getMetadata():
    | {
        rankedProducts: ProductWithScoreAndSearchQuery[];
        unrankedProducts: ProductWithSearchQuery[];
      }
    | undefined {
    return this.metadata as
      | {
          rankedProducts: ProductWithScoreAndSearchQuery[];
          unrankedProducts: ProductWithSearchQuery[];
        }
      | undefined;
  }

  override createRequestInput(): ToolFunctionInputType<'suggest_products_to_user'> {
    return {
      searchQueries: this.searchQueries,
    };
  }
}

// @ts-expect-error - temporary workaround for type compatibility. Nothing is wrong with the type.
export class SuggestProductsToUserResponsePayload extends BaseToolUsageResponsePayload {
  public productPreferences: PopulatedProductPreferenceItem[];

  constructor({ productPreferences }: { productPreferences: PopulatedProductPreferenceItem[] }) {
    super('suggest_products_to_user');
    this.productPreferences = productPreferences;
  }

  public override toToolResultBlock(toolId: string): ToolResultBlockParam {
    logService.info('[Debug] Creating tool result block', {
      metadata: { toolId, productPreferences: this.productPreferences },
    });
    const superlikedProducts = this.productPreferences.filter(
      p => p.preferenceItem?.preferenceType === PreferenceType.SUPERLIKE,
    );
    const likedProducts = this.productPreferences.filter(
      p => p.preferenceItem?.preferenceType === PreferenceType.LIKE,
    );
    const dislikedProducts = this.productPreferences.filter(
      p => p.preferenceItem?.preferenceType === PreferenceType.DISLIKE,
    );
    const maybeProducts = this.productPreferences.filter(
      p => p.preferenceItem?.preferenceType === PreferenceType.MAYBE,
    );

    function formatProduct(product: PopulatedProductPreferenceItem): string {
      const { product: productDetails, preferenceItem } = product;

      return `# Product: ${productDetails?.name} - ${productDetails?.brandName} ${
        productDetails?.subBrandName ? `(${productDetails?.subBrandName})` : ''
      }
Id: ${productDetails?.id}
${productDetails?.generatedDescription}
Details: ${productDetails?.details}
Colors: ${productDetails?.colors?.join(', ')}
Materials: ${productDetails?.materials?.join(', ')}

${preferenceItem?.comments ? `# My notes on this product:${preferenceItem.comments}` : ''}`;
    }

    let content = '';
    if (superlikedProducts.length > 0) {
      content += `# I loved these products:\n${superlikedProducts
        .map(formatProduct)
        .join('\n\n')}\n\n`;
    }

    if (likedProducts.length > 0) {
      content += `# I liked these products:\n${likedProducts.map(formatProduct).join('\n\n')}\n\n`;
    }

    if (dislikedProducts.length > 0) {
      content += `# I disliked these products:\n${dislikedProducts
        .map(formatProduct)
        .join('\n\n')}\n\n`;
    }

    if (maybeProducts.length > 0) {
      content += `# I somewhat like these products. But not sure about them:\n${maybeProducts
        .map(formatProduct)
        .join('\n\n')}\n\n`;
    }

    return {
      tool_use_id: toolId,
      type: 'tool_result',
      content: content.trim(),
      is_error: false,
    };
  }

  // For backward compatibility with older product object - manually migrate
  public static override fromJson(json: JsonValue): SuggestProductsToUserResponsePayload {
    const superInstance = super.fromJson(json) as SuggestProductsToUserResponsePayload;
    superInstance.productPreferences = superInstance.productPreferences.map(p => ({
      ...p,
      product: p.product
        ? {
            ...p.product,
            highresWebpUrls: p.product?.highresWebpUrls ?? [],
          }
        : undefined,
    }));
    return superInstance;
  }

  static convertResultPayloadToToolResultBlock(
    payload: SuggestProductsToUserResponsePayload,
    id: string,
  ): ToolResultBlockParam {
    return payload.toToolResultBlock(id);
  }

  public addProductPreferences(productPreferences: PopulatedProductPreferenceItem[]): void {
    this.productPreferences.push(...productPreferences);
  }
}

export const SuggestProductsToUserTool = {
  requestClass: SuggestProductsToUserRequestPayload,
  responseClass: SuggestProductsToUserResponsePayload,
  functionSchema: {
    name: 'suggest_products_to_user',
    description:
      'Suggest products to search for. You will give 1-3 queries to search for the products. The queries should be different from each other (if possible) to cover different styles, colors, categories etc...',
    input: z.object({
      searchQueries: z
        .array(
          z.object({
            query: z.string().describe('The type of product to search for'),
            explanation: z.string().describe('Explain why you want to search for this product'),
          }),
        )
        .min(1)
        .max(3)
        .describe('The queries used to search for products'),
    }),
  },
};
