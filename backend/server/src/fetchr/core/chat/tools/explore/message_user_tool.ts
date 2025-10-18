import { z } from 'zod';
import { BaseToolUsageRequestPayload, BaseToolUsageResponsePayload } from '../../baseToolPayloads';
import { ToolFunctionInputType } from '../../types';
import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import { ChatCompletionMessageToolCall } from 'openai/resources';

export class MessageUserRequestPayload extends BaseToolUsageRequestPayload {
  public message: string;
  public blocking?: boolean;
  public suggestedResponses?: string[];

  constructor(input: ToolFunctionInputType<'message_user'>) {
    super('message_user');
    console.log('[Input]', input);
    const { message, blocking, suggestedResponses } = input;
    this.message = message;
    this.blocking = blocking;
    this.suggestedResponses = suggestedResponses;
    if (suggestedResponses) {
      this.blocking = true;
    }
  }

  static override fromToolUseBlock(
    toolUseBlock: ToolUseBlockParam & { input: ToolFunctionInputType<'message_user'> },
  ): MessageUserRequestPayload {
    const blocking = toolUseBlock.input.suggestedResponses ? true : toolUseBlock.input.blocking;
    return new MessageUserRequestPayload({
      message: toolUseBlock.input.message,
      blocking,
      suggestedResponses: toolUseBlock.input.suggestedResponses,
    });
  }

  static override fromChatCompletionMessageToolCall(
    toolCall: ChatCompletionMessageToolCall,
  ): MessageUserRequestPayload {
    const input = JSON.parse(toolCall.function.arguments);
    const blocking = input.suggestedResponses ? true : input.blocking;
    return new MessageUserRequestPayload({
      message: input.message,
      blocking,
      suggestedResponses: input.suggestedResponses,
    });
  }

  override createRequestInput(): ToolFunctionInputType<'message_user'> {
    return {
      message: this.message,
      blocking: this.blocking ?? true,
      suggestedResponses: this.suggestedResponses,
    };
  }
}

export class MessageUserResponsePayload extends BaseToolUsageResponsePayload {
  public message: string;

  constructor({ message }: { message: string }) {
    super('message_user');
    this.message = message;
  }

  override toToolResultBlock(toolId: string): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolId,
      content: this.message,
    };
  }
}

export const MessageUserTool = {
  requestClass: MessageUserRequestPayload,
  responseClass: MessageUserResponsePayload,
  functionSchema: {
    name: 'message_user',
    description: 'Message the user with a message',
    input: z.object({
      message: z.string().describe('The message to send to the user'),
      blocking: z
        .boolean()
        .describe(
          'Whether the tool should wait for a response from the user or continue execution',
        ),
      suggestedResponses: z
        .array(z.string())
        .optional()
        .describe('List of predefined response options that the user can select from.'),
    }),
  },
};
