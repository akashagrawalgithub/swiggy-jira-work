import { SprintStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { createError } from '../../utils/errors';
import { activityService } from '../activity/activity.service';
import { broadcastEvent } from '../websocket/events.service';

export const sprintsService = {
  async create(projectId: string, userId: string, data: {
    name: string;
    goal?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const sprint = await prisma.sprint.create({
      data: {
        projectId,
        name: data.name,
        goal: data.goal,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
    });

    await activityService.log({
      projectId,
      userId,
      action: 'created',
      entityType: 'sprint',
      entityId: sprint.id,
      metadata: { name: sprint.name },
    });

    await broadcastEvent({
      type: 'sprint_created',
      projectId,
      actorId: userId,
      timestamp: new Date().toISOString(),
      payload: sprint,
    });

    return sprint;
  },

  async list(projectId: string) {
    return prisma.sprint.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { issues: true } },
      },
    });
  },

  async findById(sprintId: string) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        issues: {
          include: {
            assignee: { select: { id: true, displayName: true, avatarUrl: true } },
          },
        },
      },
    });
    if (!sprint) throw createError(404, 'Sprint not found');
    return sprint;
  },

  async update(sprintId: string, userId: string, data: {
    name?: string;
    goal?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) throw createError(404, 'Sprint not found');
    if (sprint.status === 'COMPLETED') throw createError(422, 'Cannot edit a completed sprint');

    const updated = await prisma.sprint.update({
      where: { id: sprintId },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
    });

    await broadcastEvent({
      type: 'sprint_updated',
      projectId: sprint.projectId,
      actorId: userId,
      timestamp: new Date().toISOString(),
      payload: updated,
    });

    return updated;
  },

  async start(sprintId: string, userId: string) {
    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) throw createError(404, 'Sprint not found');
    if (sprint.status !== 'PLANNED') throw createError(422, 'Only a PLANNED sprint can be started');

    // Ensure no other active sprint in this project
    const active = await prisma.sprint.findFirst({
      where: { projectId: sprint.projectId, status: 'ACTIVE' },
    });
    if (active) {
      throw createError(422, `Sprint "${active.name}" is already active. Complete it before starting another.`);
    }

    const updated = await prisma.sprint.update({
      where: { id: sprintId },
      data: {
        status: 'ACTIVE',
        startDate: sprint.startDate ?? new Date(),
      },
    });

    await activityService.log({
      projectId: sprint.projectId,
      userId,
      action: 'started',
      entityType: 'sprint',
      entityId: sprintId,
    });

    await broadcastEvent({
      type: 'sprint_started',
      projectId: sprint.projectId,
      actorId: userId,
      timestamp: new Date().toISOString(),
      payload: updated,
    });

    return updated;
  },

  /**
   * Complete a sprint — Scenario 2.
   *
   * Returns incomplete items (not in "Done" status).
   * Optionally carries over selected issues to a target sprint or backlog.
   */
  async complete(
    sprintId: string,
    userId: string,
    opts: {
      carryOverIssueIds?: string[];   // issues to move to targetSprintId or backlog
      targetSprintId?: string;         // if omitted → backlog (sprintId = null)
    } = {},
  ) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { issues: true },
    });
    if (!sprint) throw createError(404, 'Sprint not found');
    if (sprint.status !== 'ACTIVE') throw createError(422, 'Only an ACTIVE sprint can be completed');

    // Determine "done" statuses from the workflow
    const workflow = await prisma.workflow.findUnique({
      where: { projectId: sprint.projectId },
      include: { statuses: { where: { isDone: true } } },
    });
    const doneStatuses = new Set(workflow?.statuses.map((s) => s.name) ?? ['Done']);

    const incomplete = sprint.issues.filter((i) => !doneStatuses.has(i.status));
    const completed  = sprint.issues.filter((i) => doneStatuses.has(i.status));

    // Validate carry-over ids belong to this sprint's incomplete items
    const incompleteIds = new Set(incomplete.map((i) => i.id));
    for (const id of opts.carryOverIssueIds ?? []) {
      if (!incompleteIds.has(id)) {
        throw createError(400, `Issue ${id} is not an incomplete item of this sprint`);
      }
    }

    await prisma.$transaction(async (tx) => {
      // Mark sprint completed
      await tx.sprint.update({
        where: { id: sprintId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      // Move selected carry-over issues
      if (opts.carryOverIssueIds?.length) {
        await tx.issue.updateMany({
          where: { id: { in: opts.carryOverIssueIds } },
          data: { sprintId: opts.targetSprintId ?? null },
        });
      }

      // Remaining incomplete issues → backlog
      const remaining = incomplete
        .map((i) => i.id)
        .filter((id) => !opts.carryOverIssueIds?.includes(id));
      if (remaining.length) {
        await tx.issue.updateMany({
          where: { id: { in: remaining } },
          data: { sprintId: null },
        });
      }
    });

    // Velocity = story points of completed issues
    const velocity = completed.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

    await activityService.log({
      projectId: sprint.projectId,
      userId,
      action: 'completed',
      entityType: 'sprint',
      entityId: sprintId,
      metadata: {
        velocity,
        completedIssues: completed.length,
        incompleteIssues: incomplete.length,
        carriedOver: opts.carryOverIssueIds?.length ?? 0,
      },
    });

    await broadcastEvent({
      type: 'sprint_completed',
      projectId: sprint.projectId,
      actorId: userId,
      timestamp: new Date().toISOString(),
      payload: { sprintId, velocity, completedIssues: completed.length, incompleteIssues: incomplete.length },
    });

    return {
      sprintId,
      velocity,
      completedIssues: completed,
      incompleteIssues: incomplete,
      carriedOver: opts.carryOverIssueIds ?? [],
    };
  },

  /**
   * Sprint velocity history for a project.
   */
  async velocityHistory(projectId: string) {
    const sprints = await prisma.sprint.findMany({
      where: { projectId, status: 'COMPLETED' },
      include: { issues: { select: { storyPoints: true, status: true } } },
      orderBy: { completedAt: 'asc' },
    });

    const workflow = await prisma.workflow.findUnique({
      where: { projectId },
      include: { statuses: { where: { isDone: true } } },
    });
    const doneStatuses = new Set(workflow?.statuses.map((s) => s.name) ?? ['Done']);

    return sprints.map((s) => ({
      sprintId: s.id,
      name: s.name,
      completedAt: s.completedAt,
      velocity: s.issues
        .filter((i) => doneStatuses.has(i.status))
        .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
    }));
  },

  async moveToSprint(issueIds: string[], targetSprintId: string | null, userId: string) {
    if (targetSprintId) {
      const sprint = await prisma.sprint.findUnique({ where: { id: targetSprintId } });
      if (!sprint) throw createError(404, 'Target sprint not found');
      if (sprint.status === 'COMPLETED') throw createError(422, 'Cannot move issues to a completed sprint');
    }

    await prisma.issue.updateMany({
      where: { id: { in: issueIds } },
      data: { sprintId: targetSprintId },
    });

    return { moved: issueIds.length };
  },
};
