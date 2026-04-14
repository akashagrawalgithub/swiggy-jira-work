import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sprintsService } from './sprints.service';
import { authenticate } from '../../middleware/authenticate';
import { requireProjectRole } from '../../middleware/requireProjectRole';
import { JwtPayload } from '../../types';

export async function sprintRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/projects/:projectId/sprints
  fastify.get('/projects/:projectId/sprints', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    reply.send(await sprintsService.list(projectId));
  });

  // POST /api/projects/:projectId/sprints
  fastify.post(
    '/projects/:projectId/sprints',
    { preHandler: requireProjectRole('MEMBER') },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({
          name: z.string().min(1),
          goal: z.string().optional(),
          startDate: z.string().datetime().optional(),
          endDate: z.string().datetime().optional(),
        })
        .parse(request.body);
      const sprint = await sprintsService.create(projectId, user.userId, body);
      reply.code(201).send(sprint);
    },
  );

  // GET /api/sprints/:sprintId
  fastify.get('/sprints/:sprintId', async (request, reply) => {
    const { sprintId } = request.params as { sprintId: string };
    reply.send(await sprintsService.findById(sprintId));
  });

  // PATCH /api/sprints/:sprintId
  fastify.patch('/sprints/:sprintId', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { sprintId } = request.params as { sprintId: string };
    const body = z
      .object({
        name: z.string().optional(),
        goal: z.string().optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
      .parse(request.body);
    reply.send(await sprintsService.update(sprintId, user.userId, body));
  });

  // POST /api/sprints/:sprintId/start
  fastify.post('/sprints/:sprintId/start', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { sprintId } = request.params as { sprintId: string };
    reply.send(await sprintsService.start(sprintId, user.userId));
  });

  // POST /api/sprints/:sprintId/complete  — Scenario 2
  fastify.post('/sprints/:sprintId/complete', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { sprintId } = request.params as { sprintId: string };
    const body = z
      .object({
        carryOverIssueIds: z.array(z.string()).optional(),
        targetSprintId: z.string().optional(),
      })
      .parse(request.body ?? {});
    reply.send(await sprintsService.complete(sprintId, user.userId, body));
  });

  // GET /api/projects/:projectId/sprints/velocity
  fastify.get('/projects/:projectId/sprints/velocity', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    reply.send(await sprintsService.velocityHistory(projectId));
  });

  // POST /api/sprints/move-issues  — move issues between sprints / backlog
  fastify.post('/sprints/move-issues', async (request, reply) => {
    const user = request.user as JwtPayload;
    const body = z
      .object({
        issueIds: z.array(z.string()).min(1),
        targetSprintId: z.string().nullable().optional(),
      })
      .parse(request.body);
    const result = await sprintsService.moveToSprint(
      body.issueIds,
      body.targetSprintId ?? null,
      user.userId,
    );
    reply.send(result);
  });
}
