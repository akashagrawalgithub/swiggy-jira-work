import { FastifyRequest, FastifyReply } from 'fastify';
import { ProjectRole } from '@prisma/client';
import { prisma } from '../config/database';
import { JwtPayload } from '../types';

const roleRank: Record<ProjectRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/**
 * Factory: returns a preHandler that asserts the caller has at least `minRole`
 * in the project referenced by `request.params.projectId`.
 */
export function requireProjectRole(minRole: ProjectRole) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload;
    const { projectId } = request.params as { projectId?: string };

    if (!projectId) return; // no project context — skip

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.userId } },
      select: { role: true },
    });

    if (!member || roleRank[member.role] < roleRank[minRole]) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: `Requires at least ${minRole} role in this project`,
      });
    }
  };
}
