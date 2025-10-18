import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import { COMMON_RESPONSE_TOOLS, TOOLS_DICT } from './tools';

import { ToolFunctionInputType } from './types';
import { FetchrLLMCommonResponseToolType, FetchrLLMToolType } from './toolTypes';
import { ChatCompletionMessageToolCall } from 'openai/resources';

// 2) For each tool type, the *instance* type of the requestClass
export type ToolUsageRequestPayloadMap = {
  [K in FetchrLLMToolType]: InstanceType<(typeof TOOLS_DICT)[K]['requestClass']>;
};

// 3) For each tool type, the *instance* type of the responseClass
export type ToolUsageResponsePayloadMap = {
  [K in FetchrLLMToolType | FetchrLLMCommonResponseToolType]: K extends FetchrLLMToolType
    ? InstanceType<(typeof TOOLS_DICT)[K]['responseClass']>
    : K extends FetchrLLMCommonResponseToolType
    ? InstanceType<(typeof COMMON_RESPONSE_TOOLS)[K]['responseClass']>
    : never;
};

export type ToolUsageResponsePayload = ToolUsageResponsePayloadMap[
  | FetchrLLMToolType
  | FetchrLLMCommonResponseToolType];
export type ToolUsageRequestPayload = ToolUsageRequestPayloadMap[FetchrLLMToolType];

export function createRequestPayloadForToolUsageRequestFromToolUseBlock<
  T extends FetchrLLMToolType,
>(
  toolUseBlock: ToolUseBlockParam & { input: ToolFunctionInputType<T> },
  fetchrLLMToolType: T,
): ToolUsageRequestPayloadMap[T] {
  const toolDef = TOOLS_DICT[fetchrLLMToolType];
  const toolRequestPayload = toolDef.requestClass.fromToolUseBlock({
    ...toolUseBlock,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: toolUseBlock.input as any,
  });
  return toolRequestPayload as ToolUsageRequestPayloadMap[T];
}

export function createRequestPayloadForToolUsageRequestFromChatCompletionMessageToolCall<
  T extends FetchrLLMToolType,
>(toolCall: ChatCompletionMessageToolCall, fetchrLLMToolType: T): ToolUsageRequestPayloadMap[T] {
  const toolDef = TOOLS_DICT[fetchrLLMToolType];
  const toolRequestPayload = toolDef.requestClass.fromChatCompletionMessageToolCall({
    ...toolCall,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: toolUseBlock.input as any,
  });
  return toolRequestPayload as ToolUsageRequestPayloadMap[T];
}

export function createRequestInputFromPayload<T extends FetchrLLMToolType>(
  payload: ToolUsageRequestPayloadMap[T],
): ToolFunctionInputType<T> {
  return payload.createRequestInput() as ToolFunctionInputType<T>;
}

export function createToolUsageResponseForToolUsageResponsePayload<
  T extends FetchrLLMToolType | FetchrLLMCommonResponseToolType,
>(payload: ToolUsageResponsePayloadMap[T], id: string): ToolResultBlockParam {
  // Narrow toolDef to the correct sub‐type by asserting index is T
  const toolResultBlock = payload.toToolResultBlock(id);
  return toolResultBlock;
}
