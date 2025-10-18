import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { z } from 'zod';
import { ToolFunctionInputType } from '../../types';

export class ViewProductImageRequestPayload extends BaseToolUsageRequestPayload {
  public productId: string;
  public explanation: string;

  constructor({ product_id, explanation }: ToolFunctionInputType<'view_product_image'>) {
    super('view_product_image');
    this.productId = product_id;
    this.explanation = explanation;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & { input: ToolFunctionInputType<'view_product_image'> },
  ): ViewProductImageRequestPayload {
    return new ViewProductImageRequestPayload({
      product_id: toolUseBlock.input.product_id,
      explanation: toolUseBlock.input.explanation,
    });
  }

  override createRequestInput(): ToolFunctionInputType<'view_product_image'> {
    return {
      explanation: this.explanation,
      product_id: this.productId,
    };
  }
}

export class ViewProductImageResponsePayload extends BaseToolUsageResponsePayload {
  public imageUrl: string;
  public encodedImage: string;

  constructor({ imageUrl, encodedImage }: { imageUrl: string; encodedImage: string }) {
    super('view_product_image');
    this.imageUrl = imageUrl;
    this.encodedImage = encodedImage;
  }

  public override toToolResultBlock(toolId: string): ToolResultBlockParam {
    return {
      tool_use_id: toolId,
      type: 'tool_result',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: this.encodedImage,
          },
        },
      ],
    };
  }
}

export const ViewProductImageTool = {
  requestClass: ViewProductImageRequestPayload,
  responseClass: ViewProductImageResponsePayload,
  functionSchema: {
    name: 'view_product_image',
    description: 'View the image for a product',
    input: z.object({
      explanation: z
        .string()
        .describe(
          'Explain why you want to view this product image in depth. What information are you trying to get from the image? Why is it important to you?',
        ),
      product_id: z.string().describe('The id of the product to view'),
    }),
  },
};
