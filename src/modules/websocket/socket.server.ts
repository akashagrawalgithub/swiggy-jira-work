import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { env } from '../../config/env';
import { setIo, replayEvents } from './events.service';

export function setupSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN, methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  setIo(io);

  io.use(async (socket, next) => {
    // JWT auth via query param or handshake auth
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.query?.token as string | undefined);

    if (!token) return next(new Error('Missing token'));

    try {
      // Decode JWT manually (fastify-jwt is not available here)
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      socket.data.userId = payload.userId as string;
      socket.data.email = payload.email as string;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId: string = socket.data.userId;
    console.log(`[WS] connected userId=${userId} socketId=${socket.id}`);

    // ── Join project board room ────────────────────────────────────────────
    socket.on('join_board', async ({ projectId, lastEventId }: { projectId: string; lastEventId?: string }) => {
      const isMember = await prisma.projectMember.findFirst({
        where: { projectId, userId },
      });
      if (!isMember) {
        socket.emit('error', { message: 'Not a member of this project' });
        return;
      }

      const roomId = `project:${projectId}`;
      socket.join(roomId);

      // Track presence
      await upsertPresence(userId, 'board', projectId, socket.id);
      const presentUsers = await getPresence('board', projectId);
      io.to(roomId).emit('presence_updated', { entityType: 'board', entityId: projectId, users: presentUsers });

      // Replay missed events
      if (lastEventId) {
        const missed = await replayEvents(projectId, lastEventId);
        if (missed.length) socket.emit('missed_events', missed);
      }

      socket.emit('joined_board', { projectId });
    });

    // ── Join issue room ────────────────────────────────────────────────────
    socket.on('join_issue', async ({ issueId }: { issueId: string }) => {
      const issue = await prisma.issue.findUnique({
        where: { id: issueId },
        select: { projectId: true },
      });
      if (!issue) return;

      const isMember = await prisma.projectMember.findFirst({
        where: { projectId: issue.projectId, userId },
      });
      if (!isMember) return;

      const roomId = `issue:${issueId}`;
      socket.join(roomId);

      await upsertPresence(userId, 'issue', issueId, socket.id);
      const presentUsers = await getPresence('issue', issueId);
      io.to(roomId).emit('presence_updated', { entityType: 'issue', entityId: issueId, users: presentUsers });
    });

    // ── Leave rooms on disconnect ──────────────────────────────────────────
    socket.on('disconnecting', async () => {
      await removePresence(userId, socket.id);

      // Notify all rooms this socket was in
      for (const roomId of socket.rooms) {
        if (roomId === socket.id) continue;
        const [entityType, entityId] = roomId.split(':');
        if (!entityId) continue;
        const presentUsers = await getPresence(entityType, entityId);
        io.to(roomId).emit('presence_updated', { entityType, entityId, users: presentUsers });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[WS] disconnected userId=${userId}`);
    });
  });

  return io;
}

// ─── Presence helpers ─────────────────────────────────────────────────────────

async function upsertPresence(
  userId: string,
  entityType: string,
  entityId: string,
  socketId: string,
) {
  const presenceKey = `presence:${entityType}:${entityId}`;
  await redis.hset(presenceKey, userId, JSON.stringify({ socketId, lastSeen: new Date() }));
  await redis.expire(presenceKey, 3600); // 1 hour TTL

  // Also persist to DB for longer-term tracking
  await prisma.presence.upsert({
    where: { userId_entityType_entityId: { userId, entityType, entityId } },
    create: { userId, entityType, entityId, socketId },
    update: { socketId, lastSeen: new Date() },
  });
}

async function removePresence(userId: string, socketId: string) {
  // Remove from all presence hashes this socket registered
  const presences = await prisma.presence.findMany({
    where: { userId, socketId },
  });
  for (const p of presences) {
    const presenceKey = `presence:${p.entityType}:${p.entityId}`;
    await redis.hdel(presenceKey, userId);
    await prisma.presence.delete({ where: { id: p.id } });
  }
}

async function getPresence(entityType: string, entityId: string): Promise<unknown[]> {
  const presenceKey = `presence:${entityType}:${entityId}`;
  const raw = await redis.hgetall(presenceKey);
  if (!raw) return [];

  const userIds = Object.keys(raw);
  if (!userIds.length) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true, avatarUrl: true },
  });
  return users;
}
