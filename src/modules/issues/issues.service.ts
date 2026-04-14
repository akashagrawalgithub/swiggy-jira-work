import { IssueType, Priority } from '@prisma/client';
import { prisma } from '../../config/database';
import { createError } from '../../utils/errors';
import { nextIssueKey } from '../../utils/issueKey';
import { computeDiff } from '../../utils/diff';
import { workflowService } from '../workflow/workflow.service';
import { activityService } from '../activity/activity.service';
import { notificationService } from '../notifications/notification.service';
import { broadcastEvent } from '../websocket/events.service';
import { WorkflowGuard, WorkflowAction } from '../../types';

const ISSUE_INCLUDE = {
  assignee: { select: { id: true, displayName: true, avatarUrl: true } },
  reporter: { select: { id: true, displayName: true, avatarUrl: true } },
  sprint: { select: { id: true, name: true, status: true } },
  parent: { select: { id: true, issueKey: true, title: true, type: true } },
  children: {
    select: { id: true, issueKey: true, title: true, type: true, status: true, priority: true },
  },
  issueLabels: { include: { label: true } },
  watchers: { include: { user: { select: { id: true, displayName: true } } } },
  customValues: { include: { customField: true } },
  _count: { select: { comments: true } },
} as const;

export interface CreateIssueInput {
  type: IssueType;
  title: string;
  description?: string;
  priority?: Priority;
  assigneeId?: string;
  sprintId?: string;
  parentId?: string;
  storyPoints?: number;
  dueDate?: string;
  labelIds?: string[];
}

export interface UpdateIssueInput {
  title?: string;
  description?: string | null;
  priority?: Priority;
  assigneeId?: string | null;
  sprintId?: string | null;
  storyPoints?: number | null;
  dueDate?: string | null;
  labelIds?: string[];
  version?: number; // for optimistic locking
}

export const issuesService = {
  async create(projectId: string, reporterId: string, input: CreateIssueInput) {
    // Validate parent hierarchy
    if (input.parentId) {
      await this.validateParentChild(input.type, input.parentId);
    }

    // Validate sprint belongs to project
    if (input.sprintId) {
      const sprint = await prisma.sprint.findFirst({
        where: { id: input.sprintId, projectId },
      });
      if (!sprint) throw createError(400, 'Sprint not found in this project');
    }

    // Get initial status from workflow
    const workflow = await prisma.workflow.findUnique({
      where: { projectId },
      include: { statuses: { where: { isInitial: true } } },
    });
    if (!workflow || !workflow.statuses[0]) {
      throw createError(500, 'Workflow not configured for this project');
    }
    const initialStatus = workflow.statuses[0].name;

    // Atomic key generation via Redis INCR
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { key: true },
    });
    if (!project) throw createError(404, 'Project not found');
    const issueKey = await nextIssueKey(project.key, projectId);

    const issue = await prisma.$transaction(async (tx) => {
      const created = await tx.issue.create({
        data: {
          issueKey,
          projectId,
          reporterId,
          type: input.type,
          title: input.title,
          description: input.description,
          priority: input.priority ?? 'MEDIUM',
          assigneeId: input.assigneeId,
          sprintId: input.sprintId,
          parentId: input.parentId,
          storyPoints: input.storyPoints,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          status: initialStatus,
        },
        include: ISSUE_INCLUDE,
      });

      // Attach labels
      if (input.labelIds?.length) {
        await tx.issueLabel.createMany({
          data: input.labelIds.map((labelId) => ({ issueId: created.id, labelId })),
        });
      }

      // Auto-watch: reporter + assignee
      await tx.issueWatcher.createMany({
        data: [
          { issueId: created.id, userId: reporterId },
          ...(input.assigneeId && input.assigneeId !== reporterId
            ? [{ issueId: created.id, userId: input.assigneeId }]
            : []),
        ],
        skipDuplicates: true,
      });

      return created;
    });

    // Activity log
    await activityService.log({
      projectId,
      issueId: issue.id,
      userId: reporterId,
      action: 'created',
      entityType: 'issue',
      entityId: issue.id,
      metadata: { issueKey, type: issue.type, title: issue.title },
    });

    // Notify assignee
    if (input.assigneeId && input.assigneeId !== reporterId) {
      await notificationService.create({
        userId: input.assigneeId,
        type: 'ASSIGNED',
        title: `You were assigned to ${issueKey}`,
        body: issue.title,
        issueId: issue.id,
      });
    }

    // Broadcast WS event
    await broadcastEvent({
      type: 'issue_created',
      projectId,
      actorId: reporterId,
      timestamp: new Date().toISOString(),
      payload: issue,
    });

    return this.findById(issue.id);
  },

  async findById(issueId: string) {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      include: ISSUE_INCLUDE,
    });
    if (!issue) throw createError(404, 'Issue not found');
    return issue;
  },

  async findByKey(issueKey: string) {
    const issue = await prisma.issue.findUnique({
      where: { issueKey },
      include: ISSUE_INCLUDE,
    });
    if (!issue) throw createError(404, 'Issue not found');
    return issue;
  },

  async update(issueId: string, actorId: string, input: UpdateIssueInput) {
    const existing = await prisma.issue.findUnique({ where: { id: issueId } });
    if (!existing) throw createError(404, 'Issue not found');

    // Optimistic locking — if client sends version, it must match
    if (input.version !== undefined && existing.version !== input.version) {
      throw createError(
        409,
        `Conflict: issue was updated by someone else (expected version ${input.version}, got ${existing.version}). Refresh and retry.`,
      );
    }

    const { labelIds, version: _v, ...updateData } = input;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.issue.update({
        where: { id: issueId },
        data: {
          ...updateData,
          dueDate: updateData.dueDate ? new Date(updateData.dueDate) : updateData.dueDate,
          version: { increment: 1 },
        },
        include: ISSUE_INCLUDE,
      });

      if (labelIds !== undefined) {
        await tx.issueLabel.deleteMany({ where: { issueId } });
        if (labelIds.length) {
          await tx.issueLabel.createMany({
            data: labelIds.map((labelId) => ({ issueId, labelId })),
          });
        }
      }

      return u;
    });

    // Compute diff for audit trail
    const before: Record<string, unknown> = {
      title: existing.title,
      description: existing.description,
      priority: existing.priority,
      assigneeId: existing.assigneeId,
      sprintId: existing.sprintId,
      storyPoints: existing.storyPoints,
      dueDate: existing.dueDate?.toISOString() ?? null,
    };
    const after: Record<string, unknown> = {
      title: updated.title,
      description: updated.description,
      priority: updated.priority,
      assigneeId: updated.assigneeId,
      sprintId: updated.sprintId,
      storyPoints: updated.storyPoints,
      dueDate: updated.dueDate?.toISOString() ?? null,
    };
    const diff = computeDiff(before, after);

    if (Object.keys(diff).length) {
      await activityService.log({
        projectId: existing.projectId,
        issueId,
        userId: actorId,
        action: 'updated',
        entityType: 'issue',
        entityId: issueId,
        changes: diff,
      });

      // Notify watchers of update
      await notificationService.notifyWatchers(issueId, actorId, {
        type: 'WATCHED_ISSUE_UPDATED',
        title: `${existing.issueKey} was updated`,
        body: Object.keys(diff).join(', ') + ' changed',
      });

      // Notify new assignee if changed
      if (diff['assigneeId'] && updated.assigneeId) {
        await notificationService.create({
          userId: updated.assigneeId,
          type: 'ASSIGNED',
          title: `You were assigned to ${existing.issueKey}`,
          body: updated.title,
          issueId,
        });
      }

      await broadcastEvent({
        type: 'issue_updated',
        projectId: existing.projectId,
        actorId,
        timestamp: new Date().toISOString(),
        payload: { issue: updated, changes: diff },
      });
    }

    return updated;
  },

  async transition(issueId: string, actorId: string, toStatus: string) {
    const issue = await prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) throw createError(404, 'Issue not found');

    const fromStatus = issue.status;
    if (fromStatus === toStatus) return this.findById(issueId);

    // Validate transition is allowed (Scenario 3)
    const { transition } = await workflowService.validateTransition(
      issue.projectId,
      fromStatus,
      toStatus,
    );

    // Run guards
    if (transition.guards) {
      workflowService.validateGuards(
        transition.guards as unknown as WorkflowGuard[],
        issue as unknown as Record<string, unknown>,
      );
    }

    // Apply actions before updating (e.g., auto-assign)
    const actionUpdates: Record<string, unknown> = {};
    if (transition.actions) {
      for (const action of (transition.actions as unknown as WorkflowAction[])) {
        if (action.type === 'set_field' && action.field) {
          actionUpdates[action.field] = action.value;
        }
      }
    }

    const updated = await prisma.issue.update({
      where: { id: issueId },
      data: { status: toStatus, version: { increment: 1 }, ...actionUpdates },
      include: ISSUE_INCLUDE,
    });

    // Activity log
    await activityService.log({
      projectId: issue.projectId,
      issueId,
      userId: actorId,
      action: 'transitioned',
      entityType: 'issue',
      entityId: issueId,
      changes: { status: { from: fromStatus, to: toStatus } },
    });

    // Notify watchers
    await notificationService.notifyWatchers(issueId, actorId, {
      type: 'STATUS_CHANGED',
      title: `${issue.issueKey} moved to ${toStatus}`,
      body: `From "${fromStatus}" → "${toStatus}"`,
    });

    // Broadcast
    await broadcastEvent({
      type: 'issue_moved',
      projectId: issue.projectId,
      actorId,
      timestamp: new Date().toISOString(),
      payload: { issueId, fromStatus, toStatus, issue: updated },
    });

    return updated;
  },

  async delete(issueId: string, actorId: string) {
    const issue = await prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) throw createError(404, 'Issue not found');

    await prisma.issue.delete({ where: { id: issueId } });

    await activityService.log({
      projectId: issue.projectId,
      userId: actorId,
      action: 'deleted',
      entityType: 'issue',
      entityId: issueId,
      metadata: { issueKey: issue.issueKey, title: issue.title },
    });

    await broadcastEvent({
      type: 'issue_deleted',
      projectId: issue.projectId,
      actorId,
      timestamp: new Date().toISOString(),
      payload: { issueId, issueKey: issue.issueKey },
    });
  },

  async watch(issueId: string, userId: string) {
    await prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId, userId } },
      create: { issueId, userId },
      update: {},
    });
  },

  async unwatch(issueId: string, userId: string) {
    await prisma.issueWatcher.deleteMany({ where: { issueId, userId } });
  },

  async setCustomFieldValue(issueId: string, customFieldId: string, value: string) {
    return prisma.customFieldValue.upsert({
      where: { issueId_customFieldId: { issueId, customFieldId } },
      create: { issueId, customFieldId, value },
      update: { value },
    });
  },

  // ─── Hierarchy validation ─────────────────────────────────────────────────

  async validateParentChild(childType: IssueType, parentId: string) {
    const parent = await prisma.issue.findUnique({
      where: { id: parentId },
      select: { type: true },
    });
    if (!parent) throw createError(404, 'Parent issue not found');

    const allowed: Record<IssueType, IssueType[]> = {
      EPIC: [],
      STORY: ['EPIC'],
      TASK: ['EPIC', 'STORY'],
      BUG: ['EPIC', 'STORY'],
      SUBTASK: ['STORY', 'TASK', 'BUG'],
    };

    if (!allowed[childType].includes(parent.type)) {
      throw createError(
        422,
        `A ${childType} cannot be a child of a ${parent.type}. ` +
          `Allowed parents: ${allowed[childType].join(', ') || 'none'}`,
      );
    }
  },
};
