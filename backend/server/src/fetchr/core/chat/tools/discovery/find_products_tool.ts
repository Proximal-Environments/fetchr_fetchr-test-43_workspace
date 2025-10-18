import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import { Product } from '@fetchr/schema/base/base';
import { z } from 'zod';
import { ToolFunctionInputType } from '../../types';
import { logService } from '../../../../base/logging/logService';
import { ChatCompletionMessageToolCall } from 'openai/resources';

export class FindProductsRequestPayload extends BaseToolUsageRequestPayload {
  public searchQueries: string[];

  constructor({ searchQueries }: ToolFunctionInputType<'find_products'>) {
    super('find_products');
    logService.info('[Debug] FindProductsRequestPayload constructor', {
      metadata: { searchQueries },
    });
    this.searchQueries = searchQueries;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & {
      input: ToolFunctionInputType<'find_products'>;
    },
  ): FindProductsRequestPayload {
    return new FindProductsRequestPayload({
      searchQueries: toolUseBlock.input.searchQueries,
    });
  }

  static override fromChatCompletionMessageToolCall(
    toolCall: ChatCompletionMessageToolCall,
  ): FindProductsRequestPayload {
    const input = JSON.parse(toolCall.function.arguments);
    return new FindProductsRequestPayload({
      searchQueries: input.searchQueries,
    });
  }

  override createRequestInput(): ToolFunctionInputType<'find_products'> {
    return {
      searchQueries: this.searchQueries,
    };
  }
}

export type FindProductsQueryResult = {
  query: string;
  id: string;
  products: Product[];
};

export class FindProductsResponsePayload extends BaseToolUsageResponsePayload {
  public queryResults: FindProductsQueryResult[];

  constructor({ queryResults }: { queryResults: FindProductsQueryResult[] }) {
    super('find_products');
    this.queryResults = queryResults;
  }

  public override toToolResultBlock(toolId: string): ToolResultBlockParam {
    logService.info('[Debug] Creating tool result block', {
      metadata: { toolId, queryResults: this.queryResults },
    });

    function formatProduct(product: Product): string {
      return `# Product: ${product?.name} - ${product?.brandName} ${
        product?.subBrandName ? `(${product?.subBrandName})` : ''
      }
Id: ${product?.id}
${product?.generatedDescription}
Details: ${product?.details}
Colors: ${product?.colors?.join(', ')}
Materials: ${product?.materials?.join(', ')}
`;
    }

    const formattedContent = this.queryResults
      .map(queryResult => {
        const productsFormatted = queryResult.products.slice(0, 2).map(formatProduct).join('\n\n');
        return `## Search Query ${queryResult.id}: "${queryResult.query}"\n\n${productsFormatted}`;
      })
      .join('\n\n---\n\n');

    return {
      tool_use_id: toolId,
      type: 'tool_result',
      content: formattedContent,
      is_error: false,
    };
  }

  static convertResultPayloadToToolResultBlock(
    payload: FindProductsResponsePayload,
    id: string,
  ): ToolResultBlockParam {
    return payload.toToolResultBlock(id);
  }
}

export const FindProductsTool = {
  requestClass: FindProductsRequestPayload,
  responseClass: FindProductsResponsePayload,
  functionSchema: {
    name: 'find_products',
    description:
      'Find products to search for. You will give 1-5 queries to search for the products. The queries should be different from each other (if possible) to cover different styles, colors, categories etc... The top 2 results from each query will be shown to you (out of 6).',
    input: z.object({
      searchQueries: z
        .array(z.string())
        .describe(
          'The queries used to search for products that will be entered into the vector database',
        )
        .min(1)
        .max(5),
    }),
  },
};
