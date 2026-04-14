import { NotificationType } from '@prisma/client';
import { prisma } from '../../config/database';
import { decodeCursor, buildPage } from '../../utils/pagination';

export const notificationService = {
  async create(data: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    issueId?: string;
  }) {
    return prisma.notification.create({ data });
  },

  async createBulk(
    userIds: string[],
    data: {
      type: NotificationType;
      title: string;
      body?: string;
      issueId?: string;
    },
  ) {
    if (!userIds.length) return;
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, ...data })),
    });
  },

  async list(userId: string, opts: { limit?: number; cursor?: string; unreadOnly?: boolean }) {
    const limit = Math.min(opts.limit ?? 20, 50);
    let cursorWhere = {};
    if (opts.cursor) {
      const { createdAt } = decodeCursor(opts.cursor);
      cursorWhere = { createdAt: { lt: createdAt } };
    }

    const items = await prisma.notification.findMany({
      where: {
        userId,
        ...(opts.unreadOnly ? { isRead: false } : {}),
        ...cursorWhere,
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    return buildPage(items, limit);
  },

  async markRead(userId: string, notificationIds: string[]) {
    await prisma.notification.updateMany({
      where: { id: { in: notificationIds }, userId },
      data: { isRead: true },
    });
  },

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  },

  async unreadCount(userId: string) {
    return prisma.notification.count({ where: { userId, isRead: false } });
  },

  /**
   * Notify all watchers of an issue (excluding the actor).
   */
  async notifyWatchers(
    issueId: string,
    actorId: string,
    data: { type: NotificationType; title: string; body?: string },
  ) {
    const watchers = await prisma.issueWatcher.findMany({
      where: { issueId, userId: { not: actorId } },
      select: { userId: true },
    });
    await this.createBulk(
      watchers.map((w) => w.userId),
      { ...data, issueId },
    );
  },
};
