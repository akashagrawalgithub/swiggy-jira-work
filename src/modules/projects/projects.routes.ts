import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { projectsService } from './projects.service';
import { authenticate } from '../../middleware/authenticate';
import { requireProjectRole } from '../../middleware/requireProjectRole';
import { JwtPayload } from '../../types';
import { activityService } from '../activity/activity.service';

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // POST /api/projects
  fastify.post('/', async (request, reply) => {
    const user = request.user as JwtPayload;
    const body = z
      .object({
        key: z.string().min(2).max(10),
        name: z.string().min(1).max(100),
        description: z.string().optional(),
      })
      .parse(request.body);
    const project = await projectsService.create(user.userId, body);
    reply.code(201).send(project);
  });

  // GET /api/projects
  fastify.get('/', async (request, reply) => {
    const user = request.user as JwtPayload;
    const projects = await projectsService.listForUser(user.userId);
    reply.send(projects);
  });

  // GET /api/projects/:projectId
  fastify.get('/:projectId', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { projectId } = request.params as { projectId: string };
    const project = await projectsService.findById(projectId, user.userId);
    reply.send(project);
  });

  // PATCH /api/projects/:projectId
  fastify.patch(
    '/:projectId',
    { preHandler: requireProjectRole('ADMIN') },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({ name: z.string().optional(), description: z.string().optional() })
        .parse(request.body);
      const project = await projectsService.update(projectId, body);
      reply.send(project);
    },
  );

  // GET /api/projects/:projectId/board
  fastify.get('/:projectId/board', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const q = request.query as { sprintId?: string };
    const board = await projectsService.getBoardState(projectId, q.sprintId);
    reply.send(board);
  });

  // GET /api/projects/:projectId/activity
  fastify.get('/:projectId/activity', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const q = request.query as {
      limit?: string;
      cursor?: string;
      issueId?: string;
      action?: string;
    };
    const result = await activityService.getProjectActivity(projectId, {
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      cursor: q.cursor,
      issueId: q.issueId,
      action: q.action,
    });
    reply.send(result);
  });

  // POST /api/projects/:projectId/members
  fastify.post(
    '/:projectId/members',
    { preHandler: requireProjectRole('ADMIN') },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({
          userId: z.string(),
          role: z.enum(['MEMBER', 'ADMIN', 'VIEWER']).default('MEMBER'),
        })
        .parse(request.body);
      const member = await projectsService.addMember(projectId, body.userId, body.role);
      reply.code(201).send(member);
    },
  );

  // DELETE /api/projects/:projectId/members/:userId
  fastify.delete(
    '/:projectId/members/:userId',
    { preHandler: requireProjectRole('ADMIN') },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { projectId, userId } = request.params as {
        projectId: string;
        userId: string;
      };
      await projectsService.removeMember(projectId, userId, user.userId);
      reply.code(204).send();
    },
  );

  // GET /api/projects/:projectId/custom-fields
  fastify.get('/:projectId/custom-fields', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    reply.send(await projectsService.getCustomFields(projectId));
  });

  // POST /api/projects/:projectId/custom-fields
  fastify.post(
    '/:projectId/custom-fields',
    { preHandler: requireProjectRole('ADMIN') },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({
          name: z.string().min(1),
          type: z.enum(['TEXT', 'NUMBER', 'DROPDOWN', 'DATE']),
          options: z.array(z.string()).optional(),
          required: z.boolean().optional(),
        })
        .parse(request.body);
      const field = await projectsService.createCustomField(projectId, body);
      reply.code(201).send(field);
    },
  );

  // GET /api/projects/:projectId/labels
  fastify.get('/:projectId/labels', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    reply.send(await projectsService.getLabels(projectId));
  });

  // POST /api/projects/:projectId/labels
  fastify.post('/:projectId/labels', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = z
      .object({ name: z.string().min(1), color: z.string().optional() })
      .parse(request.body);
    const label = await projectsService.createLabel(projectId, body);
    reply.code(201).send(label);
  });
}
