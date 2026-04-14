/**
 * Seed script — creates two users, one project, workflow, sprint, and several issues.
 * Run: npx ts-node prisma/seed.ts
 */
import 'dotenv/config';
import { PrismaClient, IssueType, Priority } from '@prisma/client';
import bcrypt from 'bcrypt';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redis  = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

async function main() {
  console.log('🌱  Seeding database…');

  // ── Users ─────────────────────────────────────────────────────────────
  const [alice, bob, carol] = await Promise.all([
    upsertUser('akash@gmail.com', 'Akash Agrawal',  'password123'),
    upsertUser('akash1@gmail.com',   'Akash Agrawal',       'password123'),
    upsertUser('akash2@gmail.com', 'Akash Agrawal',    'password123'),
  ]);
  console.log(`  ✓ Users: ${alice.displayName}, ${bob.displayName}, ${carol.displayName}`);

  // ── Project ───────────────────────────────────────────────────────────
  const existingProject = await prisma.project.findUnique({ where: { key: 'DEMO' } });
  if (existingProject) {
    console.log('  ℹ  Project DEMO already exists — skipping seed.');
    return;
  }

  const project = await prisma.project.create({
    data: {
      key: 'DEMO',
      name: 'Demo Project',
      description: 'A seeded demo project for the Jira-Swiggy platform.',
      members: {
        createMany: {
          data: [
            { userId: alice.id, role: 'OWNER'  },
            { userId: bob.id,   role: 'MEMBER' },
            { userId: carol.id, role: 'VIEWER' },
          ],
        },
      },
    },
  });
  console.log(`  ✓ Project: ${project.key} — ${project.name}`);

  // ── Workflow ──────────────────────────────────────────────────────────
  const workflow = await prisma.workflow.create({
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
            { fromStatus: 'To Do',       toStatus: 'In Progress', name: 'Start'           },
            { fromStatus: 'In Progress', toStatus: 'In Review',   name: 'Submit for Review' },
            { fromStatus: 'In Progress', toStatus: 'To Do',       name: 'Reopen'          },
            { fromStatus: 'In Review',   toStatus: 'Done',        name: 'Approve'         },
            { fromStatus: 'In Review',   toStatus: 'In Progress', name: 'Request Changes' },
            { fromStatus: 'Done',        toStatus: 'In Progress', name: 'Reopen'          },
          ],
        },
      },
    },
  });
  console.log(`  ✓ Workflow: ${workflow.name}`);

  // ── Labels ────────────────────────────────────────────────────────────
  const [labelAuth, labelBug, labelPerf] = await Promise.all([
    prisma.label.create({ data: { projectId: project.id, name: 'auth',        color: '#8B5CF6' } }),
    prisma.label.create({ data: { projectId: project.id, name: 'bug',         color: '#EF4444' } }),
    prisma.label.create({ data: { projectId: project.id, name: 'performance', color: '#F59E0B' } }),
  ]);

  // ── Sprint ────────────────────────────────────────────────────────────
  const now   = new Date();
  const start = new Date(now);
  const end   = new Date(now);
  end.setDate(end.getDate() + 14);

  const sprint = await prisma.sprint.create({
    data: {
      projectId: project.id,
      name:      'Sprint 1',
      goal:      'Set up auth, core issue CRUD and board view',
      status:    'ACTIVE',
      startDate: start,
      endDate:   end,
    },
  });
  console.log(`  ✓ Sprint: ${sprint.name}`);

  // ── Seed Redis counter ────────────────────────────────────────────────
  await redis.set(`counter:issues:${project.id}`, '0');

  // ── Issues ────────────────────────────────────────────────────────────
  const issueData: Array<{
    key: string;
    type: IssueType;
    title: string;
    description: string;
    status: string;
    priority: Priority;
    assigneeId: string;
    storyPoints: number;
    sprintId?: string;
    labelIds?: string[];
  }> = [
    {
      key:         'DEMO-1',
      type:        'EPIC',
      title:       'User Authentication System',
      description: 'Implement full OAuth 2.0 + JWT authentication flow.',
      status:      'In Progress',
      priority:    'HIGH',
      assigneeId:  alice.id,
      storyPoints: 13,
    },
    {
      key:         'DEMO-2',
      type:        'STORY',
      title:       'Add OAuth 2.0 login via Google',
      description: 'Allow users to sign in with their Google account.',
      status:      'In Progress',
      priority:    'HIGH',
      assigneeId:  alice.id,
      storyPoints: 5,
      sprintId:    sprint.id,
      labelIds:    [labelAuth.id],
    },
    {
      key:         'DEMO-3',
      type:        'STORY',
      title:       'JWT refresh token rotation',
      description: 'Implement secure refresh token rotation with Redis blacklist.',
      status:      'To Do',
      priority:    'MEDIUM',
      assigneeId:  bob.id,
      storyPoints: 3,
      sprintId:    sprint.id,
      labelIds:    [labelAuth.id],
    },
    {
      key:         'DEMO-4',
      type:        'BUG',
      title:       'Login page crashes on mobile Safari',
      description: 'Reproducible on iOS 17. Stack trace points to a CSS transform issue.',
      status:      'To Do',
      priority:    'HIGH',
      assigneeId:  bob.id,
      storyPoints: 2,
      sprintId:    sprint.id,
      labelIds:    [labelBug.id],
    },
    {
      key:         'DEMO-5',
      type:        'TASK',
      title:       'Set up CI/CD pipeline with GitHub Actions',
      description: 'Configure lint, test, and deploy jobs. Deploy to Railway on merge to main.',
      status:      'In Review',
      priority:    'MEDIUM',
      assigneeId:  carol.id,
      storyPoints: 3,
      sprintId:    sprint.id,
    },
    {
      key:         'DEMO-6',
      type:        'TASK',
      title:       'Optimise database query for board view',
      description: 'Board endpoint is doing N+1 queries. Add eager loading and proper indexes.',
      status:      'Done',
      priority:    'HIGH',
      assigneeId:  alice.id,
      storyPoints: 5,
      sprintId:    sprint.id,
      labelIds:    [labelPerf.id],
    },
    {
      key:         'DEMO-7',
      type:        'STORY',
      title:       'Backlog: Dark mode support',
      description: 'Add a CSS variable–based theme system with a user preference toggle.',
      status:      'To Do',
      priority:    'LOW',
      assigneeId:  bob.id,
      storyPoints: 5,
    },
  ];

  for (const d of issueData) {
    // Increment Redis counter
    await redis.incr(`counter:issues:${project.id}`);
    const { labelIds, ...rest } = d;
    const issue = await prisma.issue.create({
      data: {
        ...rest,
        issueKey:   d.key,
        projectId:  project.id,
        reporterId: alice.id,
        issueLabels: labelIds?.length
          ? { createMany: { data: labelIds.map((id) => ({ labelId: id })) } }
          : undefined,
        watchers: {
          createMany: {
            data: [
              { userId: alice.id },
              ...(d.assigneeId !== alice.id ? [{ userId: d.assigneeId }] : []),
            ],
            skipDuplicates: true,
          },
        },
      },
    });

    // Add a comment to DEMO-2
    if (issue.issueKey === 'DEMO-2') {
      await prisma.comment.create({
        data: {
          issueId:  issue.id,
          authorId: bob.id,
          content:  "I've reviewed the Google OAuth docs. We should use PKCE flow. @Alice Johnson can you confirm the redirect URI?",
        },
      });
      await prisma.comment.create({
        data: {
          issueId:  issue.id,
          authorId: alice.id,
          content:  'Confirmed — use https://api.example.com/auth/google/callback. Updating the spec now.',
        },
      });
    }
  }

  console.log(`  ✓ Issues: ${issueData.length} created`);

  // ── Activity log ──────────────────────────────────────────────────────
  await prisma.activityLog.create({
    data: {
      projectId:  project.id,
      userId:     alice.id,
      action:     'created',
      entityType: 'project',
      entityId:   project.id,
      metadata:   { key: project.key, name: project.name },
    },
  });

  console.log('\n✅  Seed complete!\n');
}

async function upsertUser(email: string, displayName: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: { email, displayName, password: await bcrypt.hash(password, 10) },
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
