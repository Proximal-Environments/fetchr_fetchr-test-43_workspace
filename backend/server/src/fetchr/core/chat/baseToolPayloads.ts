import { JsonValue } from '@prisma/client/runtime/library';
import { FetchrLLMCommonResponseToolType, FetchrLLMToolType } from './toolTypes';
import { ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import { ToolFunctionInputType } from './types';
import { logService } from '../../base/logging/logService';
import { ChatCompletionMessageToolCall } from 'openai/resources';

export class BaseToolUsageRequestPayload {
  public fetchrLLMToolType: FetchrLLMToolType;
  public metadata?: Record<string, unknown>;

  constructor(fetchrLLMToolType: FetchrLLMToolType) {
    this.fetchrLLMToolType = fetchrLLMToolType;
  }

  protected static isComplex(): boolean {
    return false;
  }

  protected isComplex(): boolean {
    return false;
  }

  /**
   * Serializes the payload to a JSON-friendly object.
   * Throws an error by default if isComplex() is true,
   * but can be overridden for custom / complex serialization.
   */
  public toJson(): JsonValue {
    if (this.isComplex()) {
      throw new Error(
        `Cannot automatically convert complex payload to JSON. 
           Please override "toJson()" in your derived class.`,
      );
    }

    // For simple payloads, naive approach is often sufficient
    // e.g., spread all fields from 'this'
    const jsonObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this)) {
      if (value !== undefined && typeof value !== 'function') {
        jsonObj[key] = value;
      }
    }

    jsonObj.fetchrLLMToolType = this.fetchrLLMToolType;
    jsonObj.metadata = this.metadata;

    return jsonObj as JsonValue;
  }

  /**
   * Loosens "this"-constructor constraints by using a cast
   * so each subclass can still call <SubClass>.fromJson(...)
   */
  public static fromJson<T extends BaseToolUsageRequestPayload>(json: JsonValue): T {
    try {
      // Instead of calling `new <class>`, we directly create an object whose prototype is `this.prototype`.
      const instance = Object.create(this.prototype) as T;

      if (this.isComplex()) {
        throw new Error(
          `Cannot automatically parse complex payload from JSON. 
            Please override "fromJson(...)" in your derived class.`,
        );
      }

      // Assign the JSON fields onto that object
      Object.assign(instance, json);

      return instance;
    } catch (error) {
      logService.error('Error creating tool usage request from json', {
        metadata: { json },
        error,
        serviceName: 'BaseToolUsageRequestPayload',
      });
      throw error;
    }
  }

  public addMetadata(metadata: Record<string, unknown>): void {
    logService.info('Adding metadata to tool usage request', {
      metadata,
      serviceName: 'BaseToolUsageRequestPayload',
    });
    this.metadata ??= {};
    this.metadata = { ...this.metadata, ...JSON.parse(JSON.stringify(metadata)) };
    logService.info('Added metadata to tool usage request', {
      metadata: { metadata: this.metadata },
      serviceName: 'BaseToolUsageRequestPayload',
    });
  }

  public getMetadata(): Record<string, unknown> | undefined {
    return this.metadata;
  }

  public static fromToolUseBlock(toolUseBlock: ToolUseBlockParam): BaseToolUsageRequestPayload {
    void toolUseBlock;
    throw new Error('Not implemented');
  }

  public static fromChatCompletionMessageToolCall(
    toolCall: ChatCompletionMessageToolCall,
  ): BaseToolUsageRequestPayload {
    void toolCall;
    throw new Error('Not implemented');
  }

  public createRequestInput(): ToolFunctionInputType<typeof this.fetchrLLMToolType> {
    throw new Error(
      'Not implemented. This method must be implemented in each subclass of BaseToolUsageRequestPayload.',
    );
  }
}

export class BaseToolUsageResponsePayload {
  public fetchrLLMToolType: FetchrLLMToolType | FetchrLLMCommonResponseToolType;

  constructor(fetchrLLMToolType: FetchrLLMToolType | FetchrLLMCommonResponseToolType) {
    this.fetchrLLMToolType = fetchrLLMToolType;
  }

  protected static isComplex(): boolean {
    return false;
  }

  protected isComplex(): boolean {
    return false;
  }

  /**
   * Serializes the payload to a JSON-friendly object.
   * Throws an error by default if isComplex() is true,
   * but can be overridden for custom / complex serialization.
   */
  public toJson(): JsonValue {
    if (this.isComplex()) {
      throw new Error(
        `Cannot automatically convert complex payload to JSON. 
           Please override "toJson()" in your derived class.`,
      );
    }

    // For simple payloads, naive approach is often sufficient
    // e.g., spread all fields from 'this'
    const jsonObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this)) {
      if (value !== undefined && typeof value !== 'function') {
        jsonObj[key] = value;
      }
    }

    jsonObj.fetchrLLMToolType = this.fetchrLLMToolType;

    return jsonObj as JsonValue;
  }

  /**
   * Loosens "this"-constructor constraints by using a cast
   * so each subclass can still call <SubClass>.fromJson(...)
   */
  public static fromJson<T extends BaseToolUsageResponsePayload>(json: JsonValue): T {
    // Cast the constructor to one that returns T
    if (typeof json !== 'object' || json === null || !('fetchrLLMToolType' in json)) {
      throw new Error('fetchrLLMToolType is required');
    }
    const instance = new this(
      json.fetchrLLMToolType as FetchrLLMToolType | FetchrLLMCommonResponseToolType,
    );
    if (this.isComplex()) {
      throw new Error(
        `Cannot automatically parse complex payload from JSON. 
           Please override "fromJson(...)" in your derived class.`,
      );
    }
    Object.assign(instance, json);
    return instance as T;
  }

  public toToolResultBlock(toolId: string): ToolResultBlockParam {
    void toolId;
    throw new Error('Not implemented. Tool result block must be implemented in each subclasses.');
  }
}
