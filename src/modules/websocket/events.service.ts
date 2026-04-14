import { Server as SocketServer } from 'socket.io';
import { redis } from '../../config/redis';
import { WsEvent, WsEventType } from '../../types';

let io: SocketServer | null = null;

export function setIo(server: SocketServer) {
  io = server;
}

const EVENT_STREAM_MAX_LEN = 500; // keep last 500 events per project for replay

/**
 * Broadcast an event to all clients in a project room AND persist it
 * to Redis streams for missed-event replay on reconnect.
 */
export async function broadcastEvent(event: WsEvent): Promise<void> {
  if (!io) return;

  const roomId = `project:${event.projectId}`;
  io.to(roomId).emit(event.type, event);

  // Persist to Redis stream for replay (XADD with MAXLEN cap)
  const streamKey = `events:${event.projectId}`;
  await redis.xadd(
    streamKey,
    'MAXLEN',
    '~',
    EVENT_STREAM_MAX_LEN.toString(),
    '*',
    'type', event.type,
    'projectId', event.projectId,
    'actorId', event.actorId,
    'timestamp', event.timestamp,
    'payload', JSON.stringify(event.payload),
  );
}

/**
 * Replay events a client missed since their last-seen stream ID.
 * Returns events newer than `lastEventId` (use '0-0' for all).
 */
export async function replayEvents(
  projectId: string,
  lastEventId: string,
): Promise<WsEvent[]> {
  const streamKey = `events:${projectId}`;
  const raw = await redis.xrange(streamKey, lastEventId, '+');
  return raw.map(([, fields]) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
    return {
      type: obj['type'] as WsEventType,
      projectId: obj['projectId'],
      actorId: obj['actorId'],
      timestamp: obj['timestamp'],
      payload: JSON.parse(obj['payload']),
    };
  });
}
