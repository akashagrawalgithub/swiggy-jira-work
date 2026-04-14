import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

// Dedicated pub/sub subscriber — cannot share connection used for pub
export const redisSub = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => console.error('[Redis] error', err.message));
redisSub.on('error', (err) => console.error('[RedisSub] error', err.message));

export const REDIS_KEYS = {
  projectRoom: (projectId: string) => `project:${projectId}`,
  issueRoom: (issueId: string) => `issue:${issueId}`,
  presence: (entityType: string, entityId: string) =>
    `presence:${entityType}:${entityId}`,
  eventStream: (projectId: string) => `events:${projectId}`,
  issueCounter: (projectId: string) => `counter:issues:${projectId}`,
} as const;
