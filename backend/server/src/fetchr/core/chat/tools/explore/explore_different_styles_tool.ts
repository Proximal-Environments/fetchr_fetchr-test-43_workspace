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
export class ExploreDifferentStylesRequestPayload extends BaseToolUsageRequestPayload {
  public styleQueries: string[];

  public override metadata?: {
    rankedProducts: ProductWithScoreAndSearchQuery[];
    unrankedProducts: ProductWithSearchQuery[];
  } = undefined;

  constructor({ styleQueries }: ToolFunctionInputType<'explore_different_styles'>) {
    super('explore_different_styles');
    logService.info('[Debug] ExploreDifferentStylesRequestPayload constructor', {
      metadata: { styleQueries },
    });
    this.styleQueries = styleQueries;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & {
      input: ToolFunctionInputType<'explore_different_styles'>;
    },
  ): ExploreDifferentStylesRequestPayload {
    return new ExploreDifferentStylesRequestPayload({
      styleQueries: toolUseBlock.input.styleQueries,
    });
  }

  static override fromChatCompletionMessageToolCall(
    toolCall: ChatCompletionMessageToolCall,
  ): ExploreDifferentStylesRequestPayload {
    const input = JSON.parse(toolCall.function.arguments);
    return new ExploreDifferentStylesRequestPayload({
      styleQueries: input.styleQueries,
    });
  }
  // For backward compatibility with older product object - manually migrate
  static override fromJson(json: JsonValue): ExploreDifferentStylesRequestPayload {
    const superInstance = super.fromJson(json) as ExploreDifferentStylesRequestPayload;
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

  override createRequestInput(): ToolFunctionInputType<'explore_different_styles'> {
    return {
      styleQueries: this.styleQueries,
    };
  }
}

// @ts-expect-error - temporary workaround for type compatibility. Nothing is wrong with the type.
export class ExploreDifferentStylesResponsePayload extends BaseToolUsageResponsePayload {
  public productPreferences: PopulatedProductPreferenceItem[];

  constructor({ productPreferences }: { productPreferences: PopulatedProductPreferenceItem[] }) {
    super('explore_different_styles');
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

    let content = '';
    if (superlikedProducts.length > 0) {
      content += `# I loved these products:\n${superlikedProducts
        .map(
          p =>
            `${p.preferenceItem?.itemId} - ${p.product?.name}\n${
              p.product?.fullGeneratedDescription
            }${
              p.preferenceItem?.comments
                ? `\nMy note on this product: ${p.preferenceItem?.comments}`
                : ''
            }`,
        )
        .join('\n\n')}\n\n`;
    }

    if (likedProducts.length > 0) {
      content += `# I liked these products:\n${likedProducts
        .map(
          p =>
            `${p.preferenceItem?.itemId} - ${p.product?.name}\n${
              p.product?.fullGeneratedDescription
            }${
              p.preferenceItem?.comments
                ? `\nMy note on this product: ${p.preferenceItem?.comments}`
                : ''
            }`,
        )
        .join('\n\n')}\n\n`;
    }

    if (dislikedProducts.length > 0) {
      content += `# I disliked these products:\n${dislikedProducts
        .map(
          p =>
            `${p.preferenceItem?.itemId} - ${p.product?.name}\n${
              p.product?.fullGeneratedDescription
            }${
              p.preferenceItem?.comments
                ? `\nMy note on this product: ${p.preferenceItem?.comments}`
                : ''
            }`,
        )
        .join('\n\n')}\n\n`;
    }

    if (maybeProducts.length > 0) {
      content += `# I somewhat like these products. But not sure about them:\n${maybeProducts
        .map(
          p =>
            `${p.preferenceItem?.itemId} - ${p.product?.name}\n${
              p.product?.fullGeneratedDescription
            }${
              p.preferenceItem?.comments
                ? `\nMy note on this product: ${p.preferenceItem?.comments}`
                : ''
            }`,
        )
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
  public static override fromJson(json: JsonValue): ExploreDifferentStylesResponsePayload {
    const superInstance = super.fromJson(json) as ExploreDifferentStylesResponsePayload;
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
    payload: ExploreDifferentStylesResponsePayload,
    id: string,
  ): ToolResultBlockParam {
    return payload.toToolResultBlock(id);
  }

  public addProductPreferences(productPreferences: PopulatedProductPreferenceItem[]): void {
    this.productPreferences.push(...productPreferences);
  }
}

export const ExploreDifferentStylesTool = {
  requestClass: ExploreDifferentStylesRequestPayload,
  responseClass: ExploreDifferentStylesResponsePayload,
  functionSchema: {
    name: 'explore_different_styles',
    description:
      'Explore different styles of products for the user. You will give 5-10 style queries to search for the products. The queries should be different from each other (if possible) to cover different styles, colors, categories etc...',
    input: z.object({
      styleQueries: z.array(z.string()).describe('The style queries to search for'),
    }),
  },
};
