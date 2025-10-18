export interface ProxyConfig {
  username: string;
  password: string;
  host: string;
  port: number;
  protocol: string;
}

export interface RateLimitConfig {
  maxConcurrent: number;
  minTime: number;
  maxRetries: number;
  retryDelay: number;
}

// Default configurations
export const defaultProxyConfig: ProxyConfig = {
  username: 'customer-fetchr_proxy_ts_66Cqs-cc-US',
  password: 'aT7~vN4_3fQ2',
  host: 'pr.oxylabs.io',
  port: 7777,
  protocol: 'http',
};

export const defaultRateLimitConfig: RateLimitConfig = {
  maxConcurrent: 20,
  minTime: 100,
  maxRetries: 3,
  retryDelay: 100,
};
