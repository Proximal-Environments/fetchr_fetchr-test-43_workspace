import { z } from 'zod';
import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolFunctionInputType } from '../../types';
import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';

export class PlaceOrderRequestPayload extends BaseToolUsageRequestPayload {
  public orderId: string;

  constructor(input: ToolFunctionInputType<'place_order'>) {
    super('place_order');
    const { orderId } = input;
    this.orderId = orderId;
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & { input: ToolFunctionInputType<'place_order'> },
  ): PlaceOrderRequestPayload {
    return new PlaceOrderRequestPayload({
      orderId: toolUseBlock.input.orderId,
    });
  }

  override createRequestInput(): ToolFunctionInputType<'place_order'> {
    return {
      orderId: this.orderId,
    };
  }
}

export class PlaceOrderResponsePayload extends BaseToolUsageResponsePayload {
  constructor() {
    super('place_order');
  }

  override toToolResultBlock(toolId: string): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolId,
      content: 'Order placed successfully',
    };
  }
}

export const PlaceOrderTool = {
  requestClass: PlaceOrderRequestPayload,
  responseClass: PlaceOrderResponsePayload,
  functionSchema: {
    name: 'place_order',
    description: 'Place an order',
    input: z.object({
      orderId: z.string().describe('The order id to place'),
    }),
  },
};
