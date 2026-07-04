/**
 * JobFlow Worker Runner
 *
 * Responsibilities:
 * 1. Register with the API server
 * 2. Poll queues for claimable jobs using SELECT FOR UPDATE SKIP LOCKED
 * 3. Execute jobs concurrently up to concurrency limit
 * 4. Send heartbeats every 10 seconds
 * 5. Handle retries with configurable backoff
 * 6. Move permanently failed jobs to Dead Letter Queue
 * 7. Support graceful shutdown
 */

import { prisma } from '../db/prisma';
import { redis } from '../db/redis';
import { logger } from '../utils/logger';
import { calculateNextRetryDelay } from '../utils/retry';
import { JobStatus, RetryStrategy } from '@prisma/client';
import os from 'os';
import { publishEvent } from '../routes/websocket';

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '1000');
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '10000');
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5');
const WORKER_QUEUE_IDS = process.env.WORKER_QUEUE_IDS?.split(',').filter(Boolean) || [];
const PROJECT_ID = process.env.WORKER_PROJECT_ID || '';

// ── State ─────────────────────────────────────────────────────────────────────
let workerId: string | null = null;
let isShuttingDown = false;
let runningJobs = 0;
const runningJobIds = new Set<string>();

// ── Job handler registry ──────────────────────────────────────────────────────
type JobHandler = (payload: Record<string, any>, context: JobContext) => Promise<any>;

interface JobContext {
  jobId: string;
  executionId: string;
  log: (message: string, metadata?: Record<string, any>) => Promise<void>;
}

const handlers: Record<string, JobHandler> = {};

export function registerHandler(type: string, handler: JobHandler) {
  handlers[type] = handler;
}

// Default demo handlers
registerHandler('echo', async (payload, ctx) => {
  await ctx.log(`Echo: ${JSON.stringify(payload)}`);
  return { echoed: payload };
});

registerHandler('sleep', async (payload, ctx) => {
  const ms = payload.ms || 1000;
  await ctx.log(`Sleeping for ${ms}ms`);
  await new Promise((r) => setTimeout(r, ms));
  return { slept: ms };
});

registerHandler('fail', async () => {
  throw new Error('Intentional test failure');
});

// ── Registration ──────────────────────────────────────────────────────────────
async function registerWorker(): Promise<string> {
  const worker = await prisma.worker.create({
    data: {
      projectId: PROJECT_ID || (await getAnyProjectId()),
      hostname: os.hostname(),
      pid: process.pid,
      queueIds: WORKER_QUEUE_IDS,
      concurrency: CONCURRENCY,
      status: 'IDLE',
      lastHeartbeatAt: new Date(),
    },
  });
  logger.info({ workerId: worker.id }, '✅ Worker registered');
  return worker.id;
}

async function getAnyProjectId(): Promise<string> {
  const project = await prisma.project.findFirst();
  if (!project) throw new Error('No project found. Create a project first.');
  return project.id;
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
async function sendHeartbeat() {
  if (!workerId) return;
  const mem = process.memoryUsage();

  await prisma.$transaction([
    prisma.worker.update({
      where: { id: workerId },
      data: {
        lastHeartbeatAt: new Date(),
        status: isShuttingDown ? 'DRAINING' : runningJobs > 0 ? 'BUSY' : 'IDLE',
      },
    }),
    prisma.workerHeartbeat.create({
      data: {
        workerId: workerId!,
        jobsRunning: runningJobs,
        memoryMb: mem.rss / 1024 / 1024,
        cpuPct: undefined, // would need node-os-utils for this
      },
    }),
  ]);
}

// ── Atomic Job Claiming ───────────────────────────────────────────────────────
async function claimNextJob() {
  if (!workerId) return null;
  if (runningJobs >= CONCURRENCY) return null;
  if (isShuttingDown) return null;

  const now = new Date();

  // Atomic claim using raw SQL with SELECT FOR UPDATE SKIP LOCKED
  const result = await prisma.$queryRawUnsafe<Array<{ id: string; queue_id: string; type: string; payload: any; max_retries: number; retry_count: number; timeout: number; metadata: any }>>(`
    UPDATE jobs SET
      status = 'CLAIMED',
      updated_at = NOW()
    WHERE id = (
      SELECT j.id FROM jobs j
      INNER JOIN queues q ON q.id = j.queue_id
      WHERE j.status IN ('QUEUED')
        AND (j.scheduled_at IS NULL OR j.scheduled_at <= $1)
        AND q.paused = false
        AND q.concurrency_limit > (
          SELECT COUNT(*) FROM jobs
          WHERE queue_id = j.queue_id AND status IN ('CLAIMED', 'RUNNING')
        )
        ${WORKER_QUEUE_IDS.length > 0 ? `AND j.queue_id = ANY(ARRAY[${WORKER_QUEUE_IDS.map((_, i) => `$${i + 2}`).join(',')}]::uuid[])` : ''}
      ORDER BY j.priority DESC, j.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, queue_id, type, payload, max_retries, retry_count, timeout, metadata
  `, now, ...WORKER_QUEUE_IDS);

  return result[0] || null;
}

// ── Job Execution ─────────────────────────────────────────────────────────────
async function executeJob(claimedJob: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>) {
  const jobId = claimedJob.id;
  runningJobs++;
  runningJobIds.add(jobId);

  let executionId: string | null = null;

  try {
    // Mark as RUNNING and create execution record
    await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING' } });
    const execution = await prisma.jobExecution.create({
      data: {
        jobId,
        workerId: workerId!,
        attemptNumber: claimedJob.retry_count + 1,
        status: 'RUNNING',
      },
    });
    executionId = execution.id;

    const queue = await prisma.queue.findFirst({ where: { id: claimedJob.queue_id } });
    const projectId = queue?.projectId;

    // Notify dashboard
    if (projectId) {
      await publishEvent(projectId, 'job:running', { jobId, type: claimedJob.type, workerId });
    }

    // Build context
    const ctx: JobContext = {
      jobId,
      executionId,
      log: async (message, metadata = {}) => {
        await prisma.jobLog.create({
          data: {
            jobId,
            executionId,
            level: 'INFO',
            message,
            metadata,
          },
        });
      },
    };

    // Resolve handler
    const handler = handlers[claimedJob.type] || handlers['echo'];

    // Execute with timeout
    const timeoutMs = claimedJob.timeout || 30000;
    const result = await Promise.race([
      handler(claimedJob.payload as Record<string, any>, ctx),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Job timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    // SUCCESS
    const durationMs = Date.now() - execution.startedAt.getTime();
    await prisma.$transaction([
      prisma.job.update({ where: { id: jobId }, data: { status: 'COMPLETED' } }),
      prisma.jobExecution.update({
        where: { id: executionId },
        data: { status: 'COMPLETED', completedAt: new Date(), durationMs, result: result as any },
      }),
    ]);

    await prisma.jobLog.create({
      data: { jobId, executionId, level: 'INFO', message: `Job completed in ${durationMs}ms` },
    });

    if (projectId) {
      await publishEvent(projectId, 'job:completed', { jobId, durationMs });
    }

    logger.info({ jobId, type: claimedJob.type, durationMs }, '✅ Job completed');
  } catch (err: any) {
    logger.error({ jobId, err: err.message }, '❌ Job failed');

    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { queue: true } });
    if (!job) return;

    const newRetryCount = job.retryCount + 1;
    const shouldRetry = newRetryCount <= job.maxRetries;

    if (executionId) {
      await prisma.jobExecution.update({
        where: { id: executionId },
        data: {
          status: err.message.includes('timed out') ? 'TIMED_OUT' : 'FAILED',
          completedAt: new Date(),
          errorMessage: err.message,
          errorStack: err.stack,
          durationMs: Date.now() - Date.now(),
        },
      });
    }

    if (shouldRetry) {
      const delay = calculateNextRetryDelay(
        job.queue.retryStrategy as RetryStrategy,
        newRetryCount,
        job.queue.retryDelayMs,
        job.queue.retryMaxDelayMs,
        job.queue.retryMultiplier
      );
      const nextRunAt = new Date(Date.now() + delay);

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'SCHEDULED',
          retryCount: newRetryCount,
          scheduledAt: nextRunAt,
        },
      });

      await prisma.jobLog.create({
        data: {
          jobId,
          executionId: executionId || undefined,
          level: 'WARN',
          message: `Job failed (attempt ${newRetryCount}/${job.maxRetries}). Retrying in ${delay}ms`,
          metadata: { error: err.message, nextRunAt: nextRunAt.toISOString() },
        },
      });

      logger.warn({ jobId, attempt: newRetryCount, nextRunAt }, '🔄 Scheduling retry');
    } else {
      // PERMANENT FAILURE → Dead Letter Queue
      await prisma.$transaction([
        prisma.job.update({ where: { id: jobId }, data: { status: 'DEAD', retryCount: newRetryCount } }),
        prisma.deadLetterQueue.upsert({
          where: { jobId },
          update: { reason: err.message, failureCount: newRetryCount, lastError: err.stack },
          create: {
            jobId,
            queueId: job.queueId,
            reason: err.message,
            failureCount: newRetryCount,
            originalPayload: job.payload as any,
            lastError: err.stack,
          },
        }),
      ]);

      await prisma.jobLog.create({
        data: {
          jobId,
          executionId: executionId || undefined,
          level: 'ERROR',
          message: `Job permanently failed after ${newRetryCount} attempts. Moved to Dead Letter Queue.`,
          metadata: { error: err.message },
        },
      });

      logger.error({ jobId, attempts: newRetryCount }, '💀 Job moved to DLQ');

      if (job.queue.projectId) {
        await publishEvent(job.queue.projectId, 'job:dead', { jobId, reason: err.message });
      }
    }
  } finally {
    runningJobs--;
    runningJobIds.delete(jobId);
  }
}

// ── Scheduled Job Promoter ────────────────────────────────────────────────────
async function promoteScheduledJobs() {
  // Move SCHEDULED jobs whose scheduledAt has passed to QUEUED
  const promoted = await prisma.job.updateMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: new Date() },
      cronExpression: null, // cron jobs are handled by scheduler
    },
    data: { status: 'QUEUED', scheduledAt: null },
  });

  if (promoted.count > 0) {
    logger.debug({ count: promoted.count }, '⏰ Promoted scheduled jobs to QUEUED');
  }
}

// ── Main Poll Loop ────────────────────────────────────────────────────────────
async function pollLoop() {
  while (!isShuttingDown) {
    try {
      await promoteScheduledJobs();
      const job = await claimNextJob();
      if (job) {
        // Fire and forget — don't await so we keep polling
        executeJob(job).catch((err) => logger.error(err, 'Unhandled job execution error'));
      }
    } catch (err) {
      logger.error(err, 'Poll loop error');
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ── Entry Point ────────────────────────────────────────────────────────────────
async function main() {
  logger.info({ concurrency: CONCURRENCY, pollInterval: POLL_INTERVAL_MS }, '🚀 Starting worker');

  workerId = await registerWorker();

  // Heartbeat loop
  const heartbeatTimer = setInterval(async () => {
    try { await sendHeartbeat(); } catch (err) { logger.error(err, 'Heartbeat failed'); }
  }, HEARTBEAT_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, '📦 Shutting down worker gracefully...');
    isShuttingDown = true;

    // Wait for running jobs to complete (up to 60s)
    const deadline = Date.now() + 60000;
    while (runningJobs > 0 && Date.now() < deadline) {
      logger.info({ runningJobs }, 'Waiting for jobs to complete...');
      await new Promise((r) => setTimeout(r, 1000));
    }

    clearInterval(heartbeatTimer);

    if (workerId) {
      await prisma.worker.update({ where: { id: workerId }, data: { status: 'OFFLINE' } }).catch(() => {});
    }

    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await pollLoop();
}

main().catch((err) => {
  logger.error(err, 'Worker crashed');
  process.exit(1);
});
