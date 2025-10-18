import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import tracer from 'dd-trace';
import { Span } from 'dd-trace';
import { hostname } from '../../../hostname';
import axios from 'axios';
import { logService } from '../../base/logging/logService';

@injectable()
export class DDTraceService extends BaseService {
  private initialized = false;

  constructor() {
    super('DDTraceService', logService);
    this.initializeTracer();
  }

  /**
   * Initialize the Datadog tracer
   */
  private initializeTracer(): void {
    if (this.initialized) {
      return;
    }

    try {
      // Log environment variables for debugging
      this.logService.info('Initializing Datadog tracer with configuration:', {
        metadata: {
          DD_API_KEY: process.env.DD_API_KEY ? 'Set (hidden)' : 'Not set',
          DD_APP_KEY: process.env.DD_APP_KEY ? 'Set (hidden)' : 'Not set',
          DD_ENV: process.env.DD_ENV || 'Not set',
          DD_SERVICE: process.env.DD_SERVICE || 'fetchr-backend',
          DD_VERSION: process.env.DD_VERSION || 'Not set',
          DD_AGENT_HOST: process.env.DD_AGENT_HOST || 'Not set (default: localhost)',
          DD_TRACE_AGENT_PORT: process.env.DD_TRACE_AGENT_PORT || 'Not set (default: 8126)',
          DD_TRACE_ENABLED: process.env.DD_TRACE_ENABLED || 'Not set (default: true)',
          DATADOG_SITE: process.env.DATADOG_SITE || 'Not set',
          hostname: hostname || 'Not set',
        },
      });

      const tracerOptions: Record<string, unknown> = {
        // Use environment variables like DD_AGENT_HOST, DD_TRACE_AGENT_PORT, DD_SERVICE, DD_ENV, DD_VERSION
        // for configuration. These are automatically picked up by the tracer.
        logInjection: true, // Injects trace IDs into Winston logs
        runtimeMetrics: true,
        profiling: true,
        hostname: hostname,
        // Standard options picked up from environment variables:
        // service: process.env.DD_SERVICE || 'fetchr-backend',
        // env: process.env.DD_ENV,
        // version: process.env.DD_VERSION,
        // hostname: process.env.DD_HOSTNAME,
        // url: process.env.DD_TRACE_AGENT_URL,
        debug: true, // Enable debug logging from the tracer itself
      };

      // Force these options to match what's in the environment
      if (process.env.DD_SERVICE) {
        tracerOptions.service = process.env.DD_SERVICE;
      }

      // Explicitly log what we're initializing with
      this.logService.info('Datadog tracer options:', { metadata: tracerOptions });

      // Initialize tracer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tracer.init(tracerOptions as any);

      // Add a debug span to test if tracing is working
      const testSpan = tracer.startSpan('datadog.test.initialization');
      testSpan.setTag('test', true);
      testSpan.setTag('timestamp', new Date().toISOString());
      testSpan.finish();

      this.initialized = true;
      this.logService.info('Datadog tracer initialized successfully');

      // Schedule a diagnostic check in 5 seconds to give agent time to connect
      setTimeout(() => this.runDiagnostics(), 5000);
    } catch (error) {
      this.logService.error('Failed to initialize Datadog tracer', {
        error: error as Error,
        metadata: { service: 'DDTraceService' },
      });
    }
  }

  /**
   * Run diagnostics to check if Datadog agent is accessible and working
   */
  public async runDiagnostics(): Promise<void> {
    try {
      this.logService.info('Running Datadog tracer diagnostics');

      // Check if traces are enabled
      const tracesEnabled =
        !process.env.DD_TRACE_ENABLED || process.env.DD_TRACE_ENABLED === 'true';
      this.logService.info(`Traces enabled: ${tracesEnabled}`);

      // Check if Datadog agent is accessible
      const agentHost = process.env.DD_AGENT_HOST || 'localhost';
      const agentPort = process.env.DD_TRACE_AGENT_PORT || '8126';
      const agentUrl = `http://${agentHost}:${agentPort}/v0.4/traces`;

      try {
        // Attempt to connect to the agent
        await axios.get(`http://${agentHost}:${agentPort}/info`);
        this.logService.info(
          `✅ Successfully connected to Datadog agent at ${agentHost}:${agentPort}`,
        );
      } catch (error) {
        this.logService.error(
          `❌ Failed to connect to Datadog agent at ${agentHost}:${agentPort}`,
          {
            error: error as Error,
            metadata: {
              agentUrl,
              message: 'This may indicate that the Datadog agent is not running or not accessible.',
            },
          },
        );

        this.logService.info('Checking Datadog agent installation instructions:', {
          metadata: {
            message:
              'To use Datadog APM, you need to have the Datadog agent installed and running. See instructions at https://docs.datadoghq.com/agent/basic_agent_usage/',
          },
        });
      }

      // Create and send a test span
      this.logService.info('Creating test span for diagnostics');
      this.traceSync(
        'datadog.diagnostics',
        () => {
          this.logService.info('Datadog diagnostics test span created');
          return true;
        },
        {
          test: true,
          diagnostic: true,
          timestamp: new Date().toISOString(),
        },
      );

      // Alert about common issues
      if (!process.env.DD_SERVICE) {
        this.logService.warn(
          'DD_SERVICE environment variable is not set. Set this to identify your service in Datadog.',
        );
      }

      if (!process.env.DD_ENV) {
        this.logService.warn(
          'DD_ENV environment variable is not set. Set this to track different environments.',
        );
      }

      if (!process.env.DD_VERSION) {
        this.logService.warn(
          'DD_VERSION environment variable is not set. Set this to track your application version.',
        );
      }

      // Logs to help users troubleshoot
      this.logService.info('Datadog APM troubleshooting guide:', {
        metadata: {
          message: "If traces aren't visible in Datadog, check the following:",
          checklist: [
            '1. Ensure the Datadog agent is installed and running on your host',
            '2. Check that DD_API_KEY, DD_SERVICE, DD_ENV, and DD_VERSION environment variables are set',
            '3. Verify network connectivity from your application to the Datadog agent',
            '4. Check for any errors in the Datadog agent logs',
            '5. Ensure that ddTraceService is being imported and used correctly in your code',
          ],
        },
      });
    } catch (error) {
      this.logService.error('Error running Datadog diagnostics', {
        error: error as Error,
      });
    }
  }

  /**
   * A very simple method to add a trace point with a key-value pair.
   * Gets (or creates) the current active span and adds a tag.
   *
   * Example:
   * ```
   * // Add a trace point
   * ddTraceService.simpleTrace('user.id', userId);
   * ```
   *
   * @param key The key for the trace point
   * @param value The value to trace
   */
  public simpleTrace(key: string, value: unknown): void {
    try {
      // Try to get the current active span
      let span = this.getCurrentSpan();

      // If no span exists, create a new one
      if (!span) {
        span = tracer.startSpan('trace-point');
        this.logService.debug(`Created new span for simpleTrace(${key})`);
      } else {
        this.logService.debug(`Using existing span for simpleTrace(${key})`);
      }

      // Add the tag
      span.setTag(key, value);
      this.logService.debug(`Added tag ${key}=${JSON.stringify(value)} to span`);

      // If we created a new span, finish it
      if (span !== this.getCurrentSpan()) {
        span.finish();
        this.logService.debug(`Finished span for simpleTrace(${key})`);
      }
    } catch (error) {
      this.logService.error(`Failed to add simple trace: ${key}`, {
        error: error as Error,
        metadata: { key, value },
      });
    }
  }

  /**
   * Starts a new custom span to trace a specific operation
   * @param operationName The name of the operation to trace
   * @param tags Optional tags to add to the span
   * @returns The created span object
   */
  public startSpan(operationName: string, tags?: Record<string, unknown>): Span | null {
    try {
      this.logService.debug(`Starting span: ${operationName}`);
      const span = tracer.startSpan(operationName);

      if (tags) {
        Object.entries(tags).forEach(([key, value]) => {
          span.setTag(key, value);
        });
        this.logService.debug(`Added ${Object.keys(tags).length} tags to span ${operationName}`);
      }

      return span;
    } catch (error) {
      this.logService.error(`Failed to start span: ${operationName}`, {
        error: error as Error,
        metadata: { operationName, tags },
      });
      // Return null instead of dummy object
      return null;
    }
  }

  /**
   * Traces a function execution and returns its result
   * @param operationName The name of the operation
   * @param fn The function to trace
   * @param tags Optional tags to add to the span
   * @returns The result of the function
   */
  public async traceAsync<T>(
    operationName: string,
    fn: () => Promise<T>,
    tags?: Record<string, unknown>,
  ): Promise<T> {
    this.logService.debug(`Starting async trace: ${operationName}`);
    const span = this.startSpan(operationName, tags);

    try {
      const result = await fn();
      this.logService.debug(`Completing async trace: ${operationName}`);
      span?.finish();
      return result;
    } catch (error) {
      this.logService.debug(`Error in async trace: ${operationName}`, { metadata: { error } });
      if (span) {
        span.setTag('error', error);
        span.finish();
      }
      throw error;
    }
  }

  /**
   * Traces a synchronous function execution and returns its result
   * @param operationName The name of the operation
   * @param fn The function to trace
   * @param tags Optional tags to add to the span
   * @returns The result of the function
   */
  public traceSync<T>(operationName: string, fn: () => T, tags?: Record<string, unknown>): T {
    this.logService.debug(`Starting sync trace: ${operationName}`);
    const span = this.startSpan(operationName, tags);

    try {
      const result = fn();
      this.logService.debug(`Completing sync trace: ${operationName}`);
      span?.finish();
      return result;
    } catch (error) {
      this.logService.debug(`Error in sync trace: ${operationName}`, { metadata: { error } });
      if (span) {
        span.setTag('error', error);
        span.finish();
      }
      throw error;
    }
  }

  /**
   * Add a custom metric to Datadog
   * @param metricName The name of the metric
   * @param value The value of the metric
   * @param tags Optional tags for the metric
   */
  public recordMetric(metricName: string, value: number, tags?: Record<string, string>): void {
    try {
      if (!tracer.dogstatsd) {
        this.logService.warn('Datadog dogstatsd client not available', {
          metadata: {
            metricName,
            hint: 'This may indicate that the Datadog agent is not properly configured or connected',
          },
        });
        return;
      }

      // Convert tags to Datadog tag format
      const tagObject = tags || {};

      this.logService.debug(`Recording metric: ${metricName}=${value}`, {
        metadata: { tags: tagObject },
      });
      tracer.dogstatsd.gauge(metricName, value, tagObject);
    } catch (error) {
      this.logService.error(`Failed to record metric: ${metricName}`, {
        error: error as Error,
        metadata: { metricName, value, tags },
      });
    }
  }

  /**
   * Increment a counter metric in Datadog
   * @param metricName The name of the counter
   * @param increment The increment amount (default: 1)
   * @param tags Optional tags for the metric
   */
  public incrementCounter(
    metricName: string,
    increment: number = 1,
    tags?: Record<string, string>,
  ): void {
    try {
      if (!tracer.dogstatsd) {
        this.logService.warn('Datadog dogstatsd client not available');
        return;
      }

      const tagObject = tags || {};
      this.logService.debug(`Incrementing counter: ${metricName} by ${increment}`, {
        metadata: { tags: tagObject },
      });
      tracer.dogstatsd.increment(metricName, increment, tagObject);
    } catch (error) {
      this.logService.error(`Failed to increment counter: ${metricName}`, {
        error: error as Error,
        metadata: { metricName, increment, tags },
      });
    }
  }

  /**
   * Record the duration of an operation in Datadog
   * @param metricName The name of the histogram
   * @param value The time value in milliseconds
   * @param tags Optional tags for the metric
   */
  public recordHistogram(metricName: string, value: number, tags?: Record<string, string>): void {
    try {
      if (!tracer.dogstatsd) {
        this.logService.warn('Datadog dogstatsd client not available');
        return;
      }

      const tagObject = tags || {};
      this.logService.debug(`Recording histogram: ${metricName}=${value}ms`, {
        metadata: { tags: tagObject },
      });
      // Use distribution instead of histogram which is not available in the type definitions
      tracer.dogstatsd.distribution(metricName, value, tagObject);
    } catch (error) {
      this.logService.error(`Failed to record histogram: ${metricName}`, {
        error: error as Error,
        metadata: { metricName, value, tags },
      });
    }
  }

  /**
   * Get the current active span, if any
   * @returns The current active span or null
   */
  public getCurrentSpan(): Span | null {
    try {
      const span = tracer.scope().active();
      if (span) {
        this.logService.debug('Retrieved current active span');
      } else {
        this.logService.debug('No active span found');
      }
      return span;
    } catch (error) {
      this.logService.error('Failed to get current span', {
        error: error as Error,
      });
      return null;
    }
  }

  /**
   * Add a tag to the current active span
   * @param key The tag key
   * @param value The tag value
   */
  public setTag(key: string, value: unknown): void {
    try {
      const span = this.getCurrentSpan();
      if (span) {
        span.setTag(key, value);
        this.logService.debug(`Added tag ${key}=${JSON.stringify(value)} to current span`);
      } else {
        this.logService.debug(`Cannot set tag ${key}: no active span`);
      }
    } catch (error) {
      this.logService.error(`Failed to set tag: ${key}`, {
        error: error as Error,
        metadata: { key, value },
      });
    }
  }
}
