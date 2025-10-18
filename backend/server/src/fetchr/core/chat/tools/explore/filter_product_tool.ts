import { z } from 'zod';
import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolFunctionInputType } from '../../types';
import { ToolUseBlockParam } from '@anthropic-ai/sdk/resources';

export class FilterProductRequestPayload extends BaseToolUsageRequestPayload {
  public keep: boolean;

  constructor(input: ToolFunctionInputType<'filter_product'>) {
    super('filter_product');
    const { keep } = input;
    this.keep = keep;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & { input: ToolFunctionInputType<'filter_product'> },
  ): FilterProductRequestPayload {
    return new FilterProductRequestPayload({
      keep: toolUseBlock.input.keep,
    });
  }

  override createRequestInput(): ToolFunctionInputType<'filter_product'> {
    return {
      keep: this.keep,
    };
  }
}

export class FilterProductResponsePayload extends BaseToolUsageResponsePayload {
  constructor() {
    super('filter_product');
    throw new Error('Not used');
  }
}

export const FilterProductTool = {
  requestClass: FilterProductRequestPayload,
  responseClass: FilterProductResponsePayload,
  functionSchema: {
    name: 'filter_product',
    description: 'Filter a product',
    input: z.object({
      keep: z.boolean().describe('Whether to keep the product or not'),
    }),
  },
};
