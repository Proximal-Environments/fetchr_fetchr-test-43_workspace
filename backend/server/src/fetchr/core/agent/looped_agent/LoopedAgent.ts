import { AnthropicModel, GroqModel, OpenAIModel } from '@fetchr/schema/core/core';
import { logService } from '../../../base/logging/logService';
import { FetchrMessage, PersistedChatHistory } from '../../chat/chatHistory';
import { ToolUsageRequest, ToolUsageRequestType, ToolUsageResponseType } from '../../chat/types';
import { ToolUsageResponsePayloadMap } from '../../chat/tools.config';
import { TOOLS_DICT } from '../../chat/tools';
import {
  ErrorResponsePayload,
  ExecutingOutsideResponsePayload,
  // ExecutingOutsideResponsePayload, // Removed - Now handled by ProcessToolResult/RunStepResult
} from '../../chat/tools/common_tools';
import {
  FetchrLLMCommonResponseToolType,
  FetchrLLMTool,
  FetchrLLMToolType,
} from '../../chat/toolTypes';
import { getAnthropicService, getGroqService, getOpenAIService } from '../../lazyServices';

// --- New Types ---
export type AgentRunYield =
  | { type: 'status'; status: string }
  | { type: 'pending_tool_usage'; request: ToolUsageRequestType }
  | { type: 'error'; error: Error; step: number }
  | { type: 'complete'; finalMessage?: FetchrMessage };

export type ProcessToolResult =
  | { outcome: 'error'; message?: string }
  | { outcome: 'tool_execution_outside'; request: ToolUsageRequestType }
  | { outcome: 'tool_execution_outside_silent'; request: ToolUsageRequestType }
  | { outcome: 'tool_not_found'; request: ToolUsageRequestType }
  | { outcome: 'tool_execution_failed'; message?: string }
  | { outcome: 'tool_execution_non_blocking'; request: ToolUsageRequestType }
  | { outcome: 'status_update'; status: string };

export type RunStepResultChunk =
  | { status: 'ok' }
  | { status: 'pending_tool_usage'; request: ToolUsageRequestType }
  | { status: 'status_update'; message: string }
  | { status: 'error'; error: Error; shouldContinueAgent?: boolean }
  | { status: 'complete'; finalMessage?: FetchrMessage };
// --- End New Types ---

export const TOOL_EXECUTION_OUTSIDE = 'TOOL_EXECUTION_OUTSIDE';
export const TOOL_EXECUTION_OUTSIDE_SILENT = 'TOOL_EXECUTION_OUTSIDE_SILENT';
export const TOOL_NOT_FOUND = 'TOOL_NOT_FOUND';
export const TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED';
export const TOOL_EXECUTION_NON_BLOCKING = 'TOOL_EXECUTION_NON_BLOCKING';

export interface LoopedAgentConfig {
  chatId: string;
  maxSteps: number;
  model?: AnthropicModel;
}

/**
 * T1 - Array of LLMTool objects that define the available tools for the agent
 * T2 - Type of messages used by the agent, defaults to MessageParam from Anthropic SDK
 */
export class LoopedAgent {
  protected chatId?: string;
  public chatHistory: PersistedChatHistory;
  name: string;
  protected tools: FetchrLLMTool[] = [];
  protected maxSteps: number;
  protected step: number = 0;
  protected isDone: boolean = false;
  protected model: OpenAIModel;

  constructor(config: LoopedAgentConfig & { name: string }) {
    this.chatHistory = new PersistedChatHistory(config.chatId, config.model);
    this.maxSteps = config.maxSteps;
    this.model = OpenAIModel.GPT_4O;
    this.name = config.name;
    this.isDone = false;
    this.chatId = config.chatId;
  }

  async init(agentType?: string): Promise<void> {
    await this.chatHistory.init(false, false, agentType);
  }

  public addToolUsageRequest(toolUsageRequest: ToolUsageRequestType): void {
    this.chatHistory.addMessage({
      role: 'assistant',
      content: [toolUsageRequest],
    });
  }

  protected async *processToolUsageRequest(
    toolUsageRequest: ToolUsageRequestType,
  ): AsyncGenerator<ProcessToolResult> {
    // Base implementation should indicate it's not handled here
    logService.warn(
      `processToolUsageRequest not implemented in base LoopedAgent for tool: ${toolUsageRequest.name}`,
      {
        serviceName: this.name,
      },
    );
    yield { outcome: 'error', message: 'Tool processing not implemented in base agent.' };
  }

  protected async *processOutput(output: string): AsyncGenerator<RunStepResultChunk> {
    // Default implementation: add the text output as an assistant message
    this.addMessage({ role: 'assistant', content: output });
    // No error needed here, subclasses can override if specific processing is required
    yield { status: 'ok' };
  }

  public addToolUsageResult(
    toolResultPayload: ToolUsageResponsePayloadMap[
      | FetchrLLMToolType
      | FetchrLLMCommonResponseToolType],
    id: string,
  ): void {
    this.chatHistory.addToolResult(toolResultPayload, id);
  }

  public addMessage(message: FetchrMessage): void {
    logService.info('Adding message - LoopedAgent', {
      metadata: { message },
      serviceName: this.name,
    });
    this.chatHistory.addMessage(message);
  }

  public isComplete(): boolean {
    return this.isDone;
  }

  protected markComplete(): void {
    logService.info(`${this.name} was marked as complete`, {
      metadata: {
        messages: this.chatHistory.getMessages(),
        model: this.model,
        maxSteps: this.maxSteps,
        step: this.step,
        isDone: this.isDone,
      },
      serviceName: this.name,
    });
    this.isDone = true;
  }

  public async *run(): AsyncGenerator<AgentRunYield, void, ToolUsageResponseType | undefined> {
    this.step = 0;
    this.isDone = false;

    while (!this.isComplete()) {
      let stepResult: AsyncGenerator<RunStepResultChunk> | undefined;
      try {
        stepResult = this.runStep();

        for await (const chunk of stepResult) {
          switch (chunk.status) {
            case 'ok':
              // Continue to next step
              break;
            case 'pending_tool_usage':
              // Yield to caller and wait for input
              yield { type: 'pending_tool_usage', ...chunk };
              break;
            case 'status_update':
              yield { type: 'status', status: chunk.message };
              break;
            case 'complete':
              this.markComplete();
              yield { type: 'complete', finalMessage: chunk.finalMessage };
              break;
            case 'error':
              this.markComplete(); // Stop on error by default
              yield { type: 'error', error: chunk.error, step: this.step };
              return; // Stop generation
          }
        }
      } catch (error) {
        logService.error(`Unhandled error in run loop for ${this.name}`, {
          error,
          metadata: { step: this.step },
          serviceName: this.name,
        });
        this.markComplete(); // Stop on unhandled error
        yield {
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
          step: this.step,
        };
        return; // Stop generation
      }

      // Increment step only if we are not done
      if (!this.isComplete()) {
        this.step++;
      }

      // Add a safety check for max steps
      if (!this.isComplete() && this.step >= this.maxSteps) {
        logService.warn(`${this.name} reached max steps`, {
          metadata: { maxSteps: this.maxSteps },
          serviceName: this.name,
        });
        this.markComplete();
        yield { type: 'complete' };
      }
    }

    logService.info(`${this.name} finished running`, {
      metadata: {
        messages: this.chatHistory.getMessages(),
        model: this.model,
        maxSteps: this.maxSteps,
        step: this.step,
        isDone: this.isDone,
      },
      serviceName: this.name,
    });
  }

  protected async *runStepWithOpenAIOrGroq(
    provider: 'openai' | 'groq',
    model: OpenAIModel | GroqModel,
  ): AsyncGenerator<RunStepResultChunk> {
    try {
      logService.info(`${this.name} running step ${this.step}`, {
        metadata: {
          messages: this.chatHistory.getMessages(),
          messagesJson: JSON.stringify(this.chatHistory.getMessages()),
          chatId: this.chatId,
        },
        serviceName: this.name,
      });

      logService.info('Submitting chat completion', {
        metadata: {
          model: this.model,
          available_tools: this.tools,
        },
        serviceName: this.name,
      });

      const openaiService = await getOpenAIService();
      const groqService = await getGroqService();

      let response = undefined;
      if (provider === 'openai') {
        response = (
          await openaiService.submitChatCompletion(await this.chatHistory.getOpenAiMessages(), {
            model: model as OpenAIModel,
            tools: this.tools
              .filter(tool => 'functionSchema' in tool)
              .map(tool => tool.functionSchema),
          })
        ).choices[0].message;
        this.addMessage(await FetchrMessage.fromOpenaiMessage(response));
      } else if (provider === 'groq') {
        response = await groqService.submitChatCompletion(
          await this.chatHistory.getGroqMessages(),
          {
            model: model as GroqModel,
            tools: this.tools
              .filter(tool => 'functionSchema' in tool)
              .map(tool => tool.functionSchema),
          },
        );
        this.addMessage(await FetchrMessage.fromGroqMessage(response));
      }

      if (!response) {
        throw new Error('No response from OpenAI or Groq');
      }

      // Process each tool call in the response
      if (response.content) {
        // Handle regular text output
        if (response.content.length) {
          const generator = this.processOutput(response.content);
          for await (const chunk of generator) {
            if (chunk.status === 'error' && chunk.shouldContinueAgent) {
              this.addMessage({
                role: 'assistant',
                content: chunk.error.message,
              });
            } else {
              yield chunk;
            }
          }
        }
      }

      if (response.tool_calls) {
        for (const toolCall of response.tool_calls) {
          try {
            if (toolCall.type === 'function') {
              const toolName = toolCall.function.name;

              if (!(toolName in TOOLS_DICT)) {
                this.addToolUsageResult(
                  new ErrorResponsePayload({ error: 'Invalid tool name' }),
                  toolCall.id,
                );
                continue;
              }

              const toolUsageRequest =
                ToolUsageRequest.createFromChatCompletionMessageToolCall(toolCall);

              const toolResultGenerator = this.processToolUsageRequest(toolUsageRequest);

              // Process all values from the generator
              for await (const toolResult of toolResultGenerator) {
                logService.info('Tool result in runStep', {
                  metadata: { toolResult },
                  serviceName: this.name,
                });

                if (toolResult.outcome === 'tool_execution_outside') {
                  this.addToolUsageResult(new ExecutingOutsideResponsePayload(), toolCall.id);
                  this.markComplete();
                  yield { status: 'pending_tool_usage', request: toolResult.request };
                  break;
                } else if (toolResult.outcome === 'tool_execution_outside_silent') {
                  this.markComplete();
                  yield { status: 'pending_tool_usage', request: toolResult.request };
                  break;
                } else if (toolResult.outcome === 'tool_not_found') {
                  this.addToolUsageResult(
                    new ErrorResponsePayload({ error: 'Tool not found' }),
                    toolCall.id,
                  );
                } else if (toolResult.outcome === 'tool_execution_failed') {
                  this.addToolUsageResult(
                    new ErrorResponsePayload({
                      error: toolResult.message ?? 'Tool execution failed',
                    }),
                    toolCall.id,
                  );
                } else if (toolResult.outcome === 'tool_execution_non_blocking') {
                  yield { status: 'pending_tool_usage', request: toolResult.request };
                } else if (toolResult.outcome === 'status_update') {
                  yield { status: 'status_update', message: toolResult.status };
                } else if (toolResult.outcome === 'error') {
                  this.addToolUsageResult(
                    new ErrorResponsePayload({
                      error: toolResult.message ?? 'Tool execution failed',
                    }),
                    toolCall.id,
                  );
                }
              }
            }
          } catch (error) {
            logService.error(`Error processing tool call in ${this.name}`, {
              error,
              metadata: { toolCall },
              serviceName: this.name,
            });
            this.addToolUsageResult(
              new ErrorResponsePayload({ error: 'Internal error processing tool' }),
              toolCall.id,
            );
            yield {
              status: 'error',
              error: error instanceof Error ? error : new Error(String(error)),
            };
          }
        }
      }
    } catch (error) {
      logService.error(`Fatal error in ${this.name} runStep`, {
        error,
        metadata: {
          step: this.step,
          chatId: this.chatId,
        },
        serviceName: this.name,
      });
      this.step++; // Increment step on error
      this.markComplete(); // Prevent further execution
      throw error; // Re-throw to notify caller
    }
  }

  protected async *runStepWithAnthropic(model: AnthropicModel): AsyncGenerator<RunStepResultChunk> {
    try {
      logService.info(`${this.name} running step ${this.step}`, {
        metadata: {
          messages: this.chatHistory.getMessages(),
          messagesJson: JSON.stringify(this.chatHistory.getMessages()),
          chatId: this.chatId,
        },
        serviceName: this.name,
      });

      logService.info('Submitting chat completion', {
        metadata: {
          model: this.model,
          available_tools: this.tools,
        },
        serviceName: this.name,
      });

      const anthropicService = await getAnthropicService();

      const messages = await this.chatHistory.getAnthropicMessages();
      const functions = this.tools
        .filter(tool => 'functionSchema' in tool)
        .map(tool => tool.functionSchema);

      const anthropicResponse = await anthropicService.submitChatCompletion(
        messages,
        {
          model,
          functions,
        },
        this.chatId,
      );

      const contentBlocks = anthropicResponse.content;

      this.addMessage(
        await FetchrMessage.fromAnthropicMessage({
          role: 'assistant',
          content: contentBlocks,
        }),
      );

      for (const contentBlock of contentBlocks) {
        try {
          if (contentBlock.type === 'text') {
            const generator = this.processOutput(contentBlock.text);
            for await (const chunk of generator) {
              if (chunk.status === 'error' && chunk.shouldContinueAgent) {
                this.addMessage({
                  role: 'assistant',
                  content: chunk.error.message,
                });
              } else {
                yield chunk;
              }
            }
          } else if (contentBlock.type === 'tool_use') {
            if (!(contentBlock.name in TOOLS_DICT)) {
              this.addToolUsageResult(
                new ErrorResponsePayload({ error: 'Invalid tool name' }),
                contentBlock.id,
              );
              continue;
            }

            const toolResultGenerator = this.processToolUsageRequest(
              ToolUsageRequest.createFromToolUseBlock({
                ...contentBlock,
                name: contentBlock.name as FetchrLLMToolType,
              }),
            );

            // Process all values from the generator
            for await (const toolResult of toolResultGenerator) {
              logService.info('Tool result in runStep', {
                metadata: { toolResult },
                serviceName: this.name,
              });

              if (toolResult.outcome === 'tool_execution_outside') {
                this.addToolUsageResult(new ExecutingOutsideResponsePayload(), contentBlock.id);
                this.markComplete();
                yield { status: 'pending_tool_usage', request: toolResult.request };
                break;
              } else if (toolResult.outcome === 'tool_execution_outside_silent') {
                this.markComplete();
                yield { status: 'pending_tool_usage', request: toolResult.request };
                break;
              } else if (toolResult.outcome === 'tool_not_found') {
                this.addToolUsageResult(
                  new ErrorResponsePayload({ error: 'Tool not found' }),
                  contentBlock.id,
                );
              } else if (toolResult.outcome === 'tool_execution_failed') {
                this.addToolUsageResult(
                  new ErrorResponsePayload({
                    error: toolResult.message ?? 'Tool execution failed',
                  }),
                  contentBlock.id,
                );
              } else if (toolResult.outcome === 'tool_execution_non_blocking') {
                yield { status: 'pending_tool_usage', request: toolResult.request };
              } else if (toolResult.outcome === 'status_update') {
                yield { status: 'status_update', message: toolResult.status };
              } else if (toolResult.outcome === 'error') {
                this.addToolUsageResult(
                  new ErrorResponsePayload({
                    error: toolResult.message ?? 'Tool execution failed',
                  }),
                  contentBlock.id,
                );
              }
            }
          }
        } catch (error) {
          logService.error(`Error processing content block in ${this.name}`, {
            error,
            metadata: { contentBlock },
            serviceName: this.name,
          });
          if (contentBlock.type === 'tool_use') {
            this.addToolUsageResult(
              new ErrorResponsePayload({ error: 'Internal error processing tool' }),
              contentBlock.id,
            );
          }
          yield {
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          };
          // Optionally mark as complete if the error is severe
          // this.markComplete();
          return;
        }
      }
    } catch (error) {
      logService.error(`Fatal error in ${this.name} runStep`, {
        error,
        metadata: {
          step: this.step,
          chatId: this.chatId,
        },
        serviceName: this.name,
      });
      this.step++; // Increment step on error
      this.markComplete(); // Prevent further execution
      throw error; // Re-throw to notify caller
    }
  }

  protected async *runStep(): AsyncGenerator<RunStepResultChunk> {
    yield* this.runStepWithAnthropic(AnthropicModel.CLAUDE_3_7_SONNET_LATEST);
  }

  // Fix: Assuming tools have a static functionSchema or a method to get it
  // Helper to get the schema correctly, adjust based on actual FetchrLLMTool definition
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected getToolFunctionSchema(tool: FetchrLLMTool): any {
    // Option 1: If it's static (e.g., on the class constructor)
    // return (tool as any).functionSchema;
    // Option 2: If it's an instance method
    // return tool.getFunctionSchema();
    // Option 3: If the object itself is the schema (unlikely based on error)
    // return tool;
    // Assuming a structure like { functionSchema: {...} } based on original errors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schema = (tool as any)?.functionSchema;
    if (!schema) {
      throw new Error(
        `Tool ${
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (tool as any)?.name ?? 'Unknown'
        } does not have a functionSchema property needed for Anthropic.`,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return schema as any;
  }
}
