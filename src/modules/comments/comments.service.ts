import { prisma } from '../../config/database';
import { createError } from '../../utils/errors';
import { extractMentions } from '../../utils/mentions';
import { activityService } from '../activity/activity.service';
import { notificationService } from '../notifications/notification.service';
import { broadcastEvent } from '../websocket/events.service';
import { decodeCursor, buildPage } from '../../utils/pagination';

const COMMENT_INCLUDE = {
  author: { select: { id: true, displayName: true, avatarUrl: true } },
  replies: {
    include: {
      author: { select: { id: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

export const commentsService = {
  async create(issueId: string, authorId: string, data: { content: string; parentId?: string }) {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true, issueKey: true, assigneeId: true, reporterId: true },
    });
    if (!issue) throw createError(404, 'Issue not found');

    // Validate parent comment belongs to same issue
    if (data.parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: data.parentId } });
      if (!parent || parent.issueId !== issueId) {
        throw createError(400, 'Parent comment not found on this issue');
      }
    }

    const comment = await prisma.comment.create({
      data: { issueId, authorId, content: data.content, parentId: data.parentId },
      include: COMMENT_INCLUDE,
    });

    // Activity log
    await activityService.log({
      projectId: issue.projectId,
      issueId,
      userId: authorId,
      action: 'commented',
      entityType: 'comment',
      entityId: comment.id,
      metadata: { preview: data.content.slice(0, 100) },
    });

    // Notify watchers
    await notificationService.notifyWatchers(issueId, authorId, {
      type: 'COMMENT_ADDED',
      title: `New comment on ${issue.issueKey}`,
      body: data.content.slice(0, 200),
    });

    // Resolve @mentions → notify mentioned users (by displayName)
    const mentionedNames = extractMentions(data.content);
    if (mentionedNames.length) {
      const mentionedUsers = await prisma.user.findMany({
        where: { displayName: { in: mentionedNames } },
        select: { id: true },
      });
      const mentionIds = mentionedUsers
        .map((u) => u.id)
        .filter((id) => id !== authorId);
      await notificationService.createBulk(mentionIds, {
        type: 'MENTIONED',
        title: `You were mentioned in ${issue.issueKey}`,
        body: data.content.slice(0, 200),
        issueId,
      });
    }

    // Broadcast WS
    await broadcastEvent({
      type: 'comment_added',
      projectId: issue.projectId,
      actorId: authorId,
      timestamp: new Date().toISOString(),
      payload: { issueId, comment },
    });

    return comment;
  },

  async list(issueId: string, opts: { limit?: number; cursor?: string }) {
    const limit = Math.min(opts.limit ?? 25, 100);
    let cursorWhere = {};
    if (opts.cursor) {
      const { createdAt } = decodeCursor(opts.cursor);
      cursorWhere = { createdAt: { gt: createdAt } };
    }

    // Only fetch top-level comments; replies are nested via include
    const items = await prisma.comment.findMany({
      where: { issueId, parentId: null, ...cursorWhere },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      include: COMMENT_INCLUDE,
    });

    return buildPage(items, limit);
  },

  async update(commentId: string, authorId: string, content: string) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw createError(404, 'Comment not found');
    if (comment.authorId !== authorId) throw createError(403, 'Not your comment');

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { content },
      include: COMMENT_INCLUDE,
    });

    await broadcastEvent({
      type: 'comment_updated',
      projectId: '', // resolved below
      actorId: authorId,
      timestamp: new Date().toISOString(),
      payload: { commentId, content },
    });

    return updated;
  },

  async delete(commentId: string, authorId: string) {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { issue: { select: { projectId: true } } },
    });
    if (!comment) throw createError(404, 'Comment not found');
    if (comment.authorId !== authorId) throw createError(403, 'Not your comment');

    await prisma.comment.delete({ where: { id: commentId } });
  },
};
