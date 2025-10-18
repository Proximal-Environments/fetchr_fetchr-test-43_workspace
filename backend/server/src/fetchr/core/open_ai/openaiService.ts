import { inject, injectable } from 'inversify';
import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionUserMessageParam,
  ChatModel,
  EmbeddingModel,
} from 'openai/resources';
import { BaseService } from '../../base/service_injection/baseService';
import { OpenAIEmbeddingModel, OpenAIModel } from '@fetchr/schema/core/core';
import { SimpleMessage } from './openaiUtils';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { PopulatedExploreResponseMessage } from '@fetchr/schema/base/base';
import { IMAGES_CONTEXT_PROMPT } from '../../modules/explore/explorePrompts';
import { Perf } from '../performance/performance';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

@injectable()
export class OpenAIService extends BaseService {
  private readonly client: OpenAI;

  constructor(@inject(Perf) private perfService: Perf) {
    super('OpenAIService');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    this.client = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
  }

  private async _protoToOpenAIEmbeddingModel(model: OpenAIEmbeddingModel): Promise<EmbeddingModel> {
    switch (model) {
      case OpenAIEmbeddingModel.TEXT_EMBEDDING_3_LARGE:
        return 'text-embedding-3-large';
      default:
        throw new Error(`Unknown embedding model: ${model}`);
    }
  }

  private async _protoToOpenAIModel(model: OpenAIModel): Promise<ChatModel> {
    switch (model) {
      case OpenAIModel.GPT_4O:
        return 'gpt-4o';
      case OpenAIModel.GPT_3_5_TURBO:
        return 'gpt-3.5-turbo';
      case OpenAIModel.O1_MINI:
        return 'o1-mini';
      case OpenAIModel.O1_PREVIEW:
        return 'o1-preview';
      case OpenAIModel.O1:
        return 'o1';
      case OpenAIModel.O3_MINI:
        return 'o3-mini';
      case OpenAIModel.GPT_4_1_MINI:
        return 'gpt-4.1-mini';
      case OpenAIModel.GPT_4_1_NANO:
        return 'gpt-4.1-nano';
      case OpenAIModel.GPT_4_1:
        return 'gpt-4.1';
      case OpenAIModel.O4_MINI:
        return 'o4-mini';
      case OpenAIModel.O3:
        return 'o3';
      default:
        throw new Error(`Unknown model: ${model}`);
    }
  }

  async embedText(
    text: string,
    model: OpenAIEmbeddingModel = OpenAIEmbeddingModel.TEXT_EMBEDDING_3_LARGE,
  ): Promise<number[]> {
    try {
      const openaiModel = await this._protoToOpenAIEmbeddingModel(model);
      const response = await this.client.embeddings.create({
        input: text,
        model: openaiModel,
      });
      return response.data[0].embedding;
    } catch (error) {
      this.logService.error(`Error embedding text: ${error}`, {
        metadata: { error, text, model },
      });
      throw error;
    }
  }

  async batchEmbedText(
    texts: string[],
    model: OpenAIEmbeddingModel = OpenAIEmbeddingModel.TEXT_EMBEDDING_3_LARGE,
  ): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embedText(text, model)));
  }

  /**
   * Unified chat completion method that:
   *  1) Accepts either a string prompt or an array of SimpleMessages.
   *  2) Supports optional function calling (via "functions").
   *  3) Supports optional structured output parsing (via a Zod schema in "zodSchema").
   *  4) Returns either a typed object (T) if using a schema, or the entire ChatCompletion object.
   */
  public async submitChatCompletion<T = ChatCompletion>(
    promptOrMessages: string | ChatCompletionMessageParam[],
    {
      model = OpenAIModel.GPT_4O,
      temperature = 1.0,
      tools = [],
      zodSchema,
      options = {},
      reasoningEffort,
    }: {
      model?: OpenAIModel;
      temperature?: number;
      tools?: Array<{ name: string; input: z.ZodSchema; description?: string }>;
      zodSchema?: z.ZodSchema<T>;
      options?: Record<string, unknown>;
      reasoningEffort?: 'high' | 'medium' | 'low';
    } = {},
  ): Promise<T> {
    return this.perfService.track(
      `openaiService.submitChatCompletion.${await this._protoToOpenAIModel(model)}`,
      async () => {
        const messages: ChatCompletionMessageParam[] =
          typeof promptOrMessages === 'string'
            ? [{ role: 'user', content: promptOrMessages }]
            : promptOrMessages;

        const mappedFunctions: ChatCompletionTool[] | undefined = tools
          ? tools.map((f): ChatCompletionTool => {
              return {
                type: 'function',
                function: {
                  name: f.name,
                  description: f.description,
                  parameters: {
                    ...zodToJsonSchema(f.input),
                  },
                },
              };
            })
          : undefined;

        this.logService.info('Mapped functions', {
          metadata: { mappedFunctions },
        });

        const openaiModel = await this._protoToOpenAIModel(model);

        // For O1 models, override roles to 'user'
        if (model === OpenAIModel.O1_MINI || model === OpenAIModel.O1_PREVIEW) {
          messages.forEach(m => {
            if (m.role === 'system') {
              const newMessage = {
                ...m,
                role: 'user' as const,
              };
              Object.assign(m, newMessage);
            }
          });
        }

        try {
          if (zodSchema) {
            const completion = await this.client.beta.chat.completions.parse({
              model: openaiModel,
              messages,
              temperature,
              response_format: zodResponseFormat(zodSchema, 'structured_result'),
              reasoning_effort: reasoningEffort,
              ...options,
            });

            this.logService.info('OpenAI response', {
              metadata: { completion },
            });

            const parsed = completion.choices[0].message.parsed;
            if (!parsed) {
              throw new Error('No structured parse returned from the response.');
            }
            return parsed;
          } else {
            this.logService.info('OpenAI params', {
              metadata: {
                model: openaiModel,
                temperature,
                tools: tools,
                options,
                messages,
              },
            });

            const completion = await this.client.chat.completions.create({
              model: openaiModel,
              messages,
              temperature,
              tools: tools.length ? mappedFunctions : undefined,
              tool_choice: tools.length ? 'auto' : undefined,
              ...options,
            });

            this.logService.info('OpenAI response', {
              metadata: { completion },
            });

            return completion as T;
          }
        } catch (error) {
          this.logService.error(`Error in chat completion`, {
            metadata: { messages, model: openaiModel, temperature, tools: tools, options },
            error,
          });
          throw error;
        }
      },
    );
  }

  public async batchSubmitChatCompletion<T>(
    messagesArray: Array<string | SimpleMessage[]>,
    {
      model = OpenAIModel.GPT_4O,
      temperature = 1.0,
      tools = [],
      zodSchema,
      options = {},
    }: {
      model?: OpenAIModel;
      temperature?: number;
      tools?: Array<{ name: string; input: z.ZodSchema; description?: string }>;
      zodSchema?: z.ZodSchema<T>;
      options?: Record<string, unknown>;
    } = {},
  ): Promise<Array<ChatCompletion | T>> {
    return Promise.all(
      messagesArray.map(msgOrPrompt =>
        this.submitChatCompletion<T>(msgOrPrompt, {
          model,
          temperature,
          tools,
          zodSchema,
          options,
        }),
      ),
    );
  }

  public exploreMessageToOpenAIUserMessage(
    message: PopulatedExploreResponseMessage,
  ): ChatCompletionUserMessageParam {
    if (message.message?.$case === 'basicMessage') {
      return {
        content: [
          {
            type: 'text',
            text: message.message.basicMessage.content,
          },
          ...message.message.basicMessage.imageUrls.map(imageUrl => ({
            type: 'image_url' as const,
            image_url: {
              url: imageUrl,
              detail: 'auto' as const,
            },
          })),
        ],
        role: 'user',
      };
    }
    throw new Error('Unsupported message type');
  }

  public imageUrlsToOpenAIMessages(imageUrls: string[]): ChatCompletionMessageParam[] {
    if (imageUrls.length === 0) {
      return [];
    }
    return [
      {
        content: [
          {
            type: 'text',
            text: IMAGES_CONTEXT_PROMPT,
          },
          ...imageUrls.map(imageUrl => ({
            type: 'image_url' as const,
            image_url: {
              url: imageUrl,
              detail: 'auto' as const,
            },
          })),
        ],
        role: 'user',
      },
    ];
  }
}
