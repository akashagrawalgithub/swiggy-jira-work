import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { createError } from '../../utils/errors';
import { WorkflowGuard, WorkflowAction } from '../../types';

// Default workflow applied when a project is created
export const DEFAULT_WORKFLOW = {
  name: 'Default Software Workflow',
  statuses: [
    { name: 'To Do',     color: '#6B7280', category: 'TODO'        as const, position: 0, isInitial: true,  isDone: false },
    { name: 'In Progress', color: '#3B82F6', category: 'IN_PROGRESS' as const, position: 1, isInitial: false, isDone: false },
    { name: 'In Review', color: '#F59E0B', category: 'IN_PROGRESS' as const, position: 2, isInitial: false, isDone: false },
    { name: 'Done',      color: '#10B981', category: 'DONE'        as const, position: 3, isInitial: false, isDone: true  },
  ],
  // Allowed transitions — only these are valid; anything else is rejected (Scenario 3)
  transitions: [
    { fromStatus: 'To Do',      toStatus: 'In Progress', name: 'Start'   },
    { fromStatus: 'In Progress', toStatus: 'In Review',  name: 'Review'  },
    { fromStatus: 'In Progress', toStatus: 'To Do',      name: 'Reopen'  },
    { fromStatus: 'In Review',  toStatus: 'Done',        name: 'Approve' },
    { fromStatus: 'In Review',  toStatus: 'In Progress', name: 'Request Changes' },
    { fromStatus: 'Done',       toStatus: 'In Progress', name: 'Reopen'  },
  ],
};

export const workflowService = {
  /**
   * Provision the default workflow for a new project.
   */
  async createDefaultWorkflow(projectId: string) {
    return prisma.workflow.create({
      data: {
        projectId,
        name: DEFAULT_WORKFLOW.name,
        statuses: { createMany: { data: DEFAULT_WORKFLOW.statuses } },
        transitions: { createMany: { data: DEFAULT_WORKFLOW.transitions } },
      },
      include: { statuses: true, transitions: true },
    });
  },

  async getWorkflow(projectId: string) {
    const workflow = await prisma.workflow.findUnique({
      where: { projectId },
      include: {
        statuses: { orderBy: { position: 'asc' } },
        transitions: true,
      },
    });
    if (!workflow) throw createError(404, 'Workflow not found');
    return workflow;
  },

  async updateStatus(
    projectId: string,
    statusId: string,
    data: Partial<{ name: string; color: string; position: number; isDone: boolean }>,
  ) {
    const workflow = await prisma.workflow.findUnique({ where: { projectId } });
    if (!workflow) throw createError(404, 'Workflow not found');
    return prisma.workflowStatus.update({ where: { id: statusId }, data });
  },

  async addStatus(
    projectId: string,
    data: { name: string; color?: string; category?: 'TODO' | 'IN_PROGRESS' | 'DONE'; position: number },
  ) {
    const workflow = await prisma.workflow.findUnique({ where: { projectId } });
    if (!workflow) throw createError(404, 'Workflow not found');
    return prisma.workflowStatus.create({
      data: { workflowId: workflow.id, ...data },
    });
  },

  async addTransition(
    projectId: string,
    data: {
      fromStatus: string;
      toStatus: string;
      name?: string;
      guards?: WorkflowGuard[];
      actions?: WorkflowAction[];
    },
  ) {
    const workflow = await prisma.workflow.findUnique({ where: { projectId } });
    if (!workflow) throw createError(404, 'Workflow not found');
    return prisma.workflowTransition.create({
      data: {
        workflowId: workflow.id,
        fromStatus: data.fromStatus,
        toStatus: data.toStatus,
        name: data.name,
        guards: data.guards as unknown as Prisma.InputJsonValue ?? undefined,
        actions: data.actions as unknown as Prisma.InputJsonValue ?? undefined,
      },
    });
  },

  async removeTransition(projectId: string, transitionId: string) {
    const workflow = await prisma.workflow.findUnique({ where: { projectId } });
    if (!workflow) throw createError(404, 'Workflow not found');
    await prisma.workflowTransition.delete({ where: { id: transitionId } });
  },

  /**
   * Core transition validator.
   * Returns the matching transition or throws with allowed transitions listed.
   */
  async validateTransition(projectId: string, fromStatus: string, toStatus: string) {
    const workflow = await prisma.workflow.findUnique({
      where: { projectId },
      include: { transitions: true, statuses: true },
    });
    if (!workflow) throw createError(404, 'Workflow not found');

    const transition = workflow.transitions.find(
      (t) => t.fromStatus === fromStatus && t.toStatus === toStatus,
    );

    if (!transition) {
      const allowed = workflow.transitions
        .filter((t) => t.fromStatus === fromStatus)
        .map((t) => t.toStatus);
      throw createError(
        422,
        `Transition from "${fromStatus}" to "${toStatus}" is not allowed. ` +
          `Allowed transitions: ${allowed.length ? allowed.join(', ') : 'none'}`,
      );
    }

    return { transition, workflow };
  },

  /**
   * Run guards against the issue being transitioned.
   * Throws 422 if any guard fails.
   */
  validateGuards(
    guards: WorkflowGuard[],
    issue: Record<string, unknown>,
  ): void {
    for (const guard of guards) {
      if (guard.type === 'required_field') {
        const val = issue[guard.field!];
        if (val === null || val === undefined || val === '') {
          throw createError(
            422,
            guard.message ?? `Field "${guard.field}" is required for this transition`,
          );
        }
      }
      if (guard.type === 'has_assignee') {
        if (!issue['assigneeId']) {
          throw createError(422, guard.message ?? 'Issue must have an assignee');
        }
      }
      if (guard.type === 'min_story_points') {
        const sp = issue['storyPoints'] as number | null;
        if (!sp || sp < (guard.value ?? 1)) {
          throw createError(
            422,
            guard.message ?? `Story points must be at least ${guard.value ?? 1}`,
          );
        }
      }
    }
  },
};
