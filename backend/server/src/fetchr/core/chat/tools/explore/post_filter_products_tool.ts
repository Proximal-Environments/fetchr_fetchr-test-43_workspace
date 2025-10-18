import { z } from 'zod';
import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolFunctionInputType } from '../../types';
import { ToolUseBlockParam } from '@anthropic-ai/sdk/resources';

export class PostFilterProductsRequestPayload extends BaseToolUsageRequestPayload {
  public productIds: string[];

  constructor(input: ToolFunctionInputType<'post_filter_products'>) {
    super('post_filter_products');
    const { productIds } = input;
    this.productIds = productIds;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & { input: ToolFunctionInputType<'post_filter_products'> },
  ): PostFilterProductsRequestPayload {
    return new PostFilterProductsRequestPayload({
      productIds: toolUseBlock.input.productIds,
    });
  }

  override createRequestInput(): ToolFunctionInputType<'post_filter_products'> {
    return {
      productIds: this.productIds,
    };
  }
}

export class PostFilterProductsResponsePayload extends BaseToolUsageResponsePayload {
  constructor() {
    super('post_filter_products');
    throw new Error('Not used');
  }
}

export const PostFilterProductsTool = {
  requestClass: PostFilterProductsRequestPayload,
  responseClass: PostFilterProductsResponsePayload,
  functionSchema: {
    name: 'post_filter_products',
    description: 'Post filter products',
    input: z.object({
      productIds: z.array(z.string()).describe('The product ids to show the user'),
    }),
  },
};
