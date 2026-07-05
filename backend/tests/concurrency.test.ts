import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/db/prisma';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Atomic Job Claiming (SKIP LOCKED)', () => {
  it('concurrent claims never produce duplicate assignments', async () => {
    // Setup: create a project and queue directly in the database
    const org = await prisma.organization.create({
      data: { name: 'Concurrency Test Org', slug: `conc-${Date.now()}` },
    });
    const project = await prisma.project.create({
      data: { orgId: org.id, name: 'conc-project', slug: `conc-project-${Date.now()}`, apiKeyHash: 'n/a' },
    });
    const queue = await prisma.queue.create({
      data: {
        projectId: project.id,
        name: `conc-queue-${Date.now()}`,
        concurrencyLimit: 100,
        maxRetries: 0,
        retryDelayMs: 1000,
      },
    });

    // Create 20 claimable jobs
    const jobCount = 20;
    await prisma.job.createMany({
      data: Array.from({ length: jobCount }, (_, i) => ({
        queueId: queue.id,
        type: 'concurrency.test',
        payload: { index: i },
        status: 'QUEUED' as const,
        maxRetries: 0,
        timeout: 30000,
      })),
    });

    // Simulate 10 concurrent workers trying to claim jobs at the same time
    // Each "worker" runs the same atomic claim query
    const claimJob = async (workerId: string): Promise<string | null> => {
      const result = await prisma.$queryRawUnsafe<{ id: string }[]>(`
        UPDATE "Job"
        SET status = 'CLAIMED', "updatedAt" = NOW()
        WHERE id = (
          SELECT id FROM "Job"
          WHERE "queueId" = '${queue.id}'
            AND status = 'QUEUED'
            AND ("scheduledAt" IS NULL OR "scheduledAt" <= NOW())
          ORDER BY priority DESC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id
      `);
      return result.length > 0 ? result[0].id : null;
    };

    // Run 10 workers, each trying to claim 5 jobs (50 total attempts for 20 jobs)
    const workerCount = 10;
    const attemptsPerWorker = 5;
    const claims: { workerId: string; jobId: string }[] = [];

    const workerPromises = Array.from({ length: workerCount }, async (_, w) => {
      const workerId = `worker-${w}`;
      for (let i = 0; i < attemptsPerWorker; i++) {
        const jobId = await claimJob(workerId);
        if (jobId) {
          claims.push({ workerId, jobId });
        }
      }
    });

    await Promise.all(workerPromises);

    // Verify: every claimed job ID appears exactly once
    const claimedJobIds = claims.map((c) => c.jobId);
    const uniqueIds = new Set(claimedJobIds);
    expect(uniqueIds.size).toBe(claimedJobIds.length);

    // Verify: total claims <= total jobs
    expect(claimedJobIds.length).toBeLessThanOrEqual(jobCount);

    // Verify: all claimed jobs have status CLAIMED in the database
    const claimedJobs = await prisma.job.findMany({
      where: { queueId: queue.id, status: 'CLAIMED' },
    });
    expect(claimedJobs.length).toBe(uniqueIds.size);

    // Verify: no job is still QUEUED if we claimed everything
    const remainingQueued = await prisma.job.count({
      where: { queueId: queue.id, status: 'QUEUED' },
    });
    expect(remainingQueued + claimedJobs.length).toBe(jobCount);
  });

  it('SKIP LOCKED skips already-locked rows without blocking', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Skip Test Org', slug: `skip-${Date.now()}` },
    });
    const project = await prisma.project.create({
      data: { orgId: org.id, name: 'skip-project', slug: `skip-project-${Date.now()}`, apiKeyHash: 'n/a' },
    });
    const queue = await prisma.queue.create({
      data: {
        projectId: project.id,
        name: `skip-queue-${Date.now()}`,
        concurrencyLimit: 100,
        maxRetries: 0,
        retryDelayMs: 1000,
      },
    });

    // Create exactly 1 job
    await prisma.job.create({
      data: {
        queueId: queue.id,
        type: 'skip.test',
        payload: {},
        status: 'QUEUED',
        maxRetries: 0,
        timeout: 30000,
      },
    });

    // Two workers try to claim simultaneously — only one should succeed
    const claim = async (): Promise<string | null> => {
      const result = await prisma.$queryRawUnsafe<{ id: string }[]>(`
        UPDATE "Job"
        SET status = 'CLAIMED', "updatedAt" = NOW()
        WHERE id = (
          SELECT id FROM "Job"
          WHERE "queueId" = '${queue.id}'
            AND status = 'QUEUED'
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id
      `);
      return result.length > 0 ? result[0].id : null;
    };

    const [result1, result2] = await Promise.all([claim(), claim()]);

    // Exactly one succeeds, the other gets null
    const successes = [result1, result2].filter(Boolean);
    expect(successes.length).toBe(1);
  });
});

describe('Dead Letter Queue Routing', () => {
  it('creates DLQ entry when job exceeds max retries', async () => {
    const org = await prisma.organization.create({
      data: { name: 'DLQ Test Org', slug: `dlq-${Date.now()}` },
    });
    const project = await prisma.project.create({
      data: { orgId: org.id, name: 'dlq-project', slug: `dlq-project-${Date.now()}`, apiKeyHash: 'n/a' },
    });
    const queue = await prisma.queue.create({
      data: {
        projectId: project.id,
        name: `dlq-queue-${Date.now()}`,
        concurrencyLimit: 10,
        maxRetries: 3,
        retryDelayMs: 100,
      },
    });

    // Create a job that has exceeded retries
    const job = await prisma.job.create({
      data: {
        queueId: queue.id,
        type: 'dlq.test',
        payload: { data: 'test' },
        status: 'QUEUED',
        maxRetries: 3,
        retryCount: 3,
        timeout: 30000,
      },
    });

    // Simulate what the worker does: check retries exhausted, mark DEAD, create DLQ entry
    const shouldDLQ = job.retryCount >= job.maxRetries;
    expect(shouldDLQ).toBe(true);

    await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: { status: 'DEAD' },
      });
      await tx.deadLetterQueue.create({
        data: {
          jobId: job.id,
          queueId: queue.id,
          reason: 'Max retries exceeded',
          failureCount: job.retryCount,
          originalPayload: job.payload as any,
          lastError: 'Simulated failure',
        },
      });
    });

    // Verify: job is DEAD
    const deadJob = await prisma.job.findUnique({ where: { id: job.id } });
    expect(deadJob?.status).toBe('DEAD');

    // Verify: DLQ entry exists with correct data
    const dlqEntry = await prisma.deadLetterQueue.findFirst({ where: { jobId: job.id } });
    expect(dlqEntry).toBeDefined();
    expect(dlqEntry?.reason).toBe('Max retries exceeded');
    expect(dlqEntry?.failureCount).toBe(3);
  });

  it('DLQ requeue resets job to QUEUED and removes DLQ entry', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Requeue Org', slug: `req-${Date.now()}` },
    });
    const project = await prisma.project.create({
      data: { orgId: org.id, name: 'req-project', slug: `req-project-${Date.now()}`, apiKeyHash: 'n/a' },
    });
    const queue = await prisma.queue.create({
      data: {
        projectId: project.id,
        name: `req-queue-${Date.now()}`,
        concurrencyLimit: 10,
        maxRetries: 3,
        retryDelayMs: 100,
      },
    });

    const job = await prisma.job.create({
      data: {
        queueId: queue.id,
        type: 'requeue.test',
        payload: { important: true },
        status: 'DEAD',
        maxRetries: 3,
        retryCount: 3,
        timeout: 30000,
      },
    });

    await prisma.deadLetterQueue.create({
      data: {
        jobId: job.id,
        queueId: queue.id,
        reason: 'Failure',
        failureCount: 3,
        originalPayload: job.payload as any,
        lastError: 'Error',
      },
    });

    // Requeue: reset job and remove DLQ entry
    await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: { status: 'QUEUED', retryCount: 0, scheduledAt: null },
      });
      await tx.deadLetterQueue.deleteMany({ where: { jobId: job.id } });
    });

    const requeued = await prisma.job.findUnique({ where: { id: job.id } });
    expect(requeued?.status).toBe('QUEUED');
    expect(requeued?.retryCount).toBe(0);

    const dlq = await prisma.deadLetterQueue.findFirst({ where: { jobId: job.id } });
    expect(dlq).toBeNull();
  });
});
