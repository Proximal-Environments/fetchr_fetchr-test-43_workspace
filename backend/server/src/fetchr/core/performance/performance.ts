import { injectable } from 'inversify';
import { randomUUID } from 'crypto';
import { BaseService } from '../../base/service_injection/baseService';
import { logService } from '../../base/logging/logService';

export interface OperationHandle {
  id: string;
  startTime: number;
  name: string;
}

@injectable()
export class Perf extends BaseService {
  constructor() {
    super('Performance', logService);
  }

  /**
   * Starts timing an operation and logs a start message.
   * @param operationName A descriptive name for the operation (e.g., 'databaseQuery', 'externalApiCall').
   * @param tags Optional additional key-value pairs for context.
   * @returns An OperationHandle containing the unique ID and start time.
   */
  public start(operationName: string, tags: Record<string, unknown> = {}): OperationHandle {
    const operationId = randomUUID();
    const startTime = Date.now();
    const handle: OperationHandle = { id: operationId, startTime, name: operationName };

    const logPayload = {
      message: `Operation started: ${operationName}`,
      operation: operationName,
      operationId: operationId,
      status: 'start',
      tags: tags, // Pass through user-provided tags
      '@timestamp': new Date(startTime).toISOString(), // Explicit timestamp for consistency
    };

    this.logService.info(logPayload.message, { metadata: logPayload }); // Use info level for start/end

    return handle;
  }

  /**
   * Ends timing an operation, calculates duration, and logs an end message.
   * @param handle The OperationHandle returned by startOperation.
   * @param tags Optional additional key-value pairs for context.
   * @param error Optional error object if the operation failed.
   */
  public end(
    handle: OperationHandle,
    tags: Record<string, unknown> = {},
    error?: Error | unknown,
  ): void {
    const endTime = Date.now();
    const duration = endTime - handle.startTime;

    const logPayload: Record<string, unknown> = {
      message: `Operation ended: ${handle.name} - Took ${duration / 1000}s`,
      operation: handle.name,
      operationId: handle.id,
      status: error ? 'error' : 'end',
      duration: duration, // Duration in milliseconds
      '@duration': duration * 1_000_000, // Optional: Duration in nanoseconds if needed by DD processing
      tags: tags, // Pass through user-provided tags
      '@timestamp': new Date(endTime).toISOString(), // Explicit timestamp for consistency
    };

    if (error) {
      const formattedError = this.formatError(error);
      logPayload.error = formattedError; // Add formatted error to metadata
      const errorInstance = error instanceof Error ? error : undefined;
      // Revert to original format: message string first
      this.logService.error(logPayload.message as string, {
        error: errorInstance,
        metadata: logPayload,
      });
    } else {
      // Revert to original format: message string first
      this.logService.info(logPayload.message as string, { metadata: logPayload });
    }
  }

  /**
   * Logs a simple key-value pair for informational tracing.
   * @param key The key for the trace point.
   * @param value The value to log.
   * @param tags Optional additional key-value pairs for context.
   */
  public trace(key: string, value: unknown, tags: Record<string, unknown> = {}): void {
    const logPayload = {
      message: `Trace point: ${key}`,
      traceKey: key,
      traceValue: value,
      status: 'trace', // Differentiate this log type
      tags: tags,
      '@timestamp': new Date().toISOString(),
    };

    // Use original format: message string first
    this.logService.info(logPayload.message, { metadata: logPayload });
  }

  private formatError(error: Error | unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    }
    return { message: String(error) };
  }

  /**
   * Tracks the execution of a function (sync or async), logging start and end events with duration.
   * Automatically handles calling startOperation and endOperation.
   * @param operationName A descriptive name for the operation.
   * @param fn The function to track. Can be sync or async.
   * @param tags Optional additional key-value pairs for context.
   * @returns The result of the function `fn`.
   */
  public async track<T>(
    operationName: string,
    fn: () => T | Promise<T>,
    tags: Record<string, unknown> = {},
  ): Promise<T> {
    const handle = this.start(operationName, tags);
    try {
      // Execute the function, awaiting if it's async
      const result = await fn();
      // End operation successfully
      this.end(handle, tags);
      return result;
    } catch (error) {
      // End operation with error
      this.end(handle, tags, error);
      // Re-throw the error to maintain original behavior
      throw error;
    }
    // Note: A finally block isn't strictly needed here because endOperation
    // is called in both the try and catch blocks before returning/throwing.
  }
}
