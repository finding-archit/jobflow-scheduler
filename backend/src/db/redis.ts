import IORedis from 'ioredis';
import { logger } from '../utils/logger';

export const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  reconnectOnError: () => true,
});

redis.on('connect', () => logger.info('✅ Connected to Redis'));
redis.on('error', (err) => logger.error(err, '❌ Redis error'));

// Pub/Sub client (separate connection)
export const redisPub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
});
export const redisSub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
});
