import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { commentsService } from './comments.service';
import { authenticate } from '../../middleware/authenticate';
import { JwtPayload } from '../../types';

export async function commentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/issues/:issueId/comments
  fastify.get('/issues/:issueId/comments', async (request, reply) => {
    const { issueId } = request.params as { issueId: string };
    const q = request.query as { limit?: string; cursor?: string };
    const result = await commentsService.list(issueId, {
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      cursor: q.cursor,
    });
    reply.send(result);
  });

  // POST /api/issues/:issueId/comments
  fastify.post('/issues/:issueId/comments', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { issueId } = request.params as { issueId: string };
    const body = z
      .object({
        content: z.string().min(1).max(10000),
        parentId: z.string().optional(),
      })
      .parse(request.body);
    const comment = await commentsService.create(issueId, user.userId, body);
    reply.code(201).send(comment);
  });

  // PATCH /api/comments/:commentId
  fastify.patch('/comments/:commentId', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { commentId } = request.params as { commentId: string };
    const { content } = z
      .object({ content: z.string().min(1).max(10000) })
      .parse(request.body);
    reply.send(await commentsService.update(commentId, user.userId, content));
  });

  // DELETE /api/comments/:commentId
  fastify.delete('/comments/:commentId', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { commentId } = request.params as { commentId: string };
    await commentsService.delete(commentId, user.userId);
    reply.code(204).send();
  });
}
