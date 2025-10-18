import { JsonArray, JsonValue } from '@prisma/client/runtime/library';
import { supabaseDb } from '../../base/database/supabaseDb';
import {
  getS3Service,
  getSupabaseStorageService,
  getRedisService,
  getPerfService,
} from '../lazyServices';
import { AnthropicModel } from '@fetchr/schema/core/core';
import {
  ToolFunctionInputType,
  ToolUsageRequest,
  ToolUsageRequestType,
  ToolUsageResponse,
  ToolUsageResponseType,
} from './types';
import { ContentBlockParam, MessageParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import { ChatCompletionMessage, ChatCompletionMessageParam } from 'openai/resources';
import { ToolUsageRequestPayloadMap, ToolUsageResponsePayloadMap } from './tools.config';
import { COMMON_RESPONSE_TOOLS, TOOLS_DICT } from './tools';
import { FetchrLLMCommonResponseToolType, FetchrLLMToolType } from './toolTypes';
import { assertNever } from '../../../shared/utils';
import { ErrorResponsePayload } from './tools/common_tools';
import { v4 as uuidv4 } from 'uuid';
import { SuggestProductsToUserResponsePayload } from './tools/explore/suggest_products_to_user_tool';
import { SuggestStylesToUserResponsePayload } from './tools/explore/suggest_styles_to_user_tool';
import { logService } from '../../base/logging/logService';
import { ChatCompletionMessageParam as GroqChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

export type FetchrTextContentBlock = {
  type: 'text';
  text: string;
};

export type FetchrImageContentBlock =
  | {
      type: 'image';
      image: Buffer;
      caption?: string;
    }
  | {
      type: 'image';
      imageUrl: string;
      caption?: string;
    };

export type FetchrToolUsageRequestContentBlock = ToolUsageRequestType;

export type FetchrToolUsageResponseContentBlock = ToolUsageResponseType;

export type FetchrContentBlock =
  | FetchrTextContentBlock
  | FetchrToolUsageRequestContentBlock
  | FetchrToolUsageResponseContentBlock
  | FetchrImageContentBlock;

// const chatsTable = NODE_ENV === 'production' ? supabaseDb.chats : supabaseDb.chats_dev;
const chatsTable = supabaseDb.chats;

export class FetchrMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<FetchrContentBlock>;
  timestamp?: number;

  constructor(
    role: 'user' | 'assistant' | 'system',
    content: string | Array<FetchrContentBlock>,
    timestamp?: number,
  ) {
    this.role = role;
    this.content = content;
    this.timestamp = timestamp;
  }

  static async fromGroqMessage(message: GroqChatCompletionMessageParam): Promise<FetchrMessage> {
    if (message.role === 'tool') {
      throw new Error('Tool message not implemented');
    } else if (message.role === 'assistant') {
      if (message.tool_calls?.length) {
        const contentBlocks = await Promise.all(
          message.tool_calls.map(async (toolCall): Promise<FetchrContentBlock> => {
            return ToolUsageRequest.createFromChatCompletionMessageToolCall(toolCall);
          }),
        );

        if (message.content?.length) {
          const text = message.content;
          contentBlocks.push({ type: 'text', text });
        }

        return new FetchrMessage(message.role, contentBlocks);
      }
      // Handle case where assistant has no tool calls
      if (message.content?.length) {
        return new FetchrMessage(message.role, message.content);
      }

      throw new Error('Assistant message content is required');
    } else if (message.role === 'user') {
      if (typeof message.content === 'string') {
        return new FetchrMessage(message.role, message.content);
      } else if (Array.isArray(message.content)) {
        const contentBlocks = await Promise.all(
          message.content.map(async (contentBlock): Promise<FetchrContentBlock> => {
            if (contentBlock.type === 'text') {
              return { type: 'text', text: contentBlock.text };
            } else if (contentBlock.type === 'image_url') {
              return { type: 'image', imageUrl: contentBlock.image_url.url };
            } else {
              assertNever(contentBlock);
            }
          }),
        );
        return new FetchrMessage(message.role, contentBlocks);
      } else {
        throw new Error('User message content is required');
      }
    } else if (message.role === 'system') {
      if (message.content?.length) {
        const text = message.content;
        return new FetchrMessage(message.role, text);
      } else {
        throw new Error('System message content is required');
      }
    } else {
      throw new Error('Invalid message role');
    }
  }

  static async fromOpenaiMessage(message: ChatCompletionMessage): Promise<FetchrMessage> {
    // Convert function/tool roles to assistant role
    const role = message.role;

    if (typeof message.content === 'string') {
      return new FetchrMessage(role as 'user' | 'assistant' | 'system', message.content);
    } else if (Array.isArray(message.tool_calls)) {
      const content = await Promise.all(
        message.tool_calls.map(async (toolCall): Promise<FetchrContentBlock> => {
          return ToolUsageRequest.createFromChatCompletionMessageToolCall(toolCall);
        }),
      );
      return new FetchrMessage(role as 'user' | 'assistant' | 'system', content);
    } else {
      throw new Error('Invalid message content type');
    }
  }

  static async fromAnthropicMessage(message: MessageParam): Promise<FetchrMessage> {
    if (typeof message.content === 'string') {
      return new FetchrMessage(message.role, message.content);
    } else {
      const content = await Promise.all(
        message.content.map(async (contentBlock): Promise<FetchrContentBlock> => {
          if (contentBlock.type === 'text') {
            return {
              type: 'text',
              text: contentBlock.text,
            };
          } else if (contentBlock.type === 'tool_use') {
            if (!(contentBlock.name in TOOLS_DICT || contentBlock.name in COMMON_RESPONSE_TOOLS)) {
              throw new Error(
                `Invalid tool name: ${contentBlock.name}. Please register the tool first.`,
              );
            }

            const toolRequest = ToolUsageRequest.createFromToolUseBlock({
              ...contentBlock,
              name: contentBlock.name as FetchrLLMToolType,
            });
            return toolRequest as ToolUsageRequestType;
          } else if (contentBlock.type === 'tool_result') {
            throw new Error('Tool result not implemented');
            // return ToolUsageResponse.createFromToolResultBlock(
            //   contentBlock,
            //   contentBlock.tool_use_id,
            // );
          } else if (contentBlock.type === 'image') {
            return {
              type: 'image',
              image: Buffer.from(contentBlock.source.data, 'base64'),
            };
          } else if (contentBlock.type === 'document') {
            throw new Error('Document not implemented');
          } else {
            assertNever(contentBlock);
          }
        }),
      );
      return new FetchrMessage(message.role, content);
    }
  }
}

export class PersistedChatHistory {
  private chatId?: string;
  public messages: FetchrMessage[] = [];
  private defaultModel: AnthropicModel;
  private updateQueue: Promise<void> = Promise.resolve();
  private isTemporary: boolean = false;

  private async queueUpdate(updateFn: () => Promise<void>): Promise<void> {
    this.updateQueue = this.updateQueue.then(updateFn).catch(err => {
      logService.error('Update failed', {
        metadata: { error: err },
        serviceName: 'PersistedChatHistory',
      });
    });
    return this.updateQueue;
  }

  public static async initMultipleChats(
    chatIds: string[],
    shouldReviveIfChatIsBroken: boolean = false,
  ): Promise<PersistedChatHistory[]> {
    const perfService = await getPerfService();
    const perfTracker = perfService.start('PersistedChatHistory.initMultipleChats');
    try {
      if (!chatIds.length) return [];

      // Initialize chat history objects with provided IDs
      const chatHistories = chatIds.map(id => new PersistedChatHistory(id));

      // Skip processing for temporary chat histories
      const nonTemporaryChatIds: string[] = [];
      const nonTemporaryChatHistories: PersistedChatHistory[] = [];
      const idToIndexMap = new Map<string, number>();

      // Filter out temporary chat histories
      chatHistories.forEach((chatHistory, index) => {
        if (!chatHistory.isTemporary && chatHistory.chatId) {
          nonTemporaryChatIds.push(chatHistory.chatId);
          nonTemporaryChatHistories.push(chatHistory);
          idToIndexMap.set(chatHistory.chatId, index);
        }
      });

      if (nonTemporaryChatIds.length === 0) {
        return chatHistories;
      }

      // Batch get from Redis cache
      const getCacheTracker = perfService.start(
        `PersistedChatHistory.initMultipleChats.getCachedChats.${nonTemporaryChatIds.length}`,
      );
      const cacheKeys = nonTemporaryChatIds.map(id => `persistedChatHistory:{chats}:${id}`);
      const redisService = await getRedisService();
      const cachedResults = await redisService.mget<JsonArray>(cacheKeys);

      // Track which chats need DB fetch
      const uncachedChatIds: string[] = [];

      // Process cache results
      nonTemporaryChatIds.forEach((chatId, idx) => {
        const cachedMessages = cachedResults[idx];
        if (cachedMessages) {
          const historyIndex = idToIndexMap.get(chatId);
          if (historyIndex !== undefined) {
            chatHistories[historyIndex].messages =
              chatHistories[historyIndex].fromJson(cachedMessages);
          }
        } else {
          uncachedChatIds.push(chatId);
        }
      });
      perfService.end(getCacheTracker);

      // If we have uncached chats, fetch them in a single query
      const fetchChatsTracker = perfService.start(
        `PersistedChatHistory.initMultipleChats.fetchNonCachedChats.${uncachedChatIds.length}`,
      );

      if (uncachedChatIds.length > 0) {
        const rows = await chatsTable.findMany({
          where: { id: { in: uncachedChatIds } },
          select: { id: true, messages: true },
        });

        // Process database results
        // Process all rows and prepare for batch cache update
        const cacheEntries: Array<{ key: string; value: unknown }> = [];

        for (const row of rows) {
          const index = idToIndexMap.get(row.id);
          if (index !== undefined) {
            chatHistories[index].messages = chatHistories[index].fromJson(
              row.messages as JsonArray,
            );

            // Add to batch cache update
            cacheEntries.push({
              key: `persistedChatHistory:{chats}:${row.id}`,
              value: row.messages,
            });
          }
        }

        // Update Redis cache in a single batch operation
        if (cacheEntries.length > 0) {
          await redisService.mset(cacheEntries);
        }

        // Create chat records for any IDs not found in DB
        const fetchedIds = new Set(rows.map(row => row.id));
        const missingIds = uncachedChatIds.filter(id => !fetchedIds.has(id));

        if (missingIds.length > 0) {
          // Create new chat rows for missing IDs
          await chatsTable.createMany({
            data: missingIds.map(id => ({
              id,
              messages: [],
            })),
            skipDuplicates: true,
          });

          // Initialize chat histories with empty messages
          for (const id of missingIds) {
            const index = idToIndexMap.get(id);
            if (index !== undefined) {
              chatHistories[index].messages = [];

              // Cache empty messages
              await redisService.set(`persistedChatHistory:{chats}:${id}`, []);
            }
          }
        }
      }
      perfService.end(fetchChatsTracker);

      const reviveChatsTracker = perfService.start(
        `PersistedChatHistory.initMultipleChats.reviveChats.${chatHistories.length}`,
      );
      // Optionally revive any broken chats in parallel
      if (shouldReviveIfChatIsBroken) {
        await Promise.all(
          chatHistories.map(async chatHistory => {
            if (chatHistory.chatId && !chatHistory.isTemporary) {
              await chatHistory.reviveIfChatIsBroken();
            }
          }),
        );
      }
      perfService.end(reviveChatsTracker);
      return chatHistories;
    } finally {
      perfService.end(perfTracker);
    }
  }

  public static async setChatHistory(chatId: string, messages: FetchrMessage[]): Promise<void> {
    const chatHistory = new PersistedChatHistory(chatId);
    chatHistory.messages = messages;
    await chatHistory.updateMessagesInDb();
  }

  public static async getExistingChatHistory(
    orderId: string,
  ): Promise<PersistedChatHistory | null> {
    const cacheKey = `persistedChatHistory:{chats}:${orderId}`;
    const redisService = await getRedisService();
    const cachedMessages = await redisService.get<JsonArray>(cacheKey);
    if (cachedMessages) {
      const chatHistory = new PersistedChatHistory(orderId);
      chatHistory.messages = chatHistory.fromJson(cachedMessages);
      return chatHistory;
    }

    const row = await chatsTable.findUnique({
      where: { id: orderId },
      select: { messages: true },
    });

    if (!row) {
      return null;
    }

    const chatHistory = new PersistedChatHistory(orderId);
    chatHistory.messages = chatHistory.fromJson(row.messages as JsonArray);
    await redisService.set(cacheKey, row.messages);

    return chatHistory;
  }

  toJson(): JsonArray {
    return this.messages.map((message): JsonValue => {
      try {
        const role: string = message.role;
        if (typeof message.content === 'string') {
          return {
            role,
            content: message.content,
          };
        } else {
          const content = message.content.map((contentBlock): JsonValue => {
            if (contentBlock.type === 'text') {
              return contentBlock;
            } else if (contentBlock.type === 'tool_use') {
              return contentBlock.toJson();
            } else if (contentBlock.type === 'tool_result') {
              return contentBlock.toJson();
            } else if (contentBlock.type === 'image') {
              if ('image' in contentBlock) {
                return {
                  type: 'image',
                  image: contentBlock.image.toString('base64'),
                };
              } else if ('imageUrl' in contentBlock) {
                return {
                  type: 'image',
                  imageUrl: contentBlock.imageUrl,
                };
              } else {
                assertNever(contentBlock);
              }
            } else {
              assertNever(contentBlock);
            }
          });
          return {
            role,
            content,
          };
        }
      } catch (e) {
        logService.error('Error converting message to json', {
          metadata: { message },
          serviceName: 'PersistedChatHistory',
        });
        throw e;
      }
    });
  }

  fromJson(json: JsonArray): FetchrMessage[] {
    return (json ?? []).map((message: JsonValue): FetchrMessage => {
      if (
        message &&
        typeof message === 'object' &&
        'content' in message &&
        typeof message.content === 'string' &&
        'role' in message &&
        typeof message.role === 'string' &&
        (message.role === 'user' || message.role === 'assistant' || message.role === 'system')
      ) {
        return {
          role: message.role,
          content: message.content,
        };
      } else if (
        message &&
        typeof message === 'object' &&
        'content' in message &&
        Array.isArray(message.content) &&
        typeof message.role === 'string' &&
        (message.role === 'user' || message.role === 'assistant' || message.role === 'system')
      ) {
        const content = message.content.map((c): FetchrContentBlock => {
          if (typeof c === 'string') {
            return {
              type: 'text',
              text: c,
            };
          } else if (c && typeof c === 'object' && 'type' in c && c.type === 'tool_use') {
            return ToolUsageRequest.fromJson(c) as ToolUsageRequestType;
          } else if (c && typeof c === 'object' && 'type' in c && c.type === 'tool_result') {
            return ToolUsageResponse.fromJson(c) as ToolUsageResponseType;
          } else if (
            c &&
            typeof c === 'object' &&
            'type' in c &&
            c.type === 'text' &&
            typeof c.text === 'string'
          ) {
            return {
              type: 'text',
              text: c.text,
            };
          } else if (c && typeof c === 'object' && 'type' in c && c.type === 'image') {
            if ('image' in c && typeof c.image === 'string') {
              return {
                type: 'image',
                image: Buffer.from(c.image, 'base64'),
                caption: c.caption as string | undefined,
              };
            } else if ('imageUrl' in c && typeof c.imageUrl === 'string') {
              return {
                type: 'image',
                imageUrl: c.imageUrl,
                caption: c.caption as string | undefined,
              };
            }
            throw new Error('Invalid image content block format');
          } else {
            logService.error('Invalid content block type', {
              metadata: { contentBlock: c },
              serviceName: 'PersistedChatHistory',
            });
            throw new Error('Invalid content block');
          }
        });
        return {
          role: message.role,
          content,
        };
      } else {
        logService.error('Invalid message format', {
          metadata: { message },
          serviceName: 'PersistedChatHistory',
        });
        throw new Error('Invalid message format');
      }
    });
  }

  getMessages(): FetchrMessage[] {
    return this.messages;
  }

  async getGroqMessages(): Promise<GroqChatCompletionMessageParam[]> {
    await this.reviveIfChatIsBroken();
    const groqMessages: GroqChatCompletionMessageParam[] = this.messages
      .map((message): GroqChatCompletionMessageParam[] => {
        if (typeof message.content === 'string') {
          return [
            {
              role: message.role,
              content: message.content,
            },
          ];
        }

        return message.content.map(block => {
          if (block.type === 'text') {
            return {
              role: message.role,
              content: block.text,
            };
          }

          // Handle image blocks
          if (block.type === 'image') {
            if (message.role !== 'user') {
              logService.warn('Image block found in non-user message. Switching to user role.', {
                metadata: { message },
                serviceName: 'PersistedChatHistory',
              });
            }
            if ('imageUrl' in block) {
              const messagePart: GroqChatCompletionMessageParam = {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: { url: block.imageUrl },
                  },
                ],
              };

              return messagePart;
            } else if ('image' in block) {
              const messagePart: GroqChatCompletionMessageParam = {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${block.image.toString('base64')}`,
                    },
                  },
                ],
              };

              return messagePart;
            }
            throw new Error('Invalid content block type for image');
          }

          // Handle tool use blocks
          if (block.type === 'tool_use') {
            return block.getGroqToolCall();
          }

          // Handle tool result blocks
          if (block.type === 'tool_result') {
            return block.getGroqToolResponse();
          }

          throw new Error('Invalid content block');
        });
      })
      .map(messageOrArrayMessage => {
        if (Array.isArray(messageOrArrayMessage)) {
          return messageOrArrayMessage;
        }
        return [messageOrArrayMessage];
      })
      .flat();

    return groqMessages;
  }

  async getOpenAiMessages(): Promise<ChatCompletionMessageParam[]> {
    await this.reviveIfChatIsBroken();
    const openAiMessages: ChatCompletionMessageParam[] = this.messages
      .map(message => {
        if (typeof message.content === 'string') {
          return [
            {
              role: message.role,
              content: message.content,
            },
          ];
        }

        return message.content.map(block => {
          if (block.type === 'text') {
            return {
              role: message.role,
              content: block.text,
            };
          }

          // Handle image blocks
          if (block.type === 'image') {
            if (message.role !== 'user') {
              logService.warn('Image block found in non-user message. Switching to user role.', {
                metadata: { message },
                serviceName: 'PersistedChatHistory',
              });
            }
            if ('imageUrl' in block) {
              const messagePart: ChatCompletionMessageParam = {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: { url: block.imageUrl },
                  },
                ],
              };

              return messagePart;
            } else if ('image' in block) {
              const messagePart: ChatCompletionMessageParam = {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${block.image.toString('base64')}`,
                    },
                  },
                ],
              };

              return messagePart;
            }
            throw new Error('Invalid content block type for image');
          }

          // Handle tool use blocks
          if (block.type === 'tool_use') {
            return block.getOpenAIToolCall();
          }

          // Handle tool result blocks
          if (block.type === 'tool_result') {
            return block.getOpenAIToolResponse();
          }

          throw new Error('Invalid content block');
        });
      })
      .map(messageOrArrayMessage => {
        if (Array.isArray(messageOrArrayMessage)) {
          return messageOrArrayMessage;
        }
        return [messageOrArrayMessage];
      })
      .flat();

    return openAiMessages;
  }

  async getAnthropicMessages(model?: AnthropicModel): Promise<MessageParam[]> {
    await this.reviveIfChatIsBroken();
    if (!model) {
      model = this.defaultModel;
    }
    const supabaseStorageService = await getSupabaseStorageService();
    return Promise.all(
      this.messages.map(async message => {
        const role = message.role === 'system' ? 'user' : message.role;
        const content = message.content;
        if (typeof content === 'string') {
          return {
            role,
            content,
          };
        } else {
          const content = await Promise.all(
            (message.content as Array<FetchrContentBlock>).map(
              async (contentBlock): Promise<ContentBlockParam | ContentBlockParam[] | null> => {
                if (contentBlock.type === 'tool_use') {
                  return contentBlock.getAnthropicToolCall();
                } else if (contentBlock.type === 'tool_result') {
                  return contentBlock.getAnthropicToolResponse();
                } else if (contentBlock.type === 'text') {
                  return {
                    type: 'text',
                    text: contentBlock.text,
                  };
                } else if (contentBlock.type === 'image') {
                  if ('imageUrl' in contentBlock) {
                    let image: Buffer;
                    if (contentBlock.imageUrl.includes('supabase')) {
                      image = await supabaseStorageService.getImageSafeOrFail(
                        contentBlock.imageUrl,
                      );
                    } else {
                      const s3Service = await getS3Service();
                      image = await s3Service.getImageSafeOrFail(contentBlock.imageUrl);
                    }
                    return [
                      {
                        type: 'image',
                        source: {
                          type: 'base64',
                          media_type: 'image/jpeg',
                          data: image.toString('base64'),
                        },
                      },
                      ...(contentBlock.caption
                        ? [
                            {
                              type: 'text' as const,
                              text: contentBlock.caption,
                            },
                          ]
                        : []),
                    ];
                  } else if ('image' in contentBlock) {
                    return [
                      {
                        type: 'image',
                        source: {
                          type: 'base64',
                          media_type: 'image/jpeg',
                          data: contentBlock.image.toString('base64'),
                        },
                      },
                      ...(contentBlock.caption
                        ? [
                            {
                              type: 'text' as const,
                              text: contentBlock.caption,
                            },
                          ]
                        : []),
                    ];
                  } else {
                    assertNever(contentBlock);
                  }
                } else {
                  assertNever(contentBlock);
                }
              },
            ),
          );
          return {
            role,
            content: content
              .map(block => (Array.isArray(block) ? block.filter(Boolean) : block))
              .flat()
              .filter(Boolean) as ContentBlockParam[],
          };
        }
      }),
    );
  }

  async updateMessagesInDb(isSilent: boolean = false): Promise<void> {
    if (this.isTemporary) {
      return;
    }

    return this.queueUpdate(async () => {
      if (!isSilent) {
        logService.info('Updating messages in db and cache', {
          metadata: { messages: this.messages },
          serviceName: 'PersistedChatHistory',
        });
      }

      const jsonMessages = this.toJson();
      await chatsTable.upsert({
        where: { id: this.chatId },
        create: { id: this.chatId, messages: jsonMessages },
        update: { messages: jsonMessages },
      });

      if (this.chatId) {
        const cacheKey = `persistedChatHistory:{chats}:${this.chatId}`;
        const redisService = await getRedisService();
        await redisService.set(cacheKey, jsonMessages);
      }
    });
  }

  async addMessage(message: FetchrMessage): Promise<void> {
    this.messages.push(message);
    await this.updateMessagesInDb();
  }

  async addToolRequestFromToolUseBlock<T extends FetchrLLMToolType>(
    toolRequestPayload: ToolUseBlockParam & { name: T; input: ToolFunctionInputType<T> },
  ): Promise<void> {
    const toolRequest = ToolUsageRequest.createFromToolUseBlock({
      ...toolRequestPayload,
      name: toolRequestPayload.name as FetchrLLMToolType,
    });
    const toolRequestMessage: FetchrMessage = {
      role: 'assistant',
      content: [toolRequest],
    };
    this.messages.push(toolRequestMessage);
    await this.updateMessagesInDb();
  }

  async addToolResult<T extends FetchrLLMToolType | FetchrLLMCommonResponseToolType>(
    toolResultPayload: ToolUsageResponsePayloadMap[T],
    id: string,
  ): Promise<void> {
    logService.debug('Adding tool result', {
      metadata: { toolResultPayload, id },
      serviceName: 'PersistedChatHistory',
    });
    const hasMatchingToolUse = this.messages.some(message => {
      if (typeof message.content === 'string') return false;

      const isMatchingToolUse = message.content.some(
        block => block.type === 'tool_use' && block.id === id,
      );

      const doesNotHaveResult = !message.content.some(
        block => block.type === 'tool_result' && block.tool_use_id === id,
      );

      return isMatchingToolUse && doesNotHaveResult;
    });

    if (!hasMatchingToolUse) {
      logService.warn('No matching tool use found for id', {
        metadata: { id, messages: this.messages },
        serviceName: 'PersistedChatHistory',
        error: new Error(`No matching tool use found for id: ${id}`),
      });
      throw new Error(`No matching tool use found for id: ${id}`);
    }

    const toolResponse = ToolUsageResponse.createFromPayload(toolResultPayload, id);
    this.messages.push({
      role: 'user',
      content: [toolResponse],
    });
    await this.updateMessagesInDb();
  }

  constructor(
    chatId?: string,
    defaultModel: AnthropicModel = AnthropicModel.CLAUDE_3_5_SONNET_LATEST,
    isTemporary: boolean = false,
  ) {
    this.chatId = chatId;
    this.defaultModel = defaultModel;
    this.isTemporary = isTemporary;
  }

  async initFromMessages(messages: FetchrMessage[]): Promise<void> {
    this.messages = messages;
    await this.updateMessagesInDb();
  }

  async init(
    shouldReviveIfChatIsBroken: boolean = false,
    isSilent: boolean = false,
    agentType?: string,
  ): Promise<void> {
    const perfService = await getPerfService();
    const perfTracker = perfService.start('PersistedChatHistory.init');
    try {
      if (this.isTemporary) {
        return;
      }

      const cacheKey = `persistedChatHistory:{chats}:${this.chatId}`;
      const redisService = await getRedisService();
      const cachedMessages = await redisService.get<JsonArray>(cacheKey);

      if (cachedMessages) {
        this.messages = this.fromJson(cachedMessages);
        if (!isSilent) {
          logService.info('Chat history loaded from cache', {
            metadata: { chatId: this.chatId },
            serviceName: 'PersistedChatHistory',
          });
        }
        return;
      }

      const row = await chatsTable.findUnique({
        where: { id: this.chatId },
        select: { messages: true },
      });

      if (!isSilent) {
        logService.info('Initializing chat history', {
          metadata: { chatId: this.chatId, messages: row?.messages },
          serviceName: 'PersistedChatHistory',
        });
      }

      if (row) {
        this.messages = this.fromJson(row.messages as JsonArray);
        const redisService = await getRedisService();
        await redisService.set(cacheKey, row.messages);
        if (!isSilent) {
          logService.info('Chat history initialized from DB', {
            metadata: { chatId: this.chatId, messages: this.messages },
            serviceName: 'PersistedChatHistory',
          });
        }
      } else {
        // Create new chat row if it doesn't exist
        if (!isSilent) {
          logService.info('Creating new chat row', {
            metadata: { chatId: this.chatId },
            serviceName: 'PersistedChatHistory',
          });
        }
        await chatsTable.create({
          data: {
            id: this.chatId,
            messages: [],
            agent_type: agentType,
          },
        });
        this.messages = [];
        if (!isSilent) {
          logService.info('New chat row created', {
            metadata: { chatId: this.chatId },
            serviceName: 'PersistedChatHistory',
          });
        }
      }

      if (shouldReviveIfChatIsBroken) {
        await this.reviveIfChatIsBroken();
      }
    } finally {
      perfService.end(perfTracker);
    }
  }

  public async addMetadataToToolUseRequest(
    toolUseId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    logService.info('Adding metadata to tool use request', {
      metadata: { toolUseId, metadata },
      serviceName: 'PersistedChatHistory',
    });
    const toolUseMessage = this.messages.find(
      message =>
        Array.isArray(message.content) &&
        message.content.some(block => block.type === 'tool_use' && block.id === toolUseId),
    );

    if (!toolUseMessage) {
      throw new Error(`Tool use request with id ${toolUseId} not found in chat history`);
    }

    const toolUseContent = toolUseMessage.content as FetchrContentBlock[];
    const existingToolUse = toolUseContent.find(
      block => block.type === 'tool_use' && block.id === toolUseId,
    ) as ToolUsageRequestType;

    existingToolUse.payload.addMetadata(metadata);
    await this.updateMessagesInDb();
  }

  public getToolUsageRequest(toolUseId: string): ToolUsageRequestType | undefined {
    const toolUseMessage = this.messages.find(
      message =>
        Array.isArray(message.content) &&
        message.content.some(block => block.type === 'tool_use' && block.id === toolUseId),
    );
    if (!toolUseMessage || !Array.isArray(toolUseMessage.content)) {
      return undefined;
    }
    return toolUseMessage.content.find(
      block => block.type === 'tool_use' && block.id === toolUseId,
    ) as ToolUsageRequestType;
  }

  public getToolUsageResponse(toolUseId: string): ToolUsageResponseType | undefined {
    const toolUseMessage = this.messages.find(
      message =>
        message.role === 'user' &&
        Array.isArray(message.content) &&
        message.content.some(
          block => block.type === 'tool_result' && block.tool_use_id === toolUseId,
        ),
    );
    if (!toolUseMessage || !Array.isArray(toolUseMessage.content)) {
      return undefined;
    }
    return toolUseMessage.content.find(
      (block): block is ToolUsageResponseType =>
        block.type === 'tool_result' && block.tool_use_id === toolUseId,
    );
  }

  /**
   * Revives the chat history if it is broken.
   * The chat is broken if:
   * - The last message is from the assistant.
   * - Some tool use request was never completed due to an interrupted chat session. So it's now hanging without a response
   */
  private async reviveIfChatIsBroken(): Promise<void> {
    const perfService = await getPerfService();
    const perfTracker = perfService.start('PersistedChatHistory.reviveIfChatIsBroken');
    try {
      logService.debug('Reviving chat history if it is broken', {
        metadata: { messages: this.messages },
        serviceName: 'PersistedChatHistory',
      });

      const newMessages: FetchrMessage[] = [];

      for (let i = 0; i < this.messages.length; i++) {
        const currentMessage = this.messages[i];
        newMessages.push(currentMessage);

        // Gather any unmatched (hanging) tool uses in the current message
        if (Array.isArray(currentMessage.content)) {
          const hangingToolUses = currentMessage.content.filter(
            (block): block is ToolUsageRequestType => {
              if (block.type !== 'tool_use' || !block.id) return false;
              // Does some future message contain tool_result with the same ID?
              const hasResponse = this.messages.some((m, mIndex) => {
                // Only check messages after the current one. If found in the same message, it's not hanging.
                if (mIndex < i) return false;
                if (!Array.isArray(m.content)) return false;

                return m.content.some(
                  cb => cb.type === 'tool_result' && cb.tool_use_id === block.id,
                );
              });
              return !hasResponse;
            },
          );

          if (hangingToolUses.length > 0) {
            logService.error(
              'Found hanging tool usage in message. Inserting new error-response message immediately after.',
              {
                metadata: {
                  currentMessage,
                  hangingToolUses,
                },
                error: new Error(
                  'Found hanging tool usage in message. Inserting new error-response message immediately after.',
                ),
                serviceName: 'PersistedChatHistory',
              },
            );

            // Create one new user message that includes all error results in separate blocks
            const toolResultBlocks = hangingToolUses.map(toolUse => {
              return toolUse.fetchrLLMToolType === 'suggest_products_to_user'
                ? ToolUsageResponse.createFromPayload(
                    new SuggestProductsToUserResponsePayload({
                      productPreferences: [],
                    }),
                    toolUse.id,
                  )
                : toolUse.fetchrLLMToolType === 'suggest_styles_to_user'
                ? ToolUsageResponse.createFromPayload(
                    new SuggestStylesToUserResponsePayload({
                      imagePreferences: [],
                    }),
                    toolUse.id,
                  )
                : ToolUsageResponse.createFromPayload(
                    new ErrorResponsePayload({
                      error:
                        'Tool usage request was never completed due to interrupted chat session. Please try again.',
                    }),
                    toolUse.id,
                  );
            });

            const errorMessage: FetchrMessage = {
              role: 'user',
              content: toolResultBlocks,
            };

            // Insert it right after the current message
            newMessages.push(errorMessage);
          }
        }
      }

      logService.debug('New messages after reviving', {
        metadata: { messages: newMessages },
        serviceName: 'PersistedChatHistory',
      });

      // If the last message is from assistant, we still want to ensure the conversation doesn't end on assistant
      const finalMessage = newMessages[newMessages.length - 1];
      if (finalMessage?.role === 'assistant') {
        logService.error(
          'Last message is from assistant. Reviving by adding an empty user message at the end of the chat history.',
          {
            metadata: { finalMessage, messages: newMessages },
            serviceName: 'PersistedChatHistory',
          },
        );
        newMessages.push({
          role: 'user',
          content: '.',
        });
      }

      // Ensure each message has a single content block max and each tool use is followed by its response
      const flattenedMessages: FetchrMessage[] = [];
      for (const message of newMessages) {
        // For string content or single block content, add directly
        if (typeof message.content === 'string' || message.content.length === 1) {
          flattenedMessages.push(message);
          continue;
        }

        // For multi-block content, split into separate messages
        const contentBlocks = message.content;
        for (const block of contentBlocks) {
          if (block.type === 'tool_use') {
            flattenedMessages.push({
              role: message.role,
              content: [block],
            });
          } else if (block.type === 'tool_result') {
            flattenedMessages.push({
              role: 'user',
              content: [block],
            });
          } else {
            // For other block types (text, image), add as separate message
            flattenedMessages.push({
              role: message.role,
              content: [block],
            });
          }
        }
      }

      // Move each tool result to immediately follow its corresponding tool use
      const reorderedMessages: FetchrMessage[] = [];
      const toolResultsMap = new Map<string, FetchrContentBlock>();

      // First pass: collect all tool results and their tool_use_ids
      for (let i = 0; i < flattenedMessages.length; i++) {
        const message = flattenedMessages[i];
        if (
          message.role === 'user' &&
          Array.isArray(message.content) &&
          message.content.length === 1 &&
          message.content[0].type === 'tool_result'
        ) {
          const toolResult = message.content[0];
          toolResultsMap.set(toolResult.tool_use_id, toolResult);
        }
      }

      // Second pass: reorder messages to place tool results right after their tool uses
      for (let i = 0; i < flattenedMessages.length; i++) {
        const message = flattenedMessages[i];

        // Skip tool result messages as they're handled separately
        if (
          message.role === 'user' &&
          Array.isArray(message.content) &&
          message.content.length === 1 &&
          message.content[0].type === 'tool_result'
        ) {
          // Skip this message as we're handling tool results separately
          continue;
        }

        reorderedMessages.push(message);

        // If this is a tool use message, check if we have a corresponding tool result
        if (
          message.role === 'assistant' &&
          Array.isArray(message.content) &&
          message.content.length === 1 &&
          message.content[0].type === 'tool_use'
        ) {
          const toolUse = message.content[0];
          const correspondingToolResult = toolResultsMap.get(toolUse.id);

          if (correspondingToolResult) {
            // Add the tool result right after the tool use
            reorderedMessages.push({
              role: 'user',
              content: [correspondingToolResult],
            });
            // Remove from map to mark as processed
            toolResultsMap.delete(toolUse.id);
          }
        }
      }

      // Add any remaining tool results that didn't have a matching tool use
      // (This shouldn't happen in a well-formed conversation, but handling it just in case)
      if (toolResultsMap.size > 0) {
        logService.warn('Found tool results without matching tool uses', {
          metadata: { unmatchedToolResults: Array.from(toolResultsMap.entries()) },
          serviceName: 'PersistedChatHistory',
        });

        for (const [_toolUseId, toolResult] of toolResultsMap.entries()) {
          void _toolUseId;
          reorderedMessages.push({
            role: 'user',
            content: [toolResult],
          });
        }
      }

      const finalMessages = reorderedMessages;
      // Only update if messages have changed
      if (JSON.stringify(this.messages) !== JSON.stringify(finalMessages)) {
        this.messages = finalMessages;
        await this.updateMessagesInDb();
      }
    } finally {
      perfService.end(perfTracker);
    }
  }

  public getToolUsageIdForPendingToolUseResponse(toolType: FetchrLLMToolType): string | undefined {
    // Find the last tool use that doesn't have a corresponding tool result
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        const toolUseBlock = message.content.find(
          block => block.type === 'tool_use' && block.name === toolType,
        );

        if (toolUseBlock?.type === 'tool_use' && toolUseBlock.id) {
          // Check if there's a tool result for this id in subsequent messages
          const hasResponse = this.messages
            .slice(i + 1)
            .some(
              msg =>
                Array.isArray(msg.content) &&
                msg.content.some(
                  block => block.type === 'tool_result' && block.tool_use_id === toolUseBlock.id,
                ),
            );

          if (!hasResponse) {
            return toolUseBlock.id;
          }
        }
      }
    }
    return undefined;
  }

  public async updateToolUsageRequestPayload<T extends FetchrLLMToolType>(
    toolUseId: string,
    updateFn: (payload: ToolUsageRequestPayloadMap[T]) => Promise<void> | void,
  ): Promise<void> {
    // Find the relevant message
    const toolUseMessage = this.messages.find(
      msg =>
        msg.role === 'assistant' &&
        Array.isArray(msg.content) &&
        msg.content.some(block => block.type === 'tool_use' && block.id === toolUseId),
    );
    if (!toolUseMessage) {
      throw new Error(`Could not find tool use message with id=${toolUseId}`);
    }

    if (typeof toolUseMessage.content === 'string') {
      throw new Error('Tool use message content is a string, expected array');
    }

    // Grab the block and update it
    const toolUseBlock = toolUseMessage.content.find(
      (block): block is ToolUsageRequestType => block.type === 'tool_use' && block.id === toolUseId,
    );
    if (!toolUseBlock) {
      throw new Error(`Could not find tool use block with id=${toolUseId}`);
    }
    await updateFn(toolUseBlock.payload as ToolUsageRequestPayloadMap[T]);

    // Now persist changes
    await this.updateMessagesInDb();
  }

  public async updateToolUsageResponsePayload<
    T extends FetchrLLMToolType | FetchrLLMCommonResponseToolType,
  >(
    toolUseId: string,
    updateFn: (payload: ToolUsageResponsePayloadMap[T]) => Promise<void> | void,
  ): Promise<void> {
    // Find the relevant message
    const toolResponseMessage = this.messages.find(
      msg =>
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.some(block => block.type === 'tool_result' && block.tool_use_id === toolUseId),
    );
    if (!toolResponseMessage) {
      throw new Error(`Could not find tool response message with id=${toolUseId}`);
    }

    if (typeof toolResponseMessage.content === 'string') {
      throw new Error('Tool response message content is a string, expected array');
    }

    // Grab the block and update it
    const toolResultBlock = toolResponseMessage.content.find(
      (block): block is ToolUsageResponseType =>
        block.type === 'tool_result' && block.tool_use_id === toolUseId,
    );
    if (!toolResultBlock) {
      throw new Error(`Could not find tool result block with id=${toolUseId}`);
    }
    await updateFn(toolResultBlock.payload as ToolUsageResponsePayloadMap[T]);

    // Now persist changes
    await this.updateMessagesInDb();
  }

  public async cloneIntoTemporaryChatHistory(): Promise<TemporaryChatHistory> {
    const tempChatHistory = new TemporaryChatHistory([...this.messages]);
    return tempChatHistory;
  }

  public async filterMessages(
    filterFn: (message: FetchrMessage) => boolean,
  ): Promise<TemporaryChatHistory> {
    const tempChatHistory = new TemporaryChatHistory([...this.messages.filter(filterFn)]);
    return tempChatHistory;
  }

  public async clone(id?: string): Promise<PersistedChatHistory> {
    if (!id) {
      id = uuidv4();
    }

    const existingChatHistory = await PersistedChatHistory.getExistingChatHistory(id);
    if (existingChatHistory) {
      throw new Error(`Chat history with id=${id} already exists`);
    }

    const newChatHistory = new PersistedChatHistory(id, this.defaultModel);
    await newChatHistory.init(false, true);
    newChatHistory.messages = [...this.messages];
    await newChatHistory.updateMessagesInDb();
    return newChatHistory;
  }

  public async takeSnapshot(isTemporary: boolean = false): Promise<string> {
    if (isTemporary) {
      const tempChatHistory = await this.cloneIntoTemporaryChatHistory();
      if (!tempChatHistory.chatId) {
        throw new Error('Temporary chat history id is undefined');
      }
      return tempChatHistory.chatId;
    } else {
      const snapshotId = uuidv4();
      await this.clone(snapshotId);
      return snapshotId;
    }
  }

  public async restoreFromSnapshot(snapshotId: string): Promise<void> {
    const snapshotChatHistory = await PersistedChatHistory.getExistingChatHistory(snapshotId);
    if (!snapshotChatHistory) {
      throw new Error(`Could not find snapshot with id=${snapshotId}`);
    }

    this.messages = snapshotChatHistory.messages;
    await this.updateMessagesInDb();
  }
}

export class TemporaryChatHistory extends PersistedChatHistory {
  public messages: FetchrMessage[] = [];

  constructor(messages?: FetchrMessage[]) {
    const id = uuidv4();
    super(id, undefined, true);
    if (messages) {
      this.messages = messages;
    }
  }
}
