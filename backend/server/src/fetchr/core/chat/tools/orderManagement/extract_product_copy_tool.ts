import { z } from 'zod';
import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolFunctionInputType } from '../../types';
import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';

export class ExtractProductCopyRequestPayload extends BaseToolUsageRequestPayload {
  public productCopy: string;
  public userRequirements: string[];

  constructor(input: ToolFunctionInputType<'extract_product_copy'>) {
    super('extract_product_copy');
    const { productCopy, userRequirements } = input;
    this.productCopy = productCopy;
    this.userRequirements = userRequirements;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & {
      input: ToolFunctionInputType<'extract_product_copy'>;
    },
  ): ExtractProductCopyRequestPayload {
    return new ExtractProductCopyRequestPayload(toolUseBlock.input);
  }

  override createRequestInput(): ToolFunctionInputType<'extract_product_copy'> {
    return {
      productCopy: this.productCopy,
      userRequirements: this.userRequirements ?? [],
    };
  }
}

export class ExtractProductCopyResponsePayload extends BaseToolUsageResponsePayload {
  public productCopy: string;
  public toolUseId: string;

  constructor(response: { productCopy: string; toolUseId: string }) {
    super('extract_product_copy');
    this.productCopy = response.productCopy;
    this.toolUseId = response.toolUseId;
  }

  override toToolResultBlock(toolId: string): ToolResultBlockParam {
    return {
      tool_use_id: toolId,
      type: 'tool_result',
      content: this.productCopy.trim(),
      is_error: false,
    };
  }
}

export const ExtractProductCopyTool = {
  requestClass: ExtractProductCopyRequestPayload,
  responseClass: ExtractProductCopyResponsePayload,
  functionSchema: {
    name: 'extract_product_copy',
    description:
      'Generates a short copy explaining why the product, brand, and size is good for the user. Written in second person. Make is also personal as if written by a stylist',
    input: z.object({
      productCopy: z.string().describe('The copy to be shown to the user'),
      userRequirements: z
        .array(z.string())
        .describe(
          'The user requirements for the product. Include 1-6 (as many as was covered in the chat)',
        ),
    }),
  },
};
