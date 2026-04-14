import { prisma } from '../../config/database';
import { createError } from '../../utils/errors';
import { workflowService } from '../workflow/workflow.service';
import { seedIssueCounter } from '../../utils/issueKey';

export const projectsService = {
  async create(userId: string, data: { key: string; name: string; description?: string }) {
    const key = data.key.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!key) throw createError(400, 'Invalid project key');

    const existing = await prisma.project.findUnique({ where: { key } });
    if (existing) throw createError(409, `Project key "${key}" is already taken`);

    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: { key, name: data.name, description: data.description },
      });
      // Creator is the OWNER
      await tx.projectMember.create({
        data: { projectId: p.id, userId, role: 'OWNER' },
      });
      return p;
    });

    // Provision default workflow (outside tx — non-critical)
    await workflowService.createDefaultWorkflow(project.id);
    // Seed atomic issue counter in Redis
    await seedIssueCounter(project.id, 0);

    return this.findById(project.id, userId);
  },

  async findById(projectId: string, userId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: {
          include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
        },
        _count: { select: { issues: true, sprints: true } },
      },
    });
    if (!project) throw createError(404, 'Project not found');

    // Verify membership
    const isMember = project.members.some((m) => m.userId === userId);
    if (!isMember) throw createError(403, 'You are not a member of this project');

    return project;
  },

  async listForUser(userId: string) {
    return prisma.project.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
        _count: { select: { issues: true, sprints: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  },

  async update(
    projectId: string,
    data: Partial<{ name: string; description: string }>,
  ) {
    return prisma.project.update({ where: { id: projectId }, data });
  },

  async addMember(projectId: string, userId: string, role: 'MEMBER' | 'ADMIN' | 'VIEWER') {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw createError(404, 'User not found');

    return prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, role },
      update: { role },
    });
  },

  async removeMember(projectId: string, userId: string, actorId: string) {
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw createError(404, 'Member not found');
    if (member.role === 'OWNER' && userId !== actorId) {
      throw createError(403, 'Cannot remove the project owner');
    }
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
  },

  /**
   * Board view: issues grouped by status column.
   */
  async getBoardState(projectId: string, sprintId?: string) {
    const workflow = await prisma.workflow.findUnique({
      where: { projectId },
      include: { statuses: { orderBy: { position: 'asc' } } },
    });
    if (!workflow) throw createError(404, 'Workflow not found for this project');

    const issues = await prisma.issue.findMany({
      where: {
        projectId,
        ...(sprintId ? { sprintId } : { sprintId: null }),
      },
      include: {
        assignee: { select: { id: true, displayName: true, avatarUrl: true } },
        reporter: { select: { id: true, displayName: true, avatarUrl: true } },
        issueLabels: { include: { label: true } },
        _count: { select: { children: true, comments: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const columns = workflow.statuses.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      category: s.category,
      isDone: s.isDone,
      issues: issues.filter((i) => i.status === s.name),
    }));

    return { projectId, sprintId: sprintId ?? null, columns };
  },

  async getCustomFields(projectId: string) {
    return prisma.customField.findMany({ where: { projectId } });
  },

  async createCustomField(
    projectId: string,
    data: {
      name: string;
      type: 'TEXT' | 'NUMBER' | 'DROPDOWN' | 'DATE';
      options?: string[];
      required?: boolean;
    },
  ) {
    return prisma.customField.create({
      data: {
        projectId,
        name: data.name,
        type: data.type,
        options: data.options ?? undefined,
        required: data.required ?? false,
      },
    });
  },

  async getLabels(projectId: string) {
    return prisma.label.findMany({ where: { projectId } });
  },

  async createLabel(projectId: string, data: { name: string; color?: string }) {
    return prisma.label.create({
      data: { projectId, name: data.name, color: data.color ?? '#6B7280' },
    });
  },
};
