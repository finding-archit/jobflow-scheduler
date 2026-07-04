/**
 * Cron Scheduler
 *
 * Runs every minute to:
 * 1. Find enabled scheduled jobs whose next_run_at has passed
 * 2. Enqueue a new job instance
 * 3. Update next_run_at for recurring jobs
 * 4. Use distributed lock to prevent duplicate scheduling across workers
 */

import { prisma } from '../db/prisma';
import { redis } from '../db/redis';
import { logger } from '../utils/logger';
import { calculateNextRunAt } from '../utils/retry';
import cron from 'node-cron';

const LOCK_TTL_MS = 55000; // slightly less than 1 minute

async function acquireLock(key: string): Promise<boolean> {
  try {
    const result = await redis.set(key, '1', 'PX', LOCK_TTL_MS, 'NX');
    return result === 'OK';
  } catch {
    // Redis unavailable — allow scheduling (risk: duplicate in multi-worker)
    return true;
  }
}

async function processCronJobs() {
  const lockKey = 'jobflow:scheduler:lock';
  const acquired = await acquireLock(lockKey);
  if (!acquired) {
    logger.debug('Scheduler lock held by another instance, skipping');
    return;
  }

  try {
    const now = new Date();
    const due = await prisma.scheduledJob.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
      },
      include: { job: true },
    });

    logger.debug({ count: due.length }, 'Processing due cron jobs');

    for (const scheduled of due) {
      try {
        // Calculate next run time
        const nextRunAt = calculateNextRunAt(scheduled.cronExpr);

        // Create a new job instance (clone the template job)
        await prisma.$transaction(async (tx) => {
          const newJob = await tx.job.create({
            data: {
              queueId: scheduled.job.queueId,
              type: scheduled.job.type,
              payload: scheduled.job.payload as any,
              status: 'QUEUED',
              priority: scheduled.job.priority,
              maxRetries: scheduled.job.maxRetries,
              timeout: scheduled.job.timeout,
              metadata: scheduled.job.metadata as any,
              cronExpression: scheduled.cronExpr,
            },
          });

          await tx.scheduledJob.update({
            where: { id: scheduled.id },
            data: {
              nextRunAt,
              lastRunAt: now,
              runCount: { increment: 1 },
            },
          });

          await tx.jobLog.create({
            data: {
              jobId: newJob.id,
              level: 'INFO',
              message: `Cron job enqueued by scheduler (run #${scheduled.runCount + 1})`,
              metadata: { cronExpr: scheduled.cronExpr, nextRunAt: nextRunAt.toISOString() },
            },
          });

          logger.info({ scheduledJobId: scheduled.id, newJobId: newJob.id, nextRunAt }, '⏰ Cron job enqueued');
        });
      } catch (err) {
        logger.error({ scheduledJobId: scheduled.id, err }, 'Failed to process cron job');
      }
    }
  } finally {
    // Lock expires automatically
  }
}

async function main() {
  logger.info('🕐 Starting Cron Scheduler');

  // Run every minute at :00 seconds
  cron.schedule('* * * * *', async () => {
    try {
      await processCronJobs();
    } catch (err) {
      logger.error(err, 'Scheduler error');
    }
  });

  // Also run immediately on startup
  await processCronJobs();

  logger.info('✅ Cron scheduler running');
}

process.on('SIGTERM', async () => {
  logger.info('Scheduler shutting down');
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
});

main().catch((err) => {
  logger.error(err, 'Scheduler crashed');
  process.exit(1);
});
