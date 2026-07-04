import { prisma } from '../db/prisma';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

async function seed() {
  console.log('🌱 Seeding database...');

  // Create demo user
  const passwordHash = await bcrypt.hash('password123', 12);
  const user = await prisma.user.upsert({
    where: { email: 'demo@jobflow.dev' },
    update: {},
    create: { email: 'demo@jobflow.dev', passwordHash, name: 'Demo User' },
  });

  // Create organization
  const org = await prisma.organization.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: { name: 'Acme Corp', slug: 'acme-corp' },
  });

  // Create membership
  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: user.id, orgId: org.id } },
    update: {},
    create: { userId: user.id, orgId: org.id, role: 'OWNER' },
  });

  // Create project + API key
  const rawApiKey = `jf_demo_${randomBytes(16).toString('hex')}`;
  const apiKeyHash = await bcrypt.hash(rawApiKey, 10);
  const project = await prisma.project.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'main-project' } },
    update: {},
    create: { orgId: org.id, name: 'Main Project', slug: 'main-project', apiKeyHash },
  });

  // Create queues
  const emailQueue = await prisma.queue.upsert({
    where: { projectId_name: { projectId: project.id, name: 'email-delivery' } },
    update: {},
    create: {
      projectId: project.id,
      name: 'email-delivery',
      description: 'Transactional email sending',
      priority: 10,
      concurrencyLimit: 20,
      retryStrategy: 'EXPONENTIAL',
      maxRetries: 5,
      retryDelayMs: 1000,
    },
  });

  const reportQueue = await prisma.queue.upsert({
    where: { projectId_name: { projectId: project.id, name: 'report-generation' } },
    update: {},
    create: {
      projectId: project.id,
      name: 'report-generation',
      description: 'PDF and CSV report generation',
      priority: 5,
      concurrencyLimit: 3,
      retryStrategy: 'LINEAR',
      maxRetries: 3,
      retryDelayMs: 5000,
    },
  });

  const notifQueue = await prisma.queue.upsert({
    where: { projectId_name: { projectId: project.id, name: 'notifications' } },
    update: {},
    create: {
      projectId: project.id,
      name: 'notifications',
      description: 'Push and in-app notifications',
      priority: 8,
      concurrencyLimit: 50,
      retryStrategy: 'FIXED',
      maxRetries: 2,
      retryDelayMs: 500,
    },
  });

  // Seed some jobs
  const statuses = ['QUEUED', 'COMPLETED', 'FAILED', 'RUNNING', 'DEAD'] as const;
  const jobTypes = ['send-email', 'generate-pdf', 'send-push', 'cleanup', 'sync-data'];
  const queues = [emailQueue, reportQueue, notifQueue];

  for (let i = 0; i < 50; i++) {
    const queue = queues[i % 3];
    const status = statuses[i % statuses.length];
    const job = await prisma.job.create({
      data: {
        queueId: queue.id,
        type: jobTypes[i % jobTypes.length],
        payload: { index: i, user: `user_${i}`, action: 'demo' },
        status,
        priority: Math.floor(Math.random() * 10) - 5,
        retryCount: status === 'FAILED' ? 2 : 0,
        createdAt: new Date(Date.now() - (50 - i) * 60000 * 5),
      },
    });

    if (['COMPLETED', 'FAILED'].includes(status)) {
      await prisma.jobExecution.create({
        data: {
          jobId: job.id,
          workerId: (await prisma.worker.findFirst())?.id || (
            await prisma.worker.create({
              data: {
                projectId: project.id,
                hostname: 'seed-worker',
                pid: 9999,
                queueIds: [],
                status: 'OFFLINE',
              },
            })
          ).id,
          attemptNumber: 1,
          status: status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
          startedAt: new Date(Date.now() - (50 - i) * 60000 * 4),
          completedAt: new Date(Date.now() - (50 - i) * 60000 * 3),
          durationMs: Math.floor(Math.random() * 5000) + 100,
          errorMessage: status === 'FAILED' ? 'Connection refused' : undefined,
        },
      });
    }

    if (status === 'DEAD') {
      await prisma.deadLetterQueue.upsert({
        where: { jobId: job.id },
        update: {},
        create: {
          jobId: job.id,
          queueId: queue.id,
          reason: 'Max retries exceeded',
          failureCount: 5,
          originalPayload: job.payload as any,
          lastError: 'Error: Connection timed out after 30000ms',
        },
      });
    }
  }

  console.log('✅ Seed complete!');
  console.log(`📧 Login: demo@jobflow.dev / password123`);
  console.log(`🔑 API Key: ${rawApiKey}`);
  console.log(`📦 Project ID: ${project.id}`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
