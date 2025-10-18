import { inject, injectable } from 'inversify';
import { z } from 'zod';
import Groq from 'groq-sdk';
import { BaseService } from '../../base/service_injection/baseService';
import { GroqModel } from '@fetchr/schema/core/core';
import { Perf } from '../performance/performance';
import { SimpleMessage } from '../open_ai/openaiUtils';
import zodToJsonSchema from 'zod-to-json-schema';
import {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'groq-sdk/resources/chat/completions';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

@injectable()
export class GroqService extends BaseService {
  private readonly client: Groq;

  constructor(@inject(Perf) private perfService: Perf) {
    super('GroqService');
    if (!GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not set');
    }
    this.client = new Groq({
      apiKey: GROQ_API_KEY,
    });
  }

  private async _protoToGroqModel(model: GroqModel): Promise<string> {
    switch (model) {
      case GroqModel.GROQ_LLAMA_4_SCOUT_17B_16E_INSTRUCT:
        return 'meta-llama/llama-4-scout-17b-16e-instruct';
      case GroqModel.GROQ_LLAMA_4_MAVERICK_17B_128E_INSTRUCT:
        return 'meta-llama/llama-4-maverick-17b-128e-instruct';
      case GroqModel.GROQ_DEEPSEEK_R1_DISTILL_LLAMA_70B:
        return 'deepseek-r1-distill-llama-70b';
      case GroqModel.GROQ_ALLAM_2_7B:
        return 'allam-2-7b';
      case GroqModel.GROQ_MISTRAL_SABA_24B:
        return 'mistral-saba-24b';
      case GroqModel.GROQ_QWEN_QWQ_32B:
        return 'qwen-qwq-32b';
      case GroqModel.GROQ_PLAYAI_TTS:
        return 'playai-tts';
      case GroqModel.GROQ_PLAYAI_TTS_ARABIC:
        return 'playai-tts-arabic';
      default:
        throw new Error(`Unknown model: ${model}`);
    }
  }

  private _convertFunctionsToTools(
    functions: Array<{ name: string; input: z.ZodSchema; description?: string }>,
  ): ChatCompletionTool[] {
    return functions.map((f): ChatCompletionTool => {
      return {
        type: 'function',
        function: {
          name: f.name,
          description: f.description,
          parameters: {
            ...zodToJsonSchema(f.input),
          },
          // strict: true,
        },
      };
    });
  }

  /**
   * Unified chat completion method that:
   *  1) Accepts either a string prompt or an array of SimpleMessages.
   *  2) Supports optional function calling (via "functions").
   *  3) Supports optional structured output parsing (via a Zod schema in "zodSchema").
   *  4) Returns either a typed object (T) if using a schema, or the entire ChatCompletion object.
   */
  public async submitChatCompletion<T = ChatCompletionAssistantMessageParam>(
    promptOrMessages: string | ChatCompletionMessageParam[],
    {
      model = GroqModel.GROQ_LLAMA_4_SCOUT_17B_16E_INSTRUCT,
      temperature = 1.0,
      tools = [],
      zodSchema,
      options = {},
    }: {
      model?: GroqModel;
      temperature?: number;
      tools?: Array<{ name: string; input: z.ZodSchema; description?: string }>;
      zodSchema?: z.ZodSchema<T>;
      options?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    return this.perfService.track(
      `groqService.submitChatCompletion.${await this._protoToGroqModel(model)}`,
      async () => {
        const messages: ChatCompletionMessageParam[] =
          typeof promptOrMessages === 'string'
            ? [{ role: 'user', content: promptOrMessages }]
            : promptOrMessages;

        try {
          this.logService.info('Submitting chat completion to Groq', {
            metadata: {
              model: await this._protoToGroqModel(model),
              temperature,
              options,
              messages,
            },
          });

          if (zodSchema) {
            messages.push({
              role: 'user',
              content:
                'Please respond with the JSON object that matches the following Zod schema: ' +
                zodSchema.toString(),
            });
          }

          const groqTools =
            tools && tools.length > 0 ? this._convertFunctionsToTools(tools) : undefined;

          this.logService.info('Groq tools', {
            metadata: { groqTools },
          });

          if (zodSchema) {
            messages.forEach(message => {
              message.content = JSON.stringify(message.content);
            });
          }

          const completion: ChatCompletionAssistantMessageParam = await this.client.chat.completions
            .create({
              model: await this._protoToGroqModel(model),
              messages,
              temperature,
              tools: groqTools,
              tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
              ...options,
              response_format: zodSchema ? { type: 'json_object' } : undefined,
            })
            .then(completion => completion.choices[0].message);

          this.logService.info('Groq completion', {
            metadata: { completion },
          });

          if (zodSchema) {
            const parsed = zodSchema.parse(completion.content);
            return parsed;
          }

          return completion as T;
        } catch (error) {
          this.logService.error(`Error in chat completion`, {
            metadata: { messages, model, temperature, options },
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
      model = GroqModel.GROQ_LLAMA_4_SCOUT_17B_16E_INSTRUCT,
      temperature = 1.0,
      tools = [],
      zodSchema,
      options = {},
    }: {
      model?: GroqModel;
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
          options,
          zodSchema,
        }),
      ),
    );
  }
}
