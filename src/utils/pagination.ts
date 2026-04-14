import { CursorPage } from '../types';

/**
 * Encode a cursor from a record id + timestamp so it is opaque to clients.
 */
export function encodeCursor(id: string, createdAt: Date): string {
  return Buffer.from(`${id}:${createdAt.toISOString()}`).toString('base64url');
}

export function decodeCursor(cursor: string): { id: string; createdAt: Date } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = raw.lastIndexOf(':');
  return { id: raw.slice(0, sep), createdAt: new Date(raw.slice(sep + 1)) };
}

export function buildPage<T extends { id: string; createdAt: Date }>(
  items: T[],
  limit: number,
): CursorPage<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const last = data[data.length - 1];
  return {
    data,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last.id, last.createdAt) : null,
  };
}
