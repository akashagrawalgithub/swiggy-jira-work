import { Prisma, Priority, IssueType } from '@prisma/client';
import { prisma } from '../../config/database';
import { createError } from '../../utils/errors';

export interface SearchQuery {
  q?: string;              // free-text across title, description, comments
  projectId?: string;
  status?: string;
  assignee?: string;       // user id or display name
  reporter?: string;
  type?: IssueType;
  priority?: Priority;
  sprintId?: string;
  label?: string;
  parentId?: string;
  dueBefore?: string;
  dueAfter?: string;
  limit?: number;
  cursor?: string;         // last issueId seen for keyset pagination
}

export const searchService = {
  async search(query: SearchQuery, requestingUserId: string) {
    const limit = Math.min(query.limit ?? 25, 100);

    // ── Resolve project scope ─────────────────────────────────────────────
    // User can only see issues in projects they belong to
    const memberProjects = await prisma.projectMember.findMany({
      where: { userId: requestingUserId },
      select: { projectId: true },
    });
    const allowedProjectIds = memberProjects.map((m) => m.projectId);

    if (!allowedProjectIds.length) return { data: [], nextCursor: null, hasMore: false };

    if (query.projectId && !allowedProjectIds.includes(query.projectId)) {
      throw createError(403, 'Not a member of that project');
    }

    const projectScope = query.projectId
      ? [query.projectId]
      : allowedProjectIds;

    // ── Build structured filters ──────────────────────────────────────────
    const where: Prisma.IssueWhereInput = {
      projectId: { in: projectScope },
    };

    if (query.status)   where.status   = query.status;
    if (query.type)     where.type     = query.type;
    if (query.priority) where.priority = query.priority;
    if (query.sprintId) where.sprintId = query.sprintId;
    if (query.parentId) where.parentId = query.parentId;

    if (query.assignee) {
      // Support userId or partial display name
      where.OR = [
        { assigneeId: query.assignee },
        { assignee: { displayName: { contains: query.assignee, mode: 'insensitive' } } },
      ];
    }

    if (query.reporter) {
      where.reporter = {
        OR: [
          { id: query.reporter },
          { displayName: { contains: query.reporter, mode: 'insensitive' } },
        ],
      };
    }

    if (query.label) {
      where.issueLabels = {
        some: {
          label: { name: { contains: query.label, mode: 'insensitive' } },
        },
      };
    }

    if (query.dueBefore || query.dueAfter) {
      where.dueDate = {
        ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
        ...(query.dueAfter  ? { gte: new Date(query.dueAfter)  } : {}),
      };
    }

    // ── Full-text search ──────────────────────────────────────────────────
    // PostgreSQL full-text: search title + description.
    // We also search comments via a sub-query.
    if (query.q) {
      const terms = query.q.trim();
      where.OR = [
        { title:       { contains: terms, mode: 'insensitive' } },
        { description: { contains: terms, mode: 'insensitive' } },
        {
          comments: {
            some: { content: { contains: terms, mode: 'insensitive' } },
          },
        },
      ];
    }

    // ── Cursor-based keyset pagination ────────────────────────────────────
    if (query.cursor) {
      // cursor is the last seen issue's updatedAt:id pair encoded as base64
      try {
        const raw = Buffer.from(query.cursor, 'base64url').toString('utf8');
        const [updatedAtStr, id] = raw.split('|');
        where.AND = [
          {
            OR: [
              { updatedAt: { lt: new Date(updatedAtStr) } },
              { updatedAt: new Date(updatedAtStr), id: { gt: id } },
            ],
          },
        ];
      } catch {
        throw createError(400, 'Invalid cursor');
      }
    }

    const issues = await prisma.issue.findMany({
      where,
      take: limit + 1,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      include: {
        assignee: { select: { id: true, displayName: true, avatarUrl: true } },
        reporter: { select: { id: true, displayName: true, avatarUrl: true } },
        sprint:   { select: { id: true, name: true } },
        project:  { select: { id: true, key: true, name: true } },
        issueLabels: { include: { label: { select: { id: true, name: true, color: true } } } },
        _count: { select: { comments: true, children: true } },
      },
    });

    const hasMore = issues.length > limit;
    const data = hasMore ? issues.slice(0, limit) : issues;

    const last = data[data.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(`${last.updatedAt.toISOString()}|${last.id}`).toString('base64url')
      : null;

    return { data, nextCursor, hasMore, total: data.length };
  },

  /**
   * Parse a structured query string into SearchQuery fields.
   * Supports: status='In Progress' AND assignee='john' AND priority>=HIGH
   * Returns merged object so it can be combined with free-text.
   */
  parseStructuredQuery(raw: string): Partial<SearchQuery> {
    const result: Partial<SearchQuery> = {};
    // Tokenise key=value and key>=value pairs
    const tokens = raw.match(/(\w+)\s*(?:=|>=|<=|>|<)\s*'?([^'AND]+?)'?(?=\s+AND|\s*$)/gi) ?? [];

    for (const token of tokens) {
      const m = token.match(/^(\w+)\s*(=|>=|<=|>|<)\s*'?(.+?)'?\s*$/i);
      if (!m) continue;
      const [, key, , value] = m;
      const k = key.toLowerCase();

      if (k === 'status')   result.status   = value.trim();
      if (k === 'assignee') result.assignee = value.trim();
      if (k === 'reporter') result.reporter = value.trim();
      if (k === 'type')     result.type     = value.trim().toUpperCase() as IssueType;
      if (k === 'priority') result.priority = value.trim().toUpperCase() as Priority;
      if (k === 'sprint')   result.sprintId = value.trim();
      if (k === 'label')    result.label    = value.trim();
      if (k === 'project')  result.projectId = value.trim();
    }

    return result;
  },
};
