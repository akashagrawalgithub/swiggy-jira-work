import { FastifyInstance } from 'fastify';
import { searchService } from './search.service';
import { authenticate } from '../../middleware/authenticate';
import { JwtPayload } from '../../types';

export async function searchRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  /**
   * GET /api/search
   *
   * Query params:
   *   q          – free-text search (title, description, comments)
   *   filter     – structured query string, e.g. "status='In Progress' AND assignee='jane'"
   *   projectId  – scope to one project
   *   limit      – page size (max 100, default 25)
   *   cursor     – opaque pagination cursor from previous response
   *
   * Structured filter AND free-text can be combined.
   */
  fastify.get('/', async (request, reply) => {
    const user = request.user as JwtPayload;
    const q = request.query as {
      q?: string;
      filter?: string;
      projectId?: string;
      limit?: string;
      cursor?: string;
    };

    // Merge free-text + structured filter
    const structured = q.filter
      ? searchService.parseStructuredQuery(q.filter)
      : {};

    const result = await searchService.search(
      {
        q: q.q,
        projectId: q.projectId ?? structured.projectId,
        status:    structured.status,
        assignee:  structured.assignee,
        reporter:  structured.reporter,
        type:      structured.type,
        priority:  structured.priority,
        sprintId:  structured.sprintId,
        label:     structured.label,
        limit:     q.limit ? parseInt(q.limit, 10) : undefined,
        cursor:    q.cursor,
      },
      user.userId,
    );

    reply.send(result);
  });
}
