import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authenticate } from '../middleware/auth';

const createQueueSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().max(500).optional(),
  priority: z.number().int().min(-100).max(100).default(0),
  concurrencyLimit: z.number().int().min(1).max(1000).default(10),
  retryStrategy: z.enum(['FIXED', 'LINEAR', 'EXPONENTIAL']).default('EXPONENTIAL'),
  maxRetries: z.number().int().min(0).max(100).default(3),
  retryDelayMs: z.number().int().min(100).default(1000),
  retryMaxDelayMs: z.number().int().min(1000).default(60000),
  retryMultiplier: z.number().min(1).max(10).default(2.0),
  rateLimitPerMin: z.number().int().min(1).optional(),
});

const updateQueueSchema = createQueueSchema.partial().omit({ projectId: true, name: true });

export async function queueRoutes(app: FastifyInstance) {
  // GET /api/queues?projectId=
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { projectId, page = '1', limit = '20' } = request.query as any;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [queues, total] = await Promise.all([
      prisma.queue.findMany({
        where: { projectId },
        include: {
          _count: { select: { jobs: true } },
        },
        skip,
        take: parseInt(limit),
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.queue.count({ where: { projectId } }),
    ]);

    // Enrich with live stats
    const enriched = await Promise.all(
      queues.map(async (q) => {
        const [pending, running, failed, completed] = await Promise.all([
          prisma.job.count({ where: { queueId: q.id, status: 'QUEUED' } }),
          prisma.job.count({ where: { queueId: q.id, status: { in: ['CLAIMED', 'RUNNING'] } } }),
          prisma.job.count({ where: { queueId: q.id, status: 'FAILED' } }),
          prisma.job.count({ where: { queueId: q.id, status: 'COMPLETED' } }),
        ]);
        return { ...q, stats: { pending, running, failed, completed, total: q._count.jobs } };
      })
    );

    return reply.send({ queues: enriched, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  });

  // POST /api/queues
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const body = createQueueSchema.parse(request.body);
    const queue = await prisma.queue.create({ data: body });
    return reply.status(201).send({ queue });
  });

  // GET /api/queues/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const queue = await prisma.queue.findUnique({
      where: { id },
      include: { _count: { select: { jobs: true } } },
    });
    if (!queue) return reply.status(404).send({ error: 'Not Found' });

    const [pending, running, failed, completed, dead] = await Promise.all([
      prisma.job.count({ where: { queueId: id, status: 'QUEUED' } }),
      prisma.job.count({ where: { queueId: id, status: { in: ['CLAIMED', 'RUNNING'] } } }),
      prisma.job.count({ where: { queueId: id, status: 'FAILED' } }),
      prisma.job.count({ where: { queueId: id, status: 'COMPLETED' } }),
      prisma.job.count({ where: { queueId: id, status: 'DEAD' } }),
    ]);

    return reply.send({ queue: { ...queue, stats: { pending, running, failed, completed, dead } } });
  });

  // PATCH /api/queues/:id
  app.patch('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateQueueSchema.parse(request.body);
    const queue = await prisma.queue.update({ where: { id }, data: body });
    return reply.send({ queue });
  });

  // POST /api/queues/:id/pause
  app.post('/:id/pause', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const queue = await prisma.queue.update({ where: { id }, data: { paused: true } });
    return reply.send({ queue, message: 'Queue paused' });
  });

  // POST /api/queues/:id/resume
  app.post('/:id/resume', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const queue = await prisma.queue.update({ where: { id }, data: { paused: false } });
    return reply.send({ queue, message: 'Queue resumed' });
  });

  // DELETE /api/queues/:id
  app.delete('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.queue.delete({ where: { id } });
    return reply.status(204).send();
  });

  // GET /api/queues/:id/stats — detailed time-series stats
  app.get('/:id/stats', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { hours = '24' } = request.query as any;
    const since = new Date(Date.now() - parseInt(hours) * 3600 * 1000);

    const executions = await prisma.jobExecution.findMany({
      where: {
        job: { queueId: id },
        startedAt: { gte: since },
      },
      select: { startedAt: true, completedAt: true, status: true, durationMs: true },
    });

    // Bucket by hour
    const buckets: Record<string, { completed: number; failed: number; avgDuration: number }> = {};
    for (const e of executions) {
      const hour = new Date(e.startedAt).toISOString().slice(0, 13);
      if (!buckets[hour]) buckets[hour] = { completed: 0, failed: 0, avgDuration: 0 };
      if (e.status === 'COMPLETED') {
        buckets[hour].completed++;
        buckets[hour].avgDuration = ((buckets[hour].avgDuration + (e.durationMs || 0)) / 2);
      } else if (e.status === 'FAILED') {
        buckets[hour].failed++;
      }
    }

    return reply.send({
      queueId: id,
      period: { hours: parseInt(hours), from: since.toISOString() },
      timeSeries: Object.entries(buckets).map(([hour, data]) => ({ hour, ...data })),
      totals: {
        completed: executions.filter((e) => e.status === 'COMPLETED').length,
        failed: executions.filter((e) => e.status === 'FAILED').length,
        avgDurationMs: executions.reduce((a, e) => a + (e.durationMs || 0), 0) / (executions.length || 1),
      },
    });
  });
}
