import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import { z } from 'zod';
import { ToolFunctionInputType } from '../../types';
import { logService } from '../../../../base/logging/logService';
import { ChatCompletionMessageToolCall } from 'openai/resources';

export class PresentProductsRequestPayload extends BaseToolUsageRequestPayload {
  public ids: string[];
  public suggested_searches: string[];
  public response: string;
  public category: string;

  constructor({
    ids,
    suggested_searches,
    response,
    category,
  }: ToolFunctionInputType<'present_products'>) {
    super('present_products');
    logService.info('[Debug] PresentProductsRequestPayload constructor', {
      metadata: { ids, suggested_searches },
    });
    this.ids = ids;
    this.suggested_searches = suggested_searches;
    this.response = response;
    this.category = category;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & {
      input: ToolFunctionInputType<'present_products'>;
    },
  ): PresentProductsRequestPayload {
    return new PresentProductsRequestPayload({
      ids: toolUseBlock.input.ids,
      suggested_searches: toolUseBlock.input.suggested_searches,
      response: toolUseBlock.input.response,
      category: toolUseBlock.input.category,
    });
  }

  static override fromChatCompletionMessageToolCall(
    toolCall: ChatCompletionMessageToolCall,
  ): PresentProductsRequestPayload {
    const input = JSON.parse(toolCall.function.arguments);
    return new PresentProductsRequestPayload({
      ids: input.ids,
      suggested_searches: input.suggested_searches,
      response: input.response,
      category: input.category,
    });
  }

  override createRequestInput(): ToolFunctionInputType<'present_products'> {
    return {
      ids: this.ids,
      suggested_searches: this.suggested_searches,
      response: this.response,
      category: this.category,
    };
  }
}

export class PresentProductsResponsePayload extends BaseToolUsageResponsePayload {
  constructor() {
    super('present_products');
  }

  override toToolResultBlock(toolId: string): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolId,
      content: 'Products presented successfully',
    };
  }
}

export const PresentProductsTool = {
  requestClass: PresentProductsRequestPayload,
  responseClass: PresentProductsResponsePayload,
  functionSchema: {
    name: 'present_products',
    description:
      "Present products that you have found in previous calls to the find products tool to users. You can present products using the search query ids. Each search query represents 6 products. Only include search query ids that have results that are relevant to the user's query.",
    input: z.object({
      ids: z
        .array(z.string())
        .min(1)
        .max(3)
        .describe(
          '1-3 IDs of the search queries to present. These are presented in order, so place the most relevant results first',
        ),
      suggested_searches: z
        .array(z.string())
        .min(1)
        .max(8)
        .describe('1-8 suggested queries to present to the user for further exploration.'),
      response: z
        .string()
        .describe(
          'A response to the user. It could be a clarifying question or a statement. You have very limited space',
        ),
      category: z
        .string()
        .describe(
          'The category of the products you are presenting. This should be 1-2 words and will be shown to the user at the top of the screen.',
        ),
    }),
  },
};
