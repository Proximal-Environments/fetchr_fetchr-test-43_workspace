import {
  TextBlockParam,
  CacheControlEphemeral,
  ToolResultBlockParam,
  ToolUseBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources';
import {
  ChatCompletionContentPartText,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import { JsonValue } from '@prisma/client/runtime/library';
import {
  createRequestInputFromPayload,
  createRequestPayloadForToolUsageRequestFromToolUseBlock,
  createToolUsageResponseForToolUsageResponsePayload,
  ToolUsageRequestPayloadMap,
  ToolUsageResponsePayloadMap,
} from './tools.config';
import { COMMON_RESPONSE_TOOLS, TOOLS_DICT } from './tools';
import zodToJsonSchema from 'zod-to-json-schema';
import { z } from 'zod';
import { FetchrLLMCommonResponseToolType, FetchrLLMToolType } from './toolTypes';
import { logService } from '../../base/logging/logService';
import { ChatCompletionToolMessageParam } from 'groq-sdk/resources/chat/completions';
export class ToolUsageRequest<T extends FetchrLLMToolType> implements ToolUseBlockParam {
  id: string;
  input: unknown;
  name: T;
  type: 'tool_use';
  readonly fetchrLLMToolType: T;
  readonly payload: ToolUsageRequestPayloadMap[T];

  constructor({
    id,
    input,
    type,
    fetchrLLMToolType,
    payload,
    name,
  }: {
    id: string;
    input: ToolFunctionInputType<T>;
    type: 'tool_use';
    fetchrLLMToolType: T;
    payload: ToolUsageRequestPayloadMap[T];
    name: T;
  }) {
    this.id = id;
    this.input = input;
    this.type = type;
    this.fetchrLLMToolType = fetchrLLMToolType;
    this.payload = payload;
    this.name = name;
  }

  static createFromChatCompletionMessageToolCall<T extends FetchrLLMToolType>(
    toolCall: ChatCompletionMessageToolCall,
  ): ToolUsageRequest<T> {
    return ToolUsageRequest.createFromToolUseBlock({
      id: toolCall.id,
      type: 'tool_use',
      name: toolCall.function.name as T,
      input: JSON.parse(toolCall.function.arguments),
    });
  }

  static createFromToolUseBlock<T extends FetchrLLMToolType>(
    toolUseBlock: ToolUseBlockParam & {
      name: T;
    },
  ): ToolUsageRequest<T> {
    const payload = createRequestPayloadForToolUsageRequestFromToolUseBlock(
      { ...toolUseBlock, input: toolUseBlock.input as ToolFunctionInputType<T> },
      toolUseBlock.name,
    );

    return new ToolUsageRequest<T>({
      ...toolUseBlock,
      input: toolUseBlock.input as ToolFunctionInputType<T>,
      fetchrLLMToolType: toolUseBlock.name,
      payload,
    });
  }

  static createFromPayload<T extends FetchrLLMToolType>(
    payload: ToolUsageRequestPayloadMap[T],
    tool_id: string,
  ): ToolUsageRequest<T> {
    const input = createRequestInputFromPayload(payload);
    return new ToolUsageRequest<T>({
      id: tool_id,
      input,
      type: 'tool_use',
      fetchrLLMToolType: payload.fetchrLLMToolType as T,
      payload,
      name: payload.fetchrLLMToolType as T,
    });
  }

  static fromJson<T extends FetchrLLMToolType>(json: Record<string, unknown>): ToolUsageRequest<T> {
    return new ToolUsageRequest({
      id: json.id as string,
      input: json.input as ToolFunctionInputType<T>,
      type: 'tool_use',
      fetchrLLMToolType: json.fetchrLLMToolType as T,
      payload: TOOLS_DICT[json.fetchrLLMToolType as T].requestClass.fromJson(
        json.payload as JsonValue,
      ) as ToolUsageRequestPayloadMap[T],
      name: json.name as T,
    });
  }

  getAnthropicToolCall(): ToolUseBlockParam {
    return {
      id: this.id,
      input: this.input,
      name: this.name,
      type: 'tool_use',
    };
  }

  getGroqToolCall(): ChatCompletionToolMessageParam {
    return {
      role: 'tool',
      tool_call_id: this.id,
      content: JSON.stringify(this.input),
    };
  }

  getOpenAIToolCall(): ChatCompletionMessageParam {
    return {
      role: 'assistant',
      tool_calls: [
        {
          id: this.id,
          function: {
            arguments: JSON.stringify(this.input),
            name: this.name,
          },
          type: 'function',
        },
      ],
    };
  }

  toJson(): JsonValue {
    return {
      id: this.id,
      input: this.input as JsonValue,
      name: this.name,
      type: 'tool_use',
      payload: this.payload.toJson() as JsonValue,
      fetchrLLMToolType: this.fetchrLLMToolType,
    };
  }
}

export class ToolUsageResponse<T extends FetchrLLMToolType | FetchrLLMCommonResponseToolType>
  implements ToolResultBlockParam
{
  public tool_use_id: string;
  public is_error?: boolean;
  public cache_control?: CacheControlEphemeral | null | undefined;
  public type: 'tool_result';
  public content?: string | Array<TextBlockParam | ImageBlockParam>;
  public payload: ToolUsageResponsePayloadMap[T];

  constructor({
    tool_use_id,
    is_error,
    cache_control,
    content,
    payload,
  }: {
    tool_use_id: string;
    payload: ToolUsageResponsePayloadMap[T];
    is_error?: boolean;
    cache_control?: CacheControlEphemeral | null | undefined;
    content?: string | Array<TextBlockParam | ImageBlockParam>;
  }) {
    this.tool_use_id = tool_use_id;
    this.is_error = is_error;
    this.cache_control = cache_control;
    this.content = content;
    this.type = 'tool_result';
    this.payload = payload;
  }

  public getAnthropicToolResponse(): ToolResultBlockParam {
    const toolResultBlock = this.payload.toToolResultBlock(this.tool_use_id);
    return toolResultBlock;
  }

  public getOpenAIToolResponse(): ChatCompletionMessageParam {
    const toolResult = this.payload.toToolResultBlock(this.tool_use_id);
    if (Array.isArray(toolResult.content)) {
      return {
        role: 'tool',
        tool_call_id: this.tool_use_id,
        content: toolResult.content
          .map(block => {
            if ('text' in block) {
              return {
                type: 'text',
                text: block.text,
              } as ChatCompletionContentPartText;
            }
            return null;
          })
          .filter(Boolean) as ChatCompletionContentPartText[],
      };
    }

    return {
      role: 'tool',
      tool_call_id: this.tool_use_id,
      content: toolResult.content ?? '',
    };
  }

  public getGroqToolResponse(): ChatCompletionToolMessageParam {
    const toolResult = this.payload.toToolResultBlock(this.tool_use_id);
    if (Array.isArray(toolResult.content)) {
      return {
        role: 'tool',
        tool_call_id: this.tool_use_id,
        content: toolResult.content
          .map(block => {
            if ('text' in block) {
              return block.text;
            } else if (block.type === 'image') {
              throw new Error('Image tool result blocks are not supported in Groq');
            }
            return '';
          })
          .join('\n'),
      };
    }

    return {
      role: 'tool',
      tool_call_id: this.tool_use_id,
      content: toolResult.content ?? '',
    };
  }

  static createFromPayload<T extends FetchrLLMToolType | FetchrLLMCommonResponseToolType>(
    payload: ToolUsageResponsePayloadMap[T],
    tool_id: string,
  ): ToolUsageResponse<T> {
    const toolResult = createToolUsageResponseForToolUsageResponsePayload(payload, tool_id);

    return new ToolUsageResponse({
      ...toolResult,
      payload,
    });
  }

  toJson(): JsonValue {
    return {
      tool_use_id: this.tool_use_id,
      is_error: this.is_error,
      cache_control: this.cache_control as JsonValue,
      content: this.content as JsonValue,
      type: 'tool_result',
      payload: this.payload.toJson() as JsonValue,
    };
  }

  static fromJson<T extends FetchrLLMToolType>(
    json: Record<string, unknown>,
  ): ToolUsageResponse<T> {
    try {
      return new ToolUsageResponse({
        tool_use_id: json.tool_use_id as string,
        is_error: json.is_error as boolean | undefined,
        cache_control: json.cache_control as CacheControlEphemeral | null | undefined,
        content: json.content as string | Array<TextBlockParam | ImageBlockParam> | undefined,
        payload: ((): ToolUsageResponsePayloadMap[T] => {
          const typedPayload = json.payload as { fetchrLLMToolType?: string };
          if (typedPayload?.fetchrLLMToolType && typedPayload.fetchrLLMToolType in TOOLS_DICT) {
            return TOOLS_DICT[typedPayload.fetchrLLMToolType as T].responseClass.fromJson(
              // @ts-expect-error - temporary workaround for type compatibility. Nothing is wrong with the type.
              json.payload as JsonValue,
            ) as ToolUsageResponsePayloadMap[T];
          } else if (
            typedPayload?.fetchrLLMToolType &&
            typedPayload.fetchrLLMToolType in COMMON_RESPONSE_TOOLS
          ) {
            return COMMON_RESPONSE_TOOLS[
              typedPayload.fetchrLLMToolType as FetchrLLMCommonResponseToolType
            ].responseClass.fromJson(json.payload as JsonValue) as ToolUsageResponsePayloadMap[T];
          } else {
            throw new Error(
              `Unknown or missing tool type: ${
                typedPayload?.fetchrLLMToolType ?? '[no type provided]'
              }`,
            );
          }
        })(),
      });
    } catch (error) {
      logService.error('Error creating tool usage response from json', {
        metadata: { json },
        serviceName: 'ToolUsageResponse',
      });
      throw error;
    }
  }
}

// export type ToolUsageRequestType = {
//   [K in FetchrLLMToolType]: ToolUsageRequest<K>;
// }[FetchrLLMToolType];

// export type ToolUsageResponseType = {
//   [K in FetchrLLMToolType]: ToolUsageResponse<K>;
// }[FetchrLLMToolType];

export type ToolUsageRequestType = ToolUsageRequest<FetchrLLMToolType>;
export type ToolUsageResponseType = ToolUsageResponse<
  FetchrLLMToolType | FetchrLLMCommonResponseToolType
>;

export type AnthropicFunction = {
  name: string;
  description?: string;
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolFunctionInputType<K extends FetchrLLMToolType> = z.infer<
  (typeof TOOLS_DICT)[K]['functionSchema']['input']
>;

export function getAnthropicFunction(toolType: FetchrLLMToolType): AnthropicFunction {
  return {
    ...TOOLS_DICT[toolType]['functionSchema'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: zodToJsonSchema(TOOLS_DICT[toolType]['functionSchema'].input) as any,
  };
}
