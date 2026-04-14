import { redis, REDIS_KEYS } from '../config/redis';

/**
 * Atomically increment and return the next issue number for a project.
 * Falls back to DB count on cache miss (counter is seeded on first call).
 */
export async function nextIssueKey(
  projectKey: string,
  projectId: string,
): Promise<string> {
  const redisKey = REDIS_KEYS.issueCounter(projectId);
  const num = await redis.incr(redisKey);
  return `${projectKey}-${num}`;
}

/**
 * Seed the counter from the DB if it doesn't exist yet.
 * Call once at project creation or server start.
 */
export async function seedIssueCounter(
  projectId: string,
  currentMax: number,
): Promise<void> {
  const redisKey = REDIS_KEYS.issueCounter(projectId);
  const exists = await redis.exists(redisKey);
  if (!exists) {
    await redis.set(redisKey, currentMax);
  }
}
