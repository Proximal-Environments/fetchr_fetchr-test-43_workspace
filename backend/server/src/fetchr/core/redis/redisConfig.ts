import dotenv from 'dotenv';
dotenv.config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env' });

export interface RedisConfig {
  redisUrl: string | undefined;
  user: string | undefined;
  password: string | undefined;
  tls: boolean;
}

export function getRedisConfig(): RedisConfig {
  const redisUrl = process.env.REDIS_URL;
  const user = process.env.REDIS_USER;
  const password = process.env.REDIS_PASSWORD;
  const tls = process.env.REDIS_TLS?.toLowerCase() === 'true';
  return {
    redisUrl,
    user,
    password,
    tls,
  };
}
