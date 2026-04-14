# Jira-Swiggy — Project Management Platform

A production-grade Jira-like backend built for the SDE-1 take-home assignment.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Database Schema (ERD)](#database-schema-erd)
4. [Setup Instructions](#setup-instructions)
5. [API Reference](#api-reference)
6. [Key Design Decisions & Trade-offs](#key-design-decisions--trade-offs)
7. [Scenario Walkthroughs](#scenario-walkthroughs)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                         Clients                              │
│         REST (HTTP/JSON)          WebSocket (Socket.io)      │
└────────────────┬──────────────────────────┬─────────────────-┘
                 │                          │
        ┌────────▼──────────────────────────▼────────┐
        │              Fastify HTTP Server            │
        │    JWT Auth │ Rate Limit │ CORS │ Swagger   │
        ├────────────────────────────────────────────┤
        │  Modules                                   │
        │  auth │ projects │ issues │ sprints         │
        │  comments │ search │ notifications          │
        │  workflow engine │ activity log             │
        └────────────────┬───────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
   │  PostgreSQL  │ │  Redis   │ │ Socket.io  │
   │  (Prisma)   │ │pub/sub + │ │ WS Rooms   │
   │             │ │streams + │ │ Presence   │
   │  Main store │ │counters  │ │ Replay     │
   └─────────────┘ └──────────┘ └────────────┘
```

**Request flow for an issue transition:**

1. `PATCH /api/issues/:id/transitions` → authenticate JWT
2. `WorkflowService.validateTransition` — checks allowed transitions (→ 422 if violated)
3. `WorkflowService.validateGuards` — checks required fields, assignee presence, etc.
4. `WorkflowService` runs `actions` (e.g., auto-set a field)
5. Prisma updates issue (version++) inside a transaction
6. `ActivityLog` records the diff
7. `NotificationService` fans out to all watchers
8. `broadcastEvent` pushes to Socket.io room + Redis stream (for replay)

---

## Tech Stack

| Layer          | Choice                   | Why                                                   |
|----------------|--------------------------|-------------------------------------------------------|
| Runtime        | Node.js 20 + TypeScript  | Type safety, large ecosystem, native async I/O        |
| Framework      | Fastify 4                | 2× Express throughput, schema-first, plugin ecosystem |
| ORM            | Prisma 5                 | Type-safe queries, migrations, great DX               |
| Database       | PostgreSQL 16            | ACID, JSONB for custom fields, full-text search       |
| Cache / PubSub | Redis 7                  | Atomic counters, event streams, presence TTLs         |
| WebSocket      | Socket.io 4              | Room-based multicast, fallback polling, reconnect     |
| Validation     | Zod                      | Runtime + compile-time schema safety                  |
| Auth           | JWT (HS256)              | Stateless, fits horizontally scaled deployments       |
| Containerise   | Docker + Compose         | One-command local dev                                 |

---

## Database Schema (ERD)

```
users ──────────────────────────────────────────────────────────────────┐
  id, email, password, displayName, avatarUrl                           │
  │                                                                     │
  ├── project_members (userId, projectId, role)                         │
  │       │                                                             │
  │   projects ────────────────────────────────────────────────────┐    │
  │     id, key, name, description                                 │    │
  │     │                                                          │    │
  │     ├── workflows                                              │    │
  │     │     ├── workflow_statuses  (name, color, position …)     │    │
  │     │     └── workflow_transition`s (fromStatus → toStatus,     │    │
  │     │                               guards JSON, actions JSON) │    │
  │     │                                                          │    │
  │     ├── sprints (name, goal, status, startDate, endDate)       │    │
  │     │     └── issues ──────────────────────────────────────────┼────┘
  │     │           id, issueKey, type, title, description,        │
  │     │           status, priority, storyPoints, version,        │
  │     │           assigneeId, reporterId, sprintId, parentId     │
  │     │           │                                              │
  │     │           ├── comments (content, parentId for threading) │
  │     │           ├── activity_logs (action, changes JSON)       │
  │     │           ├── issue_watchers                             │
  │     │           ├── issue_labels ── labels                     │
  │     │           └── custom_field_values ── custom_fields       │
  │     │                                                          │
  │     ├── labels                                                 │
  │     ├── custom_fields (TEXT/NUMBER/DROPDOWN/DATE)              │
  │     └── activity_logs                                          │
  │                                                                │
  ├── notifications (type, title, isRead)                          │
  └── presences (entityType, entityId, socketId, lastSeen) ────────┘
```

**Key schema decisions:**

- **`version` column on `issues`** — integer monotonically incremented on every write; clients include it in PATCH requests for optimistic locking. Conflict → 409.
- **`issueKey` as a unique human-readable identifier** — `PROJ-123`; generated via a Redis INCR so it is gap-free and collision-free under concurrency.
- **`status` stored as a plain string** — references `WorkflowStatus.name` within the project's workflow. This avoids a FK join on every query and makes renaming statuses a single-table update.
- **`customFields` as a separate table with JSONB `options`** — supports TEXT / NUMBER / DROPDOWN / DATE per project without schema migrations.
- **`parentId` self-reference on `issues`** — models the Epic → Story → Sub-task hierarchy with a single recursive FK.

---

## Setup Instructions

### Option A — Docker Compose (recommended)

```bash
cp .env.example .env
# Edit JWT_SECRET
docker compose up --build
```

Migrations and seed data run automatically on first boot.

API: `http://localhost:3000`  
Swagger UI: `http://localhost:3000/docs`

### Option B — Local (Node + Postgres + Redis)

```bash
# Prerequisites: Node 20, PostgreSQL 16, Redis 7

cp .env.example .env
# Edit DATABASE_URL and REDIS_URL

npm install
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev
```

### Seed credentials

| Email               | Password    | Role in DEMO project |
|---------------------|-------------|----------------------|
| akash@gmail.com   | password123 | Owner                |
| akash1@gmail.com      | password123 | Member               |
| akash2@gmail.com    | password123 | Viewer               |

---

## API Reference

Full interactive docs at **`/docs`** (Swagger UI).

### Authentication

```
POST /api/auth/register    { email, password, displayName }
POST /api/auth/login       { email, password }  → { user, token }
GET  /api/auth/me
```

All other endpoints require `Authorization: Bearer <token>`.

### Projects

```
POST   /api/projects                        Create project
GET    /api/projects                        List my projects
GET    /api/projects/:id                    Get project
PATCH  /api/projects/:id                    Update project
GET    /api/projects/:id/board?sprintId=    Board state (columns + issues)
GET    /api/projects/:id/activity           Paginated activity feed
POST   /api/projects/:id/members            Add member
DELETE /api/projects/:id/members/:userId    Remove member
GET    /api/projects/:id/custom-fields      List custom fields
POST   /api/projects/:id/custom-fields      Create custom field
GET    /api/projects/:id/labels             List labels
POST   /api/projects/:id/labels             Create label
```

### Workflow

```
GET    /api/projects/:id/workflow                              Get workflow
POST   /api/projects/:id/workflow/statuses                     Add status column
PATCH  /api/projects/:id/workflow/statuses/:statusId           Update status
POST   /api/projects/:id/workflow/transitions                  Add transition rule
DELETE /api/projects/:id/workflow/transitions/:transitionId    Remove transition
```

### Issues

```
POST   /api/projects/:id/issues          Create issue
GET    /api/issues/:id                   Get issue (full)
GET    /api/issues/by-key/:issueKey      Get by key e.g. DEMO-4
PATCH  /api/issues/:id                   Update fields (optimistic lock via version)
POST   /api/issues/:id/transitions       Transition status → 422 if not allowed
DELETE /api/issues/:id                   Delete issue
POST   /api/issues/:id/watch             Watch issue
DELETE /api/issues/:id/watch             Unwatch issue
PATCH  /api/issues/:id/custom-fields     Set custom field value
```

### Sprints

```
GET    /api/projects/:id/sprints           List sprints
POST   /api/projects/:id/sprints           Create sprint
GET    /api/sprints/:id                    Get sprint with issues
PATCH  /api/sprints/:id                    Update sprint
POST   /api/sprints/:id/start              Start sprint
POST   /api/sprints/:id/complete           Complete sprint (carry-over support)
GET    /api/projects/:id/sprints/velocity  Sprint velocity history
POST   /api/sprints/move-issues            Move issues between sprints / backlog
```

**Complete sprint body:**
```json
{
  "carryOverIssueIds": ["clx1...", "clx2..."],
  "targetSprintId": "clx3..."  // omit → backlog
}
```

### Comments

```
GET    /api/issues/:id/comments       List threaded comments (paginated)
POST   /api/issues/:id/comments       Add comment (supports parentId for replies)
PATCH  /api/comments/:id              Edit own comment
DELETE /api/comments/:id              Delete own comment
```

### Search

```
GET /api/search?q=oauth&filter=status='In Progress' AND priority=HIGH&projectId=...&limit=25&cursor=...
```

| Param      | Description                                                      |
|------------|------------------------------------------------------------------|
| `q`        | Free-text (title, description, comments)                         |
| `filter`   | Structured: `key=value AND key=value` (AND only)                 |
| `projectId`| Scope to one project                                             |
| `limit`    | Page size, max 100                                               |
| `cursor`   | Opaque cursor from previous response for keyset pagination       |

Supported filter keys: `status`, `assignee`, `reporter`, `type`, `priority`, `sprint`, `label`, `project`.

### Notifications

```
GET   /api/notifications                Get notifications (cursor paginated)
GET   /api/notifications/unread-count   Unread badge count
PATCH /api/notifications/read           Mark read { ids?: [...] } — omit ids to mark all
```

---

## WebSocket Events

Connect: `ws://localhost:3000` with `?token=<jwt>` or `auth: { token }`.

### Client → Server

| Event        | Payload                                    | Effect                                   |
|--------------|--------------------------------------------|------------------------------------------|
| `join_board` | `{ projectId, lastEventId? }`              | Join project room; replays missed events |
| `join_issue` | `{ issueId }`                              | Join issue room for presence tracking    |

### Server → Client

| Event               | Payload                                        |
|---------------------|------------------------------------------------|
| `issue_created`     | Full issue object                              |
| `issue_updated`     | `{ issue, changes }` diff                      |
| `issue_moved`       | `{ issueId, fromStatus, toStatus, issue }`     |
| `issue_deleted`     | `{ issueId, issueKey }`                        |
| `comment_added`     | `{ issueId, comment }`                         |
| `comment_updated`   | `{ commentId, content }`                       |
| `sprint_created`    | Sprint object                                  |
| `sprint_updated`    | Sprint object                                  |
| `sprint_started`    | Sprint object                                  |
| `sprint_completed`  | `{ sprintId, velocity, completedIssues, … }`   |
| `presence_updated`  | `{ entityType, entityId, users[] }`            |
| `missed_events`     | Array of events since `lastEventId`            |

Missed-event replay uses **Redis Streams** (`XRANGE`). Events are capped at 500 per project with `MAXLEN ~`.

---

## Key Design Decisions & Trade-offs

### 1. Optimistic Locking for Concurrent Updates (Scenario 1)

Each `Issue` row has a `version` integer. Every write does `version: { increment: 1 }`. Clients that want conflict detection pass the `version` they last read; if the DB version has moved on, the API returns **409 Conflict** with a clear message. Clients that don't pass `version` get last-write-wins semantics — both are valid depending on the use-case (e.g., a bot script vs. a human editing a form).

**Trade-off:** True serialisable isolation would require `SELECT … FOR UPDATE` on every read. That serialises concurrent edits entirely. Optimistic locking is better for throughput because conflicts are rare; we only pay on actual contention.

### 2. Workflow Engine as Data, Not Code

Statuses and transition rules live in the `workflow_statuses` / `workflow_transitions` tables. Guards and actions are stored as JSON arrays. This means teams can reconfigure their workflow without a deployment. The engine evaluates rules at runtime.

**Trade-off:** Complex guard logic (e.g., "assignee must be from team X") would require a custom evaluator. For now, three guard types cover the spec: `required_field`, `has_assignee`, `min_story_points`.

### 3. Issue Keys via Redis INCR

`DEMO-123` keys are generated with `INCR` on a Redis key per project. This is O(1), atomic, and produces gap-free sequences even under concurrent issue creation — no DB sequence lock contention.

**Trade-off:** If Redis is cold (restart without persistence), the counter is re-seeded from the DB max. This is handled in `seedIssueCounter`.

### 4. Full-Text Search via PostgreSQL

Rather than adding Elasticsearch, we use PostgreSQL `ILIKE` + sub-query on comments. This keeps the stack simple and is sufficient for hundreds of thousands of issues.

**Trade-off:** For millions of issues with complex relevance ranking, a dedicated search engine (Elasticsearch / Typesense) would be needed. Migration path: add a `tsvector` generated column and `GIN` index, then switch to `@@` operator queries.

### 5. WebSocket Scaling with Redis Streams

Each broadcast event is written to a Redis Stream (`XADD … MAXLEN ~ 500`). On reconnect, clients send their last-seen stream ID; the server does `XRANGE` and replays any missed events. For multi-instance deployments, add `socket.io-redis` adapter backed by the same Redis pub/sub channel.

### 6. Cursor-Based Pagination (Keyset)

All list endpoints use opaque `base64url` cursors encoding `updatedAt|id`. This is stable under inserts/updates (unlike OFFSET which shifts rows), and scales to billions of rows because it uses the indexed columns directly.

### 7. Sprint Velocity

Calculated at completion time from story points of issues in a "Done" workflow status. Stored in the activity log's `metadata` field so historical velocity is immutable even if issues are later edited.

---

## Scenario Walkthroughs

### Scenario 1 — Concurrent Updates

```
User A: PATCH /api/issues/clx1  { assigneeId: "u2", version: 5 }
User B: PATCH /api/issues/clx1  { priority: "HIGH", version: 5 }

→ One request wins (version bumped to 6).
→ The other gets 409 { error: "Conflict: issue was updated by someone else…" }
→ Client B re-fetches, gets version 6, resubmits → both changes land.
→ Both clients receive issue_updated via WebSocket.
```

### Scenario 2 — Sprint Completion with Carry-Over

```
POST /api/sprints/sprint10/complete
{
  "carryOverIssueIds": ["clx2", "clx3"],
  "targetSprintId": "sprint11"
}

Response:
{
  "velocity": 13,           ← story points of completed issues
  "completedIssues": [...], ← issues that reached a Done status
  "incompleteIssues": [...],← all remaining incomplete items
  "carriedOver": ["clx2","clx3"]
}
```

`clx2`, `clx3` → moved to Sprint 11. Remaining incomplete → backlog (`sprintId = null`). Audit trail recorded in `activity_logs`.

### Scenario 3 — Workflow Violation

```
POST /api/issues/clx4/transitions
{ "toStatus": "Done" }    ← issue is currently "To Do"

HTTP 422 Unprocessable Entity
{
  "error": "Transition from \"To Do\" to \"Done\" is not allowed.
            Allowed transitions: In Progress"
}
```
