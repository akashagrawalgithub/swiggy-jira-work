import { ChangeDiff } from '../types';

/**
 * Compute a shallow diff between two plain objects.
 * Only records fields that actually changed.
 */
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ChangeDiff {
  const diff: ChangeDiff = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (before[key] !== after[key]) {
      diff[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return diff;
}
