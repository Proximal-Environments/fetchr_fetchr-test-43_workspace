import axios, { AxiosRequestConfig, AxiosError } from 'axios';
import Bottleneck from 'bottleneck';
import { HttpsProxyAgent } from 'https-proxy-agent';
import axiosRetry from 'axios-retry';
import { ProxyConfig, RateLimitConfig, defaultProxyConfig, defaultRateLimitConfig } from './config';

// Create a limiter instance
let limiter: Bottleneck;

// Initialize the rate limiter
function initLimiter(config: RateLimitConfig = defaultRateLimitConfig): Bottleneck {
  return new Bottleneck({
    maxConcurrent: config.maxConcurrent,
    minTime: config.minTime,
  });
}

// Configure axios with proxy and retry logic
function configureAxios(
  proxyConfig: ProxyConfig = defaultProxyConfig,
  retryConfig: RateLimitConfig = defaultRateLimitConfig,
  sessionId?: string,
): HttpsProxyAgent<string> {
  // Create proxy agent with session ID to ensure different IPs
  // Adding a unique session ID ensures Oxylabs uses a different IP for each request
  const sessionParam = sessionId ? `-session-${sessionId}` : '';
  const proxyUrl = `${proxyConfig.protocol}://${proxyConfig.username}${sessionParam}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
  const httpsAgent = new HttpsProxyAgent(proxyUrl);

  // Configure axios retry with enhanced retry logic
  axiosRetry(axios, {
    retries: retryConfig.maxRetries,
    retryDelay: (retryCount, error) => {
      // Exponential backoff with jitter for better retry distribution
      const baseDelay = retryConfig.retryDelay;
      const exponentialDelay = baseDelay * Math.pow(2, retryCount - 1);
      const jitter = Math.random() * 0.3 * exponentialDelay; // Add up to 30% jitter
      const finalDelay = exponentialDelay + jitter;

      // Log detailed retry information
      console.log(
        `[Retry] Attempt ${retryCount} for request with session ${sessionId || 'default'}`,
      );
      console.log(`[Retry] Error: ${error.message}`);
      console.log(`[Retry] Waiting ${Math.round(finalDelay)}ms before next attempt`);

      return finalDelay;
    },
    retryCondition: (error: AxiosError): boolean => {
      // Enhanced retry condition logic
      const shouldRetry =
        // Network errors (timeouts, connection refused, etc.)
        axiosRetry.isNetworkOrIdempotentRequestError(error) ||
        // Server errors (5xx)
        !!(error.response && error.response.status >= 500) ||
        // Rate limiting (429 Too Many Requests)
        !!(error.response && error.response.status === 429) ||
        // Proxy errors (407 Proxy Authentication Required)
        !!(error.response && error.response.status === 407);

      if (shouldRetry) {
        console.log(`[Retry] Will retry request due to error: ${error.message}`);
        if (error.response) {
          console.log(`[Retry] Response status: ${error.response.status}`);
        }
      } else {
        console.log(`[Retry] Will NOT retry request due to error: ${error.message}`);
        if (error.response) {
          console.log(`[Retry] Response status: ${error.response.status}`);
        }
      }

      return shouldRetry;
    },
  });

  return httpsAgent;
}

/**
 * Downloads an image from Pinterest with robust error handling and retry logic
 *
 * @param imageUrl URL of the Pinterest image to download
 * @param proxyConfig Optional proxy configuration
 * @param rateLimitConfig Optional rate limiting configuration
 * @param sessionId Optional session ID for proxy rotation
 * @returns A Promise that resolves to a Buffer containing the image data
 * @throws Error if the image cannot be downloaded after all retry attempts
 */
export async function getExternalImage(
  imageUrl: string,
  proxyConfig: ProxyConfig = defaultProxyConfig,
  rateLimitConfig: RateLimitConfig = defaultRateLimitConfig,
  sessionId?: string,
): Promise<Buffer> {
  // Ensure limiter is initialized
  if (!limiter) {
    initImageDownloader(proxyConfig, rateLimitConfig);
  }

  // Generate a unique session ID if not provided
  const uniqueSessionId = sessionId || generateUniqueSessionId();

  // Configure axios with proxy and unique session ID
  const httpsAgent = configureAxios(proxyConfig, rateLimitConfig, uniqueSessionId);

  logRequestStart(imageUrl, proxyConfig, uniqueSessionId);

  try {
    // Use the limiter to schedule the request with custom retry logic
    return await limiter.schedule(() =>
      executeDownloadWithRetries(
        imageUrl,
        httpsAgent,
        proxyConfig,
        rateLimitConfig,
        uniqueSessionId,
      ),
    );
  } catch (error) {
    console.error('Error in getExternalImage:', error);
    throw error;
  }
}

/**
 * Generates a unique session ID for proxy rotation
 * @returns A unique session ID string
 */
function generateUniqueSessionId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Logs information about the request being started
 * @param imageUrl URL of the image being downloaded
 * @param proxyConfig Proxy configuration being used
 * @param sessionId Session ID for the request
 */
function logRequestStart(imageUrl: string, proxyConfig: ProxyConfig, sessionId: string): void {
  console.log(
    `[Request] ${truncateUrl(imageUrl)} using proxy ${proxyConfig.host}:${
      proxyConfig.port
    } with session ${sessionId}`,
  );
}

/**
 * Truncates a URL for logging purposes
 * @param url URL to truncate
 * @param maxLength Maximum length of the truncated URL
 * @returns Truncated URL
 */
function truncateUrl(url: string, maxLength: number = 50): string {
  return url.length > maxLength ? `${url.substring(0, maxLength)}...` : url;
}

/**
 * Executes the download with retry logic
 * @param imageUrl URL of the image to download
 * @param httpsAgent HTTPS agent with proxy configuration
 * @param proxyConfig Proxy configuration
 * @param rateLimitConfig Rate limiting configuration
 * @param sessionId Session ID for the request
 * @returns Promise resolving to a Buffer containing the image data
 */
async function executeDownloadWithRetries(
  imageUrl: string,
  httpsAgent: HttpsProxyAgent<string>,
  proxyConfig: ProxyConfig,
  rateLimitConfig: RateLimitConfig,
  sessionId: string,
): Promise<Buffer> {
  let attempts = 0;
  const maxManualRetries = 2; // Additional manual retries beyond axios-retry

  for (;;) {
    try {
      attempts++;
      const requestConfig = createRequestConfig(httpsAgent);

      logDownloadAttempt(imageUrl, attempts);

      const { buffer, duration } = await downloadImage(imageUrl, requestConfig);

      logDownloadSuccess(imageUrl, buffer.length, duration, sessionId);

      return buffer;
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }

      if (await shouldRetryManually(error, attempts, maxManualRetries, imageUrl, sessionId)) {
        const retryDelay = calculateRetryDelay(rateLimitConfig, attempts);
        await delay(retryDelay);

        // Try with a new session ID for the next attempt
        const newSessionId = `retry-${sessionId}-attempt-${attempts + 1}`;
        httpsAgent = configureAxios(proxyConfig, rateLimitConfig, newSessionId);

        logSessionChange(newSessionId);
        continue;
      }

      // If we've exhausted all retries, log and throw the error
      logDownloadFailure(
        imageUrl,
        sessionId,
        error instanceof Error ? error.message : String(error),
        attempts,
      );
      throw error;
    }
  }
}

/**
 * Creates the request configuration for axios
 * @param httpsAgent HTTPS agent with proxy configuration
 * @returns Axios request configuration
 */
function createRequestConfig(httpsAgent: HttpsProxyAgent<string>): AxiosRequestConfig {
  return {
    responseType: 'arraybuffer',
    httpsAgent,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.pinterest.com/',
    },
    timeout: 30000, // 30 seconds timeout
  };
}

/**
 * Logs information about a download attempt
 * @param imageUrl URL of the image being downloaded
 * @param attemptNumber Current attempt number
 */
function logDownloadAttempt(imageUrl: string, attemptNumber: number): void {
  console.log(
    `[Downloading] Starting download for ${truncateUrl(imageUrl, 40)} (Attempt ${attemptNumber})`,
  );
}

/**
 * Downloads an image using axios
 * @param imageUrl URL of the image to download
 * @param requestConfig Axios request configuration
 * @returns Object containing the downloaded buffer and duration of the download
 */
async function downloadImage(
  imageUrl: string,
  requestConfig: AxiosRequestConfig,
): Promise<{ buffer: Buffer; duration: number }> {
  const startTime = Date.now();
  const response = await axios.get(imageUrl, requestConfig);
  const duration = Date.now() - startTime;

  // Validate response
  if (!response.data || response.data.length === 0) {
    throw new Error('Empty response received');
  }

  return {
    buffer: Buffer.from(response.data),
    duration,
  };
}

/**
 * Logs information about a successful download
 * @param imageUrl URL of the downloaded image
 * @param byteSize Size of the downloaded image in bytes
 * @param duration Duration of the download in milliseconds
 * @param sessionId Session ID used for the download
 */
function logDownloadSuccess(
  imageUrl: string,
  byteSize: number,
  duration: number,
  sessionId: string,
): void {
  console.log(
    `[Success] Downloaded ${truncateUrl(
      imageUrl,
      40,
    )} (${byteSize} bytes in ${duration}ms) with session ${sessionId}`,
  );
}

/**
 * Determines if a manual retry should be attempted
 * @param error Error that occurred during download
 * @param attempts Number of attempts made so far
 * @param maxRetries Maximum number of manual retries
 * @param imageUrl URL of the image being downloaded
 * @param sessionId Session ID used for the download
 * @returns True if a manual retry should be attempted, false otherwise
 */
async function shouldRetryManually(
  error: Error,
  attempts: number,
  maxRetries: number,
  imageUrl: string,
  sessionId: string,
): Promise<boolean> {
  if (attempts <= maxRetries) {
    console.log(
      `[Manual Retry] Attempt ${attempts} failed for ${truncateUrl(
        imageUrl,
        40,
      )} with session ${sessionId}: ${error.message}`,
    );
    return true;
  }
  return false;
}

/**
 * Calculates the delay before the next retry
 * @param rateLimitConfig Rate limiting configuration
 * @param attempts Number of attempts made so far
 * @returns Delay in milliseconds
 */
function calculateRetryDelay(rateLimitConfig: RateLimitConfig, attempts: number): number {
  const retryDelay = rateLimitConfig.retryDelay * attempts;
  console.log(`[Manual Retry] Waiting ${retryDelay}ms before next attempt`);
  return retryDelay;
}

/**
 * Creates a delay using a promise
 * @param ms Milliseconds to delay
 * @returns Promise that resolves after the specified delay
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Logs information about changing to a new session ID
 * @param newSessionId New session ID
 */
function logSessionChange(newSessionId: string): void {
  console.log(`[Manual Retry] Switching to new session ID: ${newSessionId}`);
}

/**
 * Logs information about a failed download
 * @param imageUrl URL of the image that failed to download
 * @param sessionId Session ID used for the download
 * @param errorMessage Error message
 * @param attempts Number of attempts made
 */
function logDownloadFailure(
  imageUrl: string,
  sessionId: string,
  errorMessage: string,
  attempts: number,
): void {
  console.error(
    `[Error] Failed to download ${truncateUrl(
      imageUrl,
      40,
    )} with session ${sessionId}: ${errorMessage} after ${attempts} attempts`,
  );
}

/**
 * Initializes the image downloader with custom configurations
 * Call this before making multiple requests to set up the service
 *
 * @param proxyConfig Proxy configuration
 * @param rateLimitConfig Rate limiting configuration
 */
export function initImageDownloader(
  proxyConfig: ProxyConfig = defaultProxyConfig,
  rateLimitConfig: RateLimitConfig = defaultRateLimitConfig,
): void {
  limiter = initLimiter(rateLimitConfig);
  configureAxios(proxyConfig, rateLimitConfig);
  console.log(
    `Image downloader initialized with rate limiting (maxConcurrent: ${rateLimitConfig.maxConcurrent}, minTime: ${rateLimitConfig.minTime}ms) and proxy support`,
  );
}

// initImageDownloader();
