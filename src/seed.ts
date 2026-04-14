import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { env } from './config/env';

export async function runSeed(prisma: PrismaClient) {
  console.log('🌱  Seeding demo data…');

  const redis = new Redis(env.REDIS_URL, { lazyConnect: true });
  await redis.connect();

  // ── Users ────────────────────────────────────────────────────────────
  async function upsertUser(email: string, displayName: string, password: string) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return existing;
    return prisma.user.create({
      data: { email, displayName, password: await bcrypt.hash(password, 10) },
    });
  }

  const akash = await upsertUser('akash242018@gmail.com', 'Akash Agrawal',  '123456789');
  const akash1   = await upsertUser('akash1@gmail.com',    'Akash Agrawal',  '123456789');
  const akash2 = await upsertUser('akash2@gmail.com',    'Akash Agrawal',  '123456789');

  // ── Project ──────────────────────────────────────────────────────────
  const existing = await prisma.project.findUnique({ where: { key: 'DEMO' } });
  if (existing) { await redis.disconnect(); console.log('  ℹ  Seed already applied — skipping.'); return; }

  const project = await prisma.project.create({
    data: {
      key: 'DEMO', name: 'Demo Project',
      description: 'A seeded demo project for the Jira platform.',
      members: {
        createMany: {
          data: [
            { userId: akash.id, role: 'OWNER'  },
            { userId: akash1.id,   role: 'MEMBER' },
            { userId: akash2.id, role: 'VIEWER' },
          ],
        },
      },
    },
  });

  // ── Workflow ─────────────────────────────────────────────────────────
  await prisma.workflow.create({
    data: {
      projectId: project.id,
      name: 'Default Software Workflow',
      statuses: {
        createMany: {
          data: [
            { name: 'To Do',       color: '#6B7280', category: 'TODO',        position: 0, isInitial: true,  isDone: false },
            { name: 'In Progress', color: '#3B82F6', category: 'IN_PROGRESS', position: 1, isInitial: false, isDone: false },
            { name: 'In Review',   color: '#F59E0B', category: 'IN_PROGRESS', position: 2, isInitial: false, isDone: false },
            { name: 'Done',        color: '#10B981', category: 'DONE',        position: 3, isInitial: false, isDone: true  },
          ],
        },
      },
      transitions: {
        createMany: {
          data: [
            { fromStatus: 'To Do',       toStatus: 'In Progress', name: 'Start'             },
            { fromStatus: 'In Progress', toStatus: 'In Review',   name: 'Submit for Review' },
            { fromStatus: 'In Progress', toStatus: 'To Do',       name: 'Reopen'            },
            { fromStatus: 'In Review',   toStatus: 'Done',        name: 'Approve'           },
            { fromStatus: 'In Review',   toStatus: 'In Progress', name: 'Request Changes'   },
            { fromStatus: 'Done',        toStatus: 'In Progress', name: 'Reopen'            },
          ],
        },
      },
    },
  });

  // ── Labels ───────────────────────────────────────────────────────────
  const [labelAuth, labelBug, labelPerf] = await Promise.all([
    prisma.label.create({ data: { projectId: project.id, name: 'auth',        color: '#8B5CF6' } }),
    prisma.label.create({ data: { projectId: project.id, name: 'bug',         color: '#EF4444' } }),
    prisma.label.create({ data: { projectId: project.id, name: 'performance', color: '#F59E0B' } }),
  ]);

  // ── Sprint ────────────────────────────────────────────────────────────
  const now = new Date();
  const end = new Date(now); end.setDate(end.getDate() + 14);
  const sprint = await prisma.sprint.create({
    data: {
      projectId: project.id, name: 'Sprint 1',
      goal: 'Set up auth, core CRUD and board view',
      status: 'ACTIVE', startDate: now, endDate: end,
    },
  });

  // Seed Redis counter
  await redis.set(`counter:issues:${project.id}`, '0');

  // ── Issues ────────────────────────────────────────────────────────────
  const issues = [
    { key: 'DEMO-1', type: 'EPIC'  as const, title: 'User Authentication System',          status: 'In Progress', priority: 'HIGH'   as const, assigneeId: akash.id, sp: 13, labels: [labelAuth.id] },
    { key: 'DEMO-2', type: 'STORY' as const, title: 'Add OAuth 2.0 login via Google',      status: 'In Progress', priority: 'HIGH'   as const, assigneeId: akash.id, sp: 5,  labels: [labelAuth.id], sprintId: sprint.id },
    { key: 'DEMO-3', type: 'STORY' as const, title: 'JWT refresh token rotation',          status: 'To Do',       priority: 'MEDIUM' as const, assigneeId: akash1.id,   sp: 3,  labels: [labelAuth.id], sprintId: sprint.id },
    { key: 'DEMO-4', type: 'BUG'   as const, title: 'Login page crashes on mobile Safari', status: 'To Do',       priority: 'HIGH'   as const, assigneeId: akash1.id,   sp: 2,  labels: [labelBug.id],  sprintId: sprint.id },
    { key: 'DEMO-5', type: 'TASK'  as const, title: 'Set up CI/CD with GitHub Actions',    status: 'In Review',   priority: 'MEDIUM' as const, assigneeId: akash2.id, sp: 3,  labels: [],             sprintId: sprint.id },
    { key: 'DEMO-6', type: 'TASK'  as const, title: 'Optimise board view DB queries',      status: 'Done',        priority: 'HIGH'   as const, assigneeId: akash.id, sp: 5,  labels: [labelPerf.id], sprintId: sprint.id },
    { key: 'DEMO-7', type: 'STORY' as const, title: 'Dark mode support',                  status: 'To Do',       priority: 'LOW'    as const, assigneeId: akash1.id,   sp: 5,  labels: [] },
  ];

  for (const d of issues) {
    await redis.incr(`counter:issues:${project.id}`);
    const issue = await prisma.issue.create({
      data: {
        issueKey: d.key, projectId: project.id, reporterId: akash.id,
        type: d.type, title: d.title, status: d.status,
        priority: d.priority, storyPoints: d.sp,
        sprintId: d.sprintId ?? null, assigneeId: d.assigneeId,
        issueLabels: d.labels.length ? { createMany: { data: d.labels.map(id => ({ labelId: id })) } } : undefined,
        watchers: { createMany: { data: [{ userId: akash.id }, ...(d.assigneeId !== akash.id ? [{ userId: d.assigneeId }] : [])], skipDuplicates: true } },
      },
    });
    if (issue.issueKey === 'DEMO-2') {
      await prisma.comment.create({ data: { issueId: issue.id, authorId: akash1.id, content: "We should use PKCE flow. @Alice Johnson can you confirm the redirect URI?" } });
      await prisma.comment.create({ data: { issueId: issue.id, authorId: akash.id, content: 'Confirmed — use /auth/google/callback. Updating the spec now.' } });
    }
  }

  await redis.disconnect();
  console.log('✅  Seed complete! \n');
}
