import { z } from 'zod';
import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolFunctionInputType } from '../../types';
import { ToolUseBlockParam } from '@anthropic-ai/sdk/resources';

interface ProductSuggestion {
  productName: string;
  isSelected: boolean;
}

export class FinishFindingProductRequestPayload extends BaseToolUsageRequestPayload {
  public userRequirements: string[];
  public message: string;
  public override metadata?: {
    productSuggestions: ProductSuggestion[];
  } = undefined;

  constructor(input: ToolFunctionInputType<'finish_finding_product'>) {
    super('finish_finding_product');
    this.userRequirements = input.user_requirements ?? [];
    this.message = input.message ?? '';
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & {
      input: ToolFunctionInputType<'finish_finding_product'>;
    },
  ): FinishFindingProductRequestPayload {
    return new FinishFindingProductRequestPayload({
      user_requirements: toolUseBlock.input.user_requirements,
      message: toolUseBlock.input.message ?? '',
    });
  }

  override createRequestInput(): ToolFunctionInputType<'finish_finding_product'> {
    return {
      user_requirements: this.userRequirements,
      message: this.message ?? '',
    };
  }
}

export class FinishFindingProductResponsePayload extends BaseToolUsageResponsePayload {
  public message: string;

  constructor({ message }: { message: string }) {
    super('finish_finding_product');
    this.message = message;
  }
}

export const FinishFindingProductTool = {
  requestClass: FinishFindingProductRequestPayload,
  responseClass: FinishFindingProductResponsePayload,
  functionSchema: {
    name: 'finish_finding_product',
    description: 'Finish searching',
    input: z.object({
      user_requirements: z
        .array(z.string())
        .describe(
          "What are the user's requirements for the product they want? Use at least 3 requirements",
        ),
      message: z
        .string()
        .describe(
          'The message to send to the user (alongside a "Place Order" and a "Not Yet" button underneath the message)',
        ),
    }),
  },
};
