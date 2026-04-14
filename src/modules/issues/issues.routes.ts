import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IssueType, Priority } from '@prisma/client';
import { issuesService } from './issues.service';
import { authenticate } from '../../middleware/authenticate';
import { JwtPayload } from '../../types';
import { prisma } from '../../config/database';
import { createError } from '../../utils/errors';

const createIssueSchema = z.object({
  type: z.nativeEnum(IssueType),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.nativeEnum(Priority).optional(),
  assigneeId: z.string().optional(),
  sprintId: z.string().optional(),
  parentId: z.string().optional(),
  storyPoints: z.number().int().min(0).optional(),
  dueDate: z.string().datetime().optional(),
  labelIds: z.array(z.string()).optional(),
});

const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  priority: z.nativeEnum(Priority).optional(),
  assigneeId: z.string().nullable().optional(),
  sprintId: z.string().nullable().optional(),
  storyPoints: z.number().int().min(0).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  labelIds: z.array(z.string()).optional(),
  version: z.number().int().optional(),
});

export async function issueRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // POST /api/projects/:projectId/issues
  fastify.post('/projects/:projectId/issues', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { projectId } = request.params as { projectId: string };

    // Verify membership
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.userId } },
    });
    if (!member) throw createError(403, 'Not a project member');

    const body = createIssueSchema.parse(request.body);
    const issue = await issuesService.create(projectId, user.userId, body);
    reply.code(201).send(issue);
  });

  // GET /api/issues/:issueId
  fastify.get('/issues/:issueId', async (request, reply) => {
    const { issueId } = request.params as { issueId: string };
    const issue = await issuesService.findById(issueId);
    reply.send(issue);
  });

  // GET /api/issues/by-key/:issueKey
  fastify.get('/issues/by-key/:issueKey', async (request, reply) => {
    const { issueKey } = request.params as { issueKey: string };
    const issue = await issuesService.findByKey(issueKey);
    reply.send(issue);
  });

  // PATCH /api/issues/:issueId
  fastify.patch('/issues/:issueId', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { issueId } = request.params as { issueId: string };
    const body = updateIssueSchema.parse(request.body);
    const issue = await issuesService.update(issueId, user.userId, body);
    reply.send(issue);
  });

  // POST /api/issues/:issueId/transitions — Scenario 3
  fastify.post('/issues/:issueId/transitions', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { issueId } = request.params as { issueId: string };
    const { toStatus } = z
      .object({ toStatus: z.string().min(1) })
      .parse(request.body);
    const issue = await issuesService.transition(issueId, user.userId, toStatus);
    reply.send(issue);
  });

  // DELETE /api/issues/:issueId
  fastify.delete('/issues/:issueId', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { issueId } = request.params as { issueId: string };
    await issuesService.delete(issueId, user.userId);
    reply.code(204).send();
  });

  // POST /api/issues/:issueId/watch
  fastify.post('/issues/:issueId/watch', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { issueId } = request.params as { issueId: string };
    await issuesService.watch(issueId, user.userId);
    reply.send({ ok: true });
  });

  // DELETE /api/issues/:issueId/watch
  fastify.delete('/issues/:issueId/watch', async (request, reply) => {
    const user = request.user as JwtPayload;
    const { issueId } = request.params as { issueId: string };
    await issuesService.unwatch(issueId, user.userId);
    reply.code(204).send();
  });

  // PATCH /api/issues/:issueId/custom-fields
  fastify.patch('/issues/:issueId/custom-fields', async (request, reply) => {
    const { issueId } = request.params as { issueId: string };
    const body = z
      .object({ customFieldId: z.string(), value: z.string() })
      .parse(request.body);
    const val = await issuesService.setCustomFieldValue(issueId, body.customFieldId, body.value);
    reply.send(val);
  });
}
