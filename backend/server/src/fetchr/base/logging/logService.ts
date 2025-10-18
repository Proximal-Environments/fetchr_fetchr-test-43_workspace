import dotenv from 'dotenv';
dotenv.config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env' });

import { injectable } from 'inversify';
import { Logger as WinstonLogger, createLogger, format, transports } from 'winston';
import { getRequestContext } from './requestContext';
import path from 'path';
import { BaseServiceWithoutLog } from '../service_injection/baseServiceWithoutLogging';
import DatadogWinston from 'datadog-winston';
import Transport, { TransportStreamOptions } from 'winston-transport';
import { hostname } from '../../../hostname';
import { logger as triggerLogger } from '@trigger.dev/sdk/v3';

const TURN_OFF_LOGGING = false;

type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'critical';

class InOrderTransport extends Transport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  private queue: { info: any; callback: Function }[] = [];
  private processing = false;
  private subTransports: Transport[];

  constructor(subTransports: Transport[], opts?: TransportStreamOptions) {
    super(opts);
    this.subTransports = subTransports;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public log(info: any, callback: () => void): void {
    // Enqueue the log request
    this.queue.push({ info, callback });

    // If we're not currently processing, kick off the processing loop
    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (TURN_OFF_LOGGING) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { info, callback } = this.queue.shift()!;

      // For each sub-transport, wait for its log call to finish in sequence
      for (const transport of this.subTransports) {
        await new Promise<void>((resolve, reject) => {
          // Winston expects (info, next) signature
          // @ts-expect-error log is not typed correctly. But it works. TODONAVID: FIX THIS
          transport.log(info, function (err?: Error) {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }
      // After all subTransports have completed this log, call Winston's callback
      callback();
    }

    this.processing = false;
  }
}

class TriggerTransport extends Transport {
  constructor(opts?: TransportStreamOptions) {
    super(opts);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public log(info: any, callback: () => void): void {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Map Winston log levels to Trigger.dev log levels
    const { level, message, metadata, ...rest } = info;

    try {
      switch (level) {
        case 'error':
        case 'critical':
          triggerLogger.error(message, { ...metadata, ...rest });
          break;
        case 'warn':
          triggerLogger.warn(message, { ...metadata, ...rest });
          break;
        case 'info':
          triggerLogger.log(message, { ...metadata, ...rest });
          break;
        case 'debug':
        case 'verbose':
          triggerLogger.debug(message, { ...metadata, ...rest });
          break;
        default:
          triggerLogger.log(message, { ...metadata, ...rest });
      }
    } catch (error) {
      console.error('Failed to log to Trigger.dev:', error);
    }

    callback();
  }
}

@injectable()
export class LogService extends BaseServiceWithoutLog {
  private readonly logger: WinstonLogger;

  constructor() {
    super('LogService');
    this.logger = this.initializeLogger();
  }

  private initializeLogger(): WinstonLogger {
    const logFormat = format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      format.errors({ stack: true }),
      format.printf(
        ({
          timestamp,
          level,
          message,
          stack,
          serviceName,
          metadata,
          context,
          type,
          requestId,
          ...otherContext
        }) => {
          const location = this.getLogLocation(stack as string);

          // Format base context
          const baseContextStr = [
            context && `[context: ${context}]`,
            type && `[type: ${type}]`,
            requestId && `[requestId: ${requestId}]`,
          ]
            .filter(Boolean)
            .join(' ');

          // Format additional context fields
          const additionalContextStr = Object.entries(otherContext)
            .filter(([_, value]) => value !== undefined)
            .map(([key, value]) => `[${key}: ${value}]`)
            .join(' ');

          // If there's metadata, safely stringify it for output
          let metadataStr = '';
          if (metadata) {
            try {
              metadataStr = `\n  metadata: ${JSON.stringify(metadata, null, 2)}`;
            } catch (err) {
              metadataStr = `\n  metadata: [Failed to stringify metadata: ${err}]`;
            }
          }

          const errorStack = stack ? `\nStack Trace:\n${stack}` : '';

          return `${timestamp} [${level}]${
            serviceName ? ` [${serviceName}]` : ''
          } ${baseContextStr} ${additionalContextStr}${
            location ? ` (${location})` : ''
          }: ${message}${metadataStr}${errorStack}`;
        },
      ),
    );

    // Create the sub-transports you want (console + Datadog)
    const consoleTransport = new transports.Console({
      format: logFormat,
    });

    let ddTransport: Transport | null = null;
    if (process.env.DD_API_KEY) {
      ddTransport = new DatadogWinston({
        apiKey: process.env.DD_API_KEY,
        hostname: hostname,
        service: 'fetchr-backend',
        ddsource: 'nodejs',
        intakeRegion: 'us3',
        level: 'silly',
      });
    }

    // Create trigger transport for trigger.dev environment
    let triggerTransport: Transport | null = null;
    if (process.env.NODE_ENV === 'trigger') {
      triggerTransport = new TriggerTransport({
        level: 'debug',
      });
    }

    // Wrap all sub-transports in the single "InOrderTransport"
    const subTransports: Transport[] = [consoleTransport];
    if (ddTransport) {
      subTransports.push(ddTransport);
    }
    if (triggerTransport) {
      subTransports.push(triggerTransport);
    }

    const inOrderTransport = new InOrderTransport(subTransports);

    return createLogger({
      level: process.env.LOG_LEVEL || 'debug',
      format: logFormat,
      transports: [
        // Just the single in-order transport, which delegates to console + dd + trigger
        inOrderTransport,
      ],
    });
  }

  private getLogLocation(stack?: string): string | undefined {
    if (!stack) return undefined;
    const stackLines = stack.split('\n');
    const callerLine = stackLines[2] || stackLines[1];
    const match = callerLine.match(/\(([^)]+)\)/);
    if (match) {
      const filePath = match[1];
      return path.relative(process.cwd(), filePath);
    }
    return undefined;
  }

  public critical(message: string, metadata?: Record<string, unknown>): void {
    // JSON-stringify-and-parse to make a simple deep clone
    const clonedMetadata = metadata ? JSON.parse(JSON.stringify(metadata)) : {};

    const enhancedMetadata = {
      ...clonedMetadata,
      severity: 'CRITICAL',
      timestamp: new Date().toISOString(),
    };

    // Log to error transport
    this.logger.error(message, {
      ...enhancedMetadata,
      level: 'critical',
    });

    // Also log to console with distinctive formatting
    console.error('\x1b[31m%s\x1b[0m', '🚨 CRITICAL ERROR 🚨');
    console.error('\x1b[31m%s\x1b[0m', message);
    if (metadata) {
      console.error('\x1b[31m%s\x1b[0m', 'Additional Information:');
      console.error(metadata);
    }
  }

  public error(
    message: string,
    extras?: {
      metadata?: Record<string, unknown>;
      error?: Error;
      serviceName?: string;
    },
  ): void {
    this.log('error', message, extras?.error, extras?.metadata, extras?.serviceName);
  }

  public warn(
    message: string,
    extras?: {
      metadata?: Record<string, unknown>;
      error?: Error;
      serviceName?: string;
    },
  ): void {
    this.log('warn', message, extras?.error, extras?.metadata, extras?.serviceName);
  }

  public info(
    message: string,
    extras?: {
      metadata?: Record<string, unknown>;
      error?: Error;
      serviceName?: string;
    },
  ): void {
    this.log('info', message, extras?.error, extras?.metadata, extras?.serviceName);
  }

  public debug(
    message: string,
    extras?: {
      metadata?: Record<string, unknown>;
      error?: Error;
      serviceName?: string;
    },
  ): void {
    this.log('debug', message, extras?.error, extras?.metadata, extras?.serviceName);
  }

  private log(
    level: LogLevel,
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>,
    serviceName?: string,
  ): void {
    const ctx = getRequestContext();

    // Replace simple JSON stringify with a BigInt-aware deep clone
    const clonedMetadata = metadata ? this.safeClone(metadata) : {};

    const baseContext = {
      level,
      message,
      serviceName,
      // Add system context by default
      context: 'system',
      type: 'internal',
      // Spread request context if available
      ...(ctx && {
        requestId: ctx.requestId,
        context: 'request',
        ...ctx.metadata,
      }),
      ...(error && {
        stack: error.stack,
        errorMessage: error.message,
      }),
      // Add a cloned metadata so it won't be mutated
      metadata: clonedMetadata,
    };

    this.logger.log({ ...baseContext });
  }

  private safeClone(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Convert BigInt → string
    if (typeof obj === 'bigint') {
      return obj.toString();
    }

    // Convert Date → string
    if (obj instanceof Date) {
      return obj.toISOString();
    }

    // Convert Buffer → Base64 string
    if (obj instanceof Buffer) {
      return obj.toString('base64');
    }

    // Convert Symbols → string
    if (typeof obj === 'symbol') {
      return obj.toString();
    }

    // Convert Function → placeholder string
    if (typeof obj === 'function') {
      return '[Function]';
    }

    // Convert Map → object
    if (obj instanceof Map) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of obj.entries()) {
        // Convert map keys to string (most often they are strings anyway)
        result[String(key)] = this.safeClone(value);
      }
      return result;
    }

    // Convert Set → array
    if (obj instanceof Set) {
      return Array.from(obj).map(item => this.safeClone(item));
    }

    // Recursively clone Arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.safeClone(item));
    }

    // Recursively clone plain objects
    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.safeClone(value);
      }
      return result;
    }

    // All other primitives (string, number, boolean, etc.) pass through
    return obj;
  }
}

const logService = new LogService();
export { logService };
