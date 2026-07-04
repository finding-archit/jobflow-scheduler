import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authenticate } from '../middleware/auth';
import { calculateNextRunAt, isValidCron } from '../utils/retry';

const createJobSchema = z.object({
  queueId: z.string().uuid(),
  type: z.string().min(1).max(100),
  payload: z.record(z.any()).default({}),
  priority: z.number().int().min(-100).max(100).default(0),
  delayMs: z.number().int().min(0).optional(),
  scheduledAt: z.string().datetime().optional(),
  cronExpression: z.string().optional(),
  maxRetries: z.number().int().min(0).max(100).optional(),
  timeout: z.number().int().min(1000).max(3600000).default(30000),
  idempotencyKey: z.string().max(255).optional(),
  metadata: z.record(z.any()).default({}),
  // Workflow
  dependsOn: z.array(z.string().uuid()).optional(),
  // Batch
  batchId: z.string().optional(),
  parentJobId: z.string().uuid().optional(),
});

const createBatchSchema = z.object({
  queueId: z.string().uuid(),
  jobs: z.array(createJobSchema.omit({ queueId: true })).min(1).max(1000),
  batchName: z.string().optional(),
});

export async function jobRoutes(app: FastifyInstance) {
  // POST /api/jobs — create job (immediate, delayed, scheduled, cron)
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const body = createJobSchema.parse(request.body);

    // Validate cron
    if (body.cronExpression && !isValidCron(body.cronExpression)) {
      return reply.status(400).send({ error: 'Invalid cron expression' });
    }

    // Determine initial status and scheduledAt
    let status: 'QUEUED' | 'SCHEDULED' = 'QUEUED';
    let scheduledAt: Date | undefined = undefined;

    if (body.cronExpression) {
      status = 'SCHEDULED';
      scheduledAt = calculateNextRunAt(body.cronExpression);
    } else if (body.scheduledAt) {
      status = 'SCHEDULED';
      scheduledAt = new Date(body.scheduledAt);
    } else if (body.delayMs && body.delayMs > 0) {
      status = 'SCHEDULED';
      scheduledAt = new Date(Date.now() + body.delayMs);
    }

    const queue = await prisma.queue.findUnique({ where: { id: body.queueId } });
    if (!queue) return reply.status(404).send({ error: 'Queue not found' });
    if (queue.paused) return reply.status(409).send({ error: 'Queue is paused' });

    const job = await prisma.$transaction(async (tx) => {
      const newJob = await tx.job.create({
        data: {
          queueId: body.queueId,
          type: body.type,
          payload: body.payload,
          status,
          priority: body.priority,
          scheduledAt,
          cronExpression: body.cronExpression,
          maxRetries: body.maxRetries ?? queue.maxRetries,
          timeout: body.timeout,
          idempotencyKey: body.idempotencyKey,
          metadata: body.metadata,
          batchId: body.batchId,
          parentJobId: body.parentJobId,
        },
      });

      // Create scheduled job entry for cron
      if (body.cronExpression && scheduledAt) {
        await tx.scheduledJob.create({
          data: {
            jobId: newJob.id,
            cronExpr: body.cronExpression,
            nextRunAt: scheduledAt,
          },
        });
      }

      // Create workflow dependencies
      if (body.dependsOn && body.dependsOn.length > 0) {
        await tx.workflowDep.createMany({
          data: body.dependsOn.map((depId) => ({ jobId: newJob.id, dependsOnId: depId })),
        });
      }

      await tx.jobLog.create({
        data: {
          jobId: newJob.id,
          level: 'INFO',
          message: `Job created with status ${status}`,
          metadata: { type: body.type, priority: body.priority },
        },
      });

      return newJob;
    });

    return reply.status(201).send({ job });
  });

  // POST /api/jobs/batch — create batch of jobs
  app.post('/batch', { preHandler: [authenticate] }, async (request, reply) => {
    const body = createBatchSchema.parse(request.body);
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const queue = await prisma.queue.findUnique({ where: { id: body.queueId } });
    if (!queue) return reply.status(404).send({ error: 'Queue not found' });

    const jobs = await prisma.$transaction(async (tx) => {
      return Promise.all(
        body.jobs.map((j) =>
          tx.job.create({
            data: {
              queueId: body.queueId,
              type: j.type,
              payload: j.payload || {},
              status: j.delayMs ? 'SCHEDULED' : 'QUEUED',
              priority: j.priority || 0,
              scheduledAt: j.delayMs ? new Date(Date.now() + j.delayMs) : undefined,
              maxRetries: j.maxRetries ?? queue.maxRetries,
              timeout: j.timeout || 30000,
              idempotencyKey: j.idempotencyKey,
              metadata: j.metadata || {},
              batchId,
            },
          })
        )
      );
    });

    return reply.status(201).send({ batchId, count: jobs.length, jobs: jobs.map((j) => j.id) });
  });

  // GET /api/jobs — list & filter
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const {
      queueId,
      status,
      type,
      batchId,
      page = '1',
      limit = '20',
      sortBy = 'createdAt',
      sortOrder = 'desc',
      from,
      to,
    } = request.query as any;

    const where: any = {};
    if (queueId) where.queueId = queueId;
    if (status) where.status = { in: status.split(',') };
    if (type) where.type = type;
    if (batchId) where.batchId = batchId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          queue: { select: { name: true, projectId: true } },
          _count: { select: { executions: true, logs: true } },
        },
        skip,
        take: Math.min(parseInt(limit), 100),
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.job.count({ where }),
    ]);

    return reply.send({
      jobs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  });

  // GET /api/jobs/:id — job detail with full execution history
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        queue: true,
        executions: {
          include: { worker: { select: { hostname: true, pid: true } } },
          orderBy: { startedAt: 'desc' },
        },
        logs: { orderBy: { timestamp: 'desc' }, take: 100 },
        dlqEntry: true,
        dependsOn: { include: { dependsOn: { select: { id: true, type: true, status: true } } } },
        dependencies: { include: { job: { select: { id: true, type: true, status: true } } } },
      },
    });
    if (!job) return reply.status(404).send({ error: 'Not Found' });
    return reply.send({ job });
  });

  // POST /api/jobs/:id/cancel
  app.post('/:id/cancel', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return reply.status(404).send({ error: 'Not Found' });
    if (!['QUEUED', 'SCHEDULED'].includes(job.status)) {
      return reply.status(409).send({ error: 'Cannot cancel a job that is already running or completed' });
    }
    const updated = await prisma.job.update({ where: { id }, data: { status: 'CANCELLED' } });
    await prisma.jobLog.create({
      data: { jobId: id, level: 'INFO', message: 'Job cancelled by user' },
    });
    return reply.send({ job: updated });
  });

  // POST /api/jobs/:id/retry — manually retry a failed/dead job
  app.post('/:id/retry', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return reply.status(404).send({ error: 'Not Found' });
    if (!['FAILED', 'DEAD', 'CANCELLED'].includes(job.status)) {
      return reply.status(409).send({ error: 'Only failed, dead, or cancelled jobs can be retried' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const j = await tx.job.update({
        where: { id },
        data: { status: 'QUEUED', retryCount: 0, scheduledAt: null },
      });
      // Remove from DLQ if present
      await tx.deadLetterQueue.deleteMany({ where: { jobId: id } });
      await tx.jobLog.create({
        data: { jobId: id, level: 'INFO', message: 'Job manually re-queued for retry' },
      });
      return j;
    });

    return reply.send({ job: updated });
  });

  // GET /api/jobs/:id/logs
  app.get('/:id/logs', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit = '200', level } = request.query as any;

    const where: any = { jobId: id };
    if (level) where.level = level;

    const logs = await prisma.jobLog.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      take: parseInt(limit),
    });
    return reply.send({ logs });
  });
}
