import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ChangeDiff } from '../../types';
import { decodeCursor, buildPage } from '../../utils/pagination';

export const activityService = {
  async log(data: {
    projectId: string;
    issueId?: string;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes?: ChangeDiff | Prisma.InputJsonValue;
    metadata?: Record<string, unknown> | Prisma.InputJsonValue;
  }) {
    return prisma.activityLog.create({ data: data as unknown as Prisma.ActivityLogUncheckedCreateInput });
  },

  async getProjectActivity(
    projectId: string,
    opts: {
      limit?: number;
      cursor?: string;
      issueId?: string;
      action?: string;
    },
  ) {
    const limit = Math.min(opts.limit ?? 25, 100);
    let cursorWhere = {};
    if (opts.cursor) {
      const { createdAt } = decodeCursor(opts.cursor);
      cursorWhere = { createdAt: { lt: createdAt } };
    }

    const items = await prisma.activityLog.findMany({
      where: {
        projectId,
        ...(opts.issueId ? { issueId: opts.issueId } : {}),
        ...(opts.action ? { action: opts.action } : {}),
        ...cursorWhere,
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });

    return buildPage(
      items.map((i) => ({ ...i, createdAt: i.createdAt })),
      limit,
    );
  },
};
