import { FastifyRequest } from 'fastify';

export interface JwtPayload {
  userId: string;
  email: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: JwtPayload;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

// ─── WebSocket Events ─────────────────────────────────────────────────────────

export type WsEventType =
  | 'issue_created'
  | 'issue_updated'
  | 'issue_moved'
  | 'issue_deleted'
  | 'comment_added'
  | 'comment_updated'
  | 'sprint_created'
  | 'sprint_updated'
  | 'sprint_started'
  | 'sprint_completed'
  | 'presence_joined'
  | 'presence_left';

export interface WsEvent {
  type: WsEventType;
  projectId: string;
  payload: unknown;
  actorId: string;
  timestamp: string;
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export interface WorkflowGuard {
  type: 'required_field' | 'min_story_points' | 'has_assignee';
  field?: string;
  value?: number;
  message?: string;
}

export interface WorkflowAction {
  type: 'set_field' | 'notify_assignee' | 'notify_reporter';
  field?: string;
  value?: unknown;
}

// ─── Activity ─────────────────────────────────────────────────────────────────

export type FieldChange = {
  from: unknown;
  to: unknown;
};

export type ChangeDiff = Record<string, FieldChange>;
