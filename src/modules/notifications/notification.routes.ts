import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notificationService } from './notification.service';
import { authenticate } from '../../middleware/authenticate';
import { JwtPayload } from '../../types';

export async function notificationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/notifications
  fastify.get('/', async (request, reply) => {
    const user = request.user as JwtPayload;
    const q = request.query as { limit?: string; cursor?: string; unread?: string };
    const result = await notificationService.list(user.userId, {
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      cursor: q.cursor,
      unreadOnly: q.unread === 'true',
    });
    reply.send(result);
  });

  // GET /api/notifications/unread-count
  fastify.get('/unread-count', async (request, reply) => {
    const user = request.user as JwtPayload;
    const count = await notificationService.unreadCount(user.userId);
    reply.send({ count });
  });

  // PATCH /api/notifications/read
  fastify.patch('/read', async (request, reply) => {
    const user = request.user as JwtPayload;
    const body = z
      .object({ ids: z.array(z.string()).optional() })
      .parse(request.body);

    if (body.ids?.length) {
      await notificationService.markRead(user.userId, body.ids);
    } else {
      await notificationService.markAllRead(user.userId);
    }
    reply.send({ ok: true });
  });
}
