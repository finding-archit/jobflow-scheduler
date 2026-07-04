import { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { authenticate } from '../middleware/auth';

export async function dlqRoutes(app: FastifyInstance) {
  // GET /api/dlq?queueId=&projectId=
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { queueId, projectId, resolved, page = '1', limit = '20' } = request.query as any;

    const where: any = {};
    if (queueId) where.queueId = queueId;
    if (resolved === 'true') where.resolvedAt = { not: null };
    else if (resolved === 'false') where.resolvedAt = null;
    if (projectId) where.job = { queue: { projectId } };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [entries, total] = await Promise.all([
      prisma.deadLetterQueue.findMany({
        where,
        include: {
          job: { include: { queue: { select: { name: true, projectId: true } } } },
        },
        skip,
        take: parseInt(limit),
        orderBy: { failedAt: 'desc' },
      }),
      prisma.deadLetterQueue.count({ where }),
    ]);

    return reply.send({ entries, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  });

  // POST /api/dlq/:id/resolve — mark as resolved
  app.post('/:id/resolve', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await prisma.deadLetterQueue.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
    return reply.send({ entry });
  });

  // POST /api/dlq/:id/requeue — put job back in queue
  app.post('/:id/requeue', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await prisma.deadLetterQueue.findUnique({
      where: { id },
      include: { job: true },
    });
    if (!entry) return reply.status(404).send({ error: 'Not Found' });

    await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: entry.jobId },
        data: { status: 'QUEUED', retryCount: 0 },
      });
      await tx.deadLetterQueue.update({
        where: { id },
        data: { resolvedAt: new Date() },
      });
      await tx.jobLog.create({
        data: { jobId: entry.jobId, level: 'INFO', message: 'Job requeued from Dead Letter Queue' },
      });
    });

    return reply.send({ message: 'Job requeued successfully' });
  });
}
