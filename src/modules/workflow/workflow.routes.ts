import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { workflowService } from './workflow.service';
import { authenticate } from '../../middleware/authenticate';
import { requireProjectRole } from '../../middleware/requireProjectRole';

export async function workflowRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // GET /api/projects/:projectId/workflow
  fastify.get('/:projectId/workflow', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const workflow = await workflowService.getWorkflow(projectId);
    reply.send(workflow);
  });

  // POST /api/projects/:projectId/workflow/statuses
  fastify.post(
    '/:projectId/workflow/statuses',
    { preHandler: requireProjectRole('ADMIN') },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({
          name: z.string().min(1),
          color: z.string().optional(),
          category: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
          position: z.number().int().min(0),
        })
        .parse(request.body);
      const status = await workflowService.addStatus(projectId, body);
      reply.code(201).send(status);
    },
  );

  // PATCH /api/projects/:projectId/workflow/statuses/:statusId
  fastify.patch(
    '/:projectId/workflow/statuses/:statusId',
    { preHandler: requireProjectRole('ADMIN') },
    async (request, reply) => {
      const { projectId, statusId } = request.params as {
        projectId: string;
        statusId: string;
      };
      const body = z
        .object({
          name: z.string().optional(),
          color: z.string().optional(),
          position: z.number().int().optional(),
          isDone: z.boolean().optional(),
        })
        .parse(request.body);
      const status = await workflowService.updateStatus(projectId, statusId, body);
      reply.send(status);
    },
  );

  // POST /api/projects/:projectId/workflow/transitions
  fastify.post(
    '/:projectId/workflow/transitions',
    { preHandler: requireProjectRole('ADMIN') },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({
          fromStatus: z.string(),
          toStatus: z.string(),
          name: z.string().optional(),
          guards: z.array(z.any()).optional(),
          actions: z.array(z.any()).optional(),
        })
        .parse(request.body);
      const transition = await workflowService.addTransition(projectId, body);
      reply.code(201).send(transition);
    },
  );

  // DELETE /api/projects/:projectId/workflow/transitions/:transitionId
  fastify.delete(
    '/:projectId/workflow/transitions/:transitionId',
    { preHandler: requireProjectRole('ADMIN') },
    async (request, reply) => {
      const { projectId, transitionId } = request.params as {
        projectId: string;
        transitionId: string;
      };
      await workflowService.removeTransition(projectId, transitionId);
      reply.code(204).send();
    },
  );
}
