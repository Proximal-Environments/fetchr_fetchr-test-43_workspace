import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import Redis from 'ioredis';
import { getRedisConfig } from './redisConfig';

export const REDIS_ENABLED = true;

export interface CacheConfig {
  ttl: number; // Time to live in seconds
  prefix: string;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 86400, // 1 day default TTL
  prefix: 'fetchr:',
};

export const CACHE_CONFIGS = {
  PRODUCT: {
    ttl: 86400, // 24 hours
    prefix: 'fetchr:product:',
  },
  SEARCH: {
    ttl: 14400, // 4 hours
    prefix: 'fetchr:search:',
  },
  USER: {
    ttl: 14400, // 4 hours
    prefix: 'fetchr:user:',
  },
  SESSION: {
    ttl: 14400, // 4 hours
    prefix: 'fetchr:session:',
  },
  RATE_LIMIT: {
    ttl: 60, // 1 minute
    prefix: 'fetchr:ratelimit:',
  },
} as const;

class JsonDateSerializer {
  static serialize(obj: unknown): string {
    const processValue = (value: unknown): unknown => {
      if (value instanceof Date) {
        return `__date:${value.toISOString()}`;
      }
      if (Array.isArray(value)) {
        return value.map(processValue);
      }
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, processValue(v)]));
      }
      if (value instanceof Date) {
        return `__date:${value.toISOString()}`;
      }
      return value;
    };

    return JSON.stringify(processValue(obj));
  }

  static deserialize<T>(json: string): T {
    const processValue = (value: unknown): unknown => {
      if (typeof value === 'string' && value.startsWith('__date:')) {
        return new Date(value.slice(7));
      }
      if (Array.isArray(value)) {
        return value.map(processValue);
      }
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, processValue(v)]));
      }
      if (typeof value === 'string' && value.startsWith('__date:')) {
        return new Date(value.slice(7));
      }
      return value;
    };

    return processValue(JSON.parse(json)) as T;
  }
}

@injectable()
export class RedisService extends BaseService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client!: Redis;
  private isConnected: boolean = false;
  private redisEnabled: boolean = true;

  // Increase version to invalidate all caches
  private redisSchemaVersion: string | null = '1.0.0';

  constructor() {
    super('RedisService');
    this.redisEnabled = REDIS_ENABLED;
    if (this.redisEnabled) {
      this.initializeClient();
    } else {
      this.logService.info('Redis is disabled');
    }
  }

  getConnection(): Redis | null {
    if (!this.redisEnabled) {
      return null;
    }
    return this.client;
  }

  setRedisEnabled(enabled: boolean): void {
    if (this.redisEnabled === enabled) {
      return;
    }

    this.redisEnabled = enabled;

    if (enabled && !this.isConnected) {
      this.initializeClient();
    }
  }

  private async initializeClient(): Promise<void> {
    try {
      const redisConfig = getRedisConfig();

      // Parse URL if it exists
      let host, port;
      if (redisConfig.redisUrl) {
        try {
          const url = new URL(redisConfig.redisUrl);
          host = url.hostname;
          port = url.port ? parseInt(url.port, 10) : 6379;
        } catch {
          host = redisConfig.redisUrl;
          port = 6379;
        }
      }

      this.client = new Redis({
        host,
        port,
        username: redisConfig.user,
        password: redisConfig.password,
        tls: redisConfig.tls ? { rejectUnauthorized: false } : undefined,
        retryStrategy: (times: number): number | null => {
          if (times > 10) {
            return null; // Stop retrying
          }
          console.log(
            `[User] Reconnecting to Redis... ${redisConfig.redisUrl}, ${redisConfig.user}, ${redisConfig.password}, ${redisConfig.tls}`,
          );
          return Math.min(times * 100, 3000);
        },
      });

      this.client.on('error', (err: Error) => {
        this.logService.error('Redis Client Error', { error: err });
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        this.logService.info('Redis Client Connected');
        this.isConnected = true;
      });
    } catch (error) {
      this.logService.error('Failed to initialize Redis client', { error });
      throw error;
    }
  }

  private getKey(key: string, config: CacheConfig): string {
    return `${this.redisSchemaVersion}:${config.prefix}${key}`;
  }

  async get<T>(key: string, config: CacheConfig = DEFAULT_CACHE_CONFIG): Promise<T | null> {
    try {
      if (!this.redisEnabled || !this.isConnected) {
        return null;
      }

      const data = await this.client.get(this.getKey(key, config));
      return data ? JsonDateSerializer.deserialize<T>(data) : null;
    } catch (error) {
      this.logService.error('Redis get error', { error, metadata: { key, config } });
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    config: CacheConfig = DEFAULT_CACHE_CONFIG,
  ): Promise<boolean> {
    try {
      if (!this.redisEnabled || !this.isConnected) {
        return false;
      }

      const result = await this.client.set(
        this.getKey(key, config),
        JsonDateSerializer.serialize(value),
        'EX',
        config.ttl,
      );
      return result === 'OK';
    } catch (error) {
      this.logService.error('Redis set error', { error, metadata: { key, config } });
      return false;
    }
  }

  async del(key: string, config: CacheConfig = DEFAULT_CACHE_CONFIG): Promise<boolean> {
    try {
      if (!this.redisEnabled || !this.isConnected) {
        return false;
      }

      const result = await this.client.del(this.getKey(key, config));
      return result > 0;
    } catch (error) {
      this.logService.error('Redis del error', { error, metadata: { key, config } });
      return false;
    }
  }

  async delByPattern(
    pattern: string,
    config: CacheConfig = DEFAULT_CACHE_CONFIG,
  ): Promise<boolean> {
    try {
      if (!this.redisEnabled || !this.isConnected) {
        return false;
      }

      // Get the full pattern with prefix
      const fullPattern = `${this.redisSchemaVersion}:${config.prefix}${pattern}`;

      // Use SCAN to find keys matching the pattern
      let cursor = '0';
      let keys: string[] = [];

      do {
        const [nextCursor, scanKeys] = await this.client.scan(
          cursor,
          'MATCH',
          fullPattern,
          'COUNT',
          100,
        );

        cursor = nextCursor;
        keys = keys.concat(scanKeys);
      } while (cursor !== '0');

      // Delete all found keys
      if (keys.length > 0) {
        await this.client.del(keys);
        return true;
      }

      return false;
    } catch (error) {
      this.logService.error('Redis delByPattern error', { error, metadata: { pattern, config } });
      return false;
    }
  }

  async increment(
    key: string,
    value: number = 1,
    config: CacheConfig = DEFAULT_CACHE_CONFIG,
  ): Promise<number | null> {
    try {
      if (!this.redisEnabled || !this.isConnected) {
        return null;
      }

      const result = await this.client.incrby(this.getKey(key, config), value);
      await this.client.expire(this.getKey(key, config), config.ttl);
      return result;
    } catch (error) {
      this.logService.error('Redis increment error', { error, metadata: { key, config } });
      return null;
    }
  }

  async exists(key: string, config: CacheConfig = DEFAULT_CACHE_CONFIG): Promise<boolean> {
    try {
      if (!this.redisEnabled || !this.isConnected) {
        return false;
      }

      const result = await this.client.exists(this.getKey(key, config));
      return result === 1;
    } catch (error) {
      this.logService.error('Redis exists error', { error, metadata: { key, config } });
      return false;
    }
  }

  async mget<T>(keys: string[], config: CacheConfig = DEFAULT_CACHE_CONFIG): Promise<(T | null)[]> {
    try {
      if (!this.redisEnabled || !this.isConnected || keys.length === 0) {
        return keys.map(() => null);
      }

      // Transform keys with prefix
      const prefixedKeys = keys.map(key => this.getKey(key, config));

      // Get all values in a single Redis command
      const results = await this.client.mget(...prefixedKeys);

      // Process results
      return results.map(result => (result ? JsonDateSerializer.deserialize<T>(result) : null));
    } catch (error) {
      this.logService.error('Redis mget error', { error, metadata: { keys, config } });
      return keys.map(() => null);
    }
  }

  async mset<T>(
    entries: Array<{ key: string; value: T }>,
    config: CacheConfig = DEFAULT_CACHE_CONFIG,
  ): Promise<boolean> {
    try {
      if (!this.redisEnabled || !this.isConnected || entries.length === 0) {
        return false;
      }

      // Transform to key-value pairs array for mset
      const keyValueArray: string[] = [];

      for (const entry of entries) {
        keyValueArray.push(this.getKey(entry.key, config));
        keyValueArray.push(JsonDateSerializer.serialize(entry.value));
      }

      // Set all values in a single Redis command
      const result = await this.client.mset(...keyValueArray);

      // Set expiration for each key
      const pipeline = this.client.pipeline();
      for (const entry of entries) {
        pipeline.expire(this.getKey(entry.key, config), config.ttl);
      }
      await pipeline.exec();

      return result === 'OK';
    } catch (error) {
      this.logService.error('Redis mset error', { error, metadata: { entries, config } });
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.redisEnabled) {
      return true; // Consider Redis "healthy" when disabled
    }

    try {
      if (!this.isConnected) {
        return false;
      }

      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      this.logService.error('Redis health check error', { error });
      return false;
    }
  }

  async clearCache(): Promise<boolean> {
    try {
      if (!this.redisEnabled || !this.isConnected) {
        return true; // Consider cache clearing successful when Redis is disabled
      }

      const result = await this.client.flushdb();
      return result === 'OK';
    } catch (error) {
      this.logService.error('Redis clear cache error', { error });
      return false;
    }
  }
}
