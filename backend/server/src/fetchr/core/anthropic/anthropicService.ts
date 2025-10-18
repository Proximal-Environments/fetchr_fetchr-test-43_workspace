import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicModel } from '../../../proto/core/core';
import { MessageParam, ToolUseBlock, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import { ToolFunctionInputType } from '../chat/types';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import {
  createRequestPayloadForToolUsageRequestFromToolUseBlock,
  ToolUsageRequestPayloadMap,
} from '../chat/tools.config';
import { FetchrLLMToolType } from '../chat/toolTypes';
import { Perf } from '../performance/performance';

@injectable()
export class AnthropicService extends BaseService {
  private readonly client: Anthropic;

  constructor(@inject(Perf) private perfService: Perf) {
    super('AnthropicService');
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logService.error('ANTHROPIC_API_KEY not found in environment variables');
      throw new Error('ANTHROPIC_API_KEY not found in environment variables');
    }

    this.client = new Anthropic({
      apiKey: apiKey,
    });
  }

  private _convertFunction(
    f:
      | {
          name: string;
          description?: string;
          parameters?: {
            type: 'object';
            properties: Record<string, unknown>;
            required?: string[];
          };
          input?: z.ZodSchema;
        }
      | { functionSchema: { name: string; input: z.ZodSchema; description?: string } },
  ): {
    name: string;
    description?: string;
    input_schema: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  } {
    if ('functionSchema' in f) {
      return {
        name: f.functionSchema.name,
        description: f.functionSchema.description || '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: zodToJsonSchema(f.functionSchema.input) as any,
      };
    }
    this.logService.info('Anthropic function schema', {
      metadata: {
        f,
      },
    });
    if (f.input) {
      return {
        name: f.name,
        description: f.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: zodToJsonSchema(f.input) as any,
      };
    }
    return {
      name: f.name,
      description: f.description,
      input_schema: {
        type: 'object',
        properties: f.parameters?.properties || {},
        required: f.parameters?.required || [],
      },
    };
  }

  private _getAnthropicModelString(model: AnthropicModel): string {
    switch (model) {
      case AnthropicModel.CLAUDE_3_5_SONNET_LATEST:
        return 'claude-3-5-sonnet-latest';
      case AnthropicModel.CLAUDE_3_7_SONNET_LATEST:
        return 'claude-3-7-sonnet-latest';
      default:
        throw new Error('Unsupported Anthropic model');
    }
  }

  public async submitSingleToolCallChatCompletion<T extends FetchrLLMToolType>(
    messages: MessageParam[],
    tool: { name: string; input: z.ZodSchema; description?: string },
    model: AnthropicModel = AnthropicModel.CLAUDE_3_5_SONNET_LATEST,
    retries: number = 3,
    chatId?: string,
  ): Promise<ToolUsageRequestPayloadMap[T]> {
    try {
      const response = await this.submitChatCompletion(
        messages,
        {
          model,
          functions: [tool],
        },
        chatId,
      );

      if (!response.content.some(c => c.type === 'tool_use')) {
        throw new Error('Expected tool calls in response but got none');
      }

      const toolUse = response.content.find(c => c.type === 'tool_use');
      if (!toolUse) {
        throw new Error('No tool use found in response');
      }

      return createRequestPayloadForToolUsageRequestFromToolUseBlock(
        toolUse as ToolUseBlockParam & { input: ToolFunctionInputType<T> },
        tool.name as T,
      );
    } catch (error) {
      this.logService.warn('Error in submitToolCallChatCompletion', {
        metadata: { error, retries },
      });
      if (retries > 0) {
        return this.submitSingleToolCallChatCompletion(messages, tool, model, retries - 1, chatId);
      }
      throw error;
    }
  }

  public async submitChatCompletion<T = Anthropic.Message>(
    promptOrMessages: string | MessageParam[],
    {
      model = AnthropicModel.CLAUDE_3_7_SONNET_LATEST,
      temperature = 1.0,
      functions = [],
      options = {},
      enableWebSearch = false,
      zodSchema,
    }: {
      model?: AnthropicModel;
      temperature?: number;
      functions?: Array<{ name: string; input: z.ZodSchema; description?: string }>;
      options?: Record<string, unknown>;
      enableWebSearch?: boolean;
      zodSchema?: z.ZodSchema<T>;
    } = {},
    chatId?: string,
  ): Promise<T> {
    return this.perfService.track(
      `anthropicService.submitChatCompletion.${this._getAnthropicModelString(model)}`,
      async () => {
        const anthropicMessages: MessageParam[] =
          typeof promptOrMessages === 'string'
            ? [{ role: 'user', content: promptOrMessages }]
            : promptOrMessages;

        // const anthropicMessages = messages.map(this._simpleMessageToAnthropicMessage);

        try {
          const params: Anthropic.Messages.MessageCreateParams = {
            model: this._getAnthropicModelString(model),
            messages: anthropicMessages,
            temperature,
            max_tokens: 4096,
            ...options,
          };
          params.tools = [];
          params.tool_choice = { type: 'any' };
          // Add tools if functions are provided
          if (functions.length > 0) {
            params.tools = functions.map(f => this._convertFunction(f));
            params.tool_choice = { type: 'any' };
          }

          if (zodSchema) {
            params.tools = [];
            params.tools?.push({
              type: 'custom',
              name: 'respond',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              input_schema: zodToJsonSchema(zodSchema) as any,
            });
            // params.tool_choice = { type: 'tool', name: 'respond' };
          }
          if (enableWebSearch) {
            params.tools?.push({
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: 1,
            });
          }
          this.logService.info('Anthropic params', {
            metadata: { params, chatId },
          });

          const response = await this.client.messages.create(params);

          this.logService.info(`Anthropic response`, {
            metadata: { response, chatId },
          });

          if (zodSchema) {
            return zodSchema.parse(
              (response.content[response.content.length - 1] as ToolUseBlock).input,
            );
          }

          // Handle both sync and stream responses
          if ('content' in response) {
            return response as T;
          } else {
            throw new Error('Received unexpected stream response');
          }
        } catch (error) {
          this.logService.error('Error in Anthropic chat completion', {
            metadata: { model, temperature, functions, options, messages: anthropicMessages },
            error,
          });
          throw error;
        }
      },
    );
  }
}
