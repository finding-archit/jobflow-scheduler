import { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { authenticate } from '../middleware/auth';

export async function metricsRoutes(app: FastifyInstance) {
  // GET /api/metrics?projectId=&hours=24
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { projectId, hours = '24' } = request.query as any;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const since = new Date(Date.now() - parseInt(hours) * 3600 * 1000);

    const queues = await prisma.queue.findMany({ where: { projectId }, select: { id: true, name: true } });
    const queueIds = queues.map((q) => q.id);

    const [
      totalJobs,
      completedJobs,
      failedJobs,
      runningJobs,
      queuedJobs,
      deadJobs,
      workers,
      executions,
    ] = await Promise.all([
      prisma.job.count({ where: { queueId: { in: queueIds } } }),
      prisma.job.count({ where: { queueId: { in: queueIds }, status: 'COMPLETED' } }),
      prisma.job.count({ where: { queueId: { in: queueIds }, status: 'FAILED' } }),
      prisma.job.count({ where: { queueId: { in: queueIds }, status: { in: ['CLAIMED', 'RUNNING'] } } }),
      prisma.job.count({ where: { queueId: { in: queueIds }, status: 'QUEUED' } }),
      prisma.job.count({ where: { queueId: { in: queueIds }, status: 'DEAD' } }),
      prisma.worker.count({ where: { projectId, status: { not: 'OFFLINE' } } }),
      prisma.jobExecution.findMany({
        where: {
          job: { queueId: { in: queueIds } },
          startedAt: { gte: since },
        },
        select: { startedAt: true, status: true, durationMs: true },
      }),
    ]);

    // Time-series throughput (bucket by hour)
    const throughput: Record<string, { completed: number; failed: number; timestamp: string }> = {};
    for (const e of executions) {
      const hour = new Date(e.startedAt);
      hour.setMinutes(0, 0, 0);
      const key = hour.toISOString();
      if (!throughput[key]) throughput[key] = { completed: 0, failed: 0, timestamp: key };
      if (e.status === 'COMPLETED') throughput[key].completed++;
      else if (e.status === 'FAILED') throughput[key].failed++;
    }

    const successRate = completedJobs + failedJobs > 0
      ? (completedJobs / (completedJobs + failedJobs)) * 100
      : 100;

    const avgDurationMs = executions.length > 0
      ? executions.reduce((a, e) => a + (e.durationMs || 0), 0) / executions.length
      : 0;

    // Per-queue breakdown
    const queueBreakdown = await Promise.all(
      queues.map(async (q) => {
        const [pending, running, completed, failed] = await Promise.all([
          prisma.job.count({ where: { queueId: q.id, status: 'QUEUED' } }),
          prisma.job.count({ where: { queueId: q.id, status: { in: ['CLAIMED', 'RUNNING'] } } }),
          prisma.job.count({ where: { queueId: q.id, status: 'COMPLETED', updatedAt: { gte: since } } }),
          prisma.job.count({ where: { queueId: q.id, status: 'FAILED', updatedAt: { gte: since } } }),
        ]);
        return { queueId: q.id, queueName: q.name, pending, running, completed, failed };
      })
    );

    return reply.send({
      summary: {
        totalJobs,
        completedJobs,
        failedJobs,
        runningJobs,
        queuedJobs,
        deadJobs,
        activeWorkers: workers,
        successRate: Math.round(successRate * 100) / 100,
        avgDurationMs: Math.round(avgDurationMs),
      },
      throughput: Object.values(throughput).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      queueBreakdown,
      period: { hours: parseInt(hours), from: since.toISOString() },
    });
  });

  // GET /api/metrics/system — system-wide health
  app.get('/system', { preHandler: [authenticate] }, async (request, reply) => {
    const { projectId } = request.query as any;
    const staleThreshold = new Date(Date.now() - 30000);

    const [totalWorkers, activeWorkers, offlineWorkers, recentDlq] = await Promise.all([
      prisma.worker.count({ where: projectId ? { projectId } : {} }),
      prisma.worker.count({ where: { ...(projectId ? { projectId } : {}), status: { not: 'OFFLINE' }, lastHeartbeatAt: { gte: staleThreshold } } }),
      prisma.worker.count({ where: { ...(projectId ? { projectId } : {}), status: 'OFFLINE' } }),
      prisma.deadLetterQueue.count({
        where: {
          ...(projectId ? { job: { queue: { projectId } } } : {}),
          resolvedAt: null,
        },
      }),
    ]);

    return reply.send({
      workers: { total: totalWorkers, active: activeWorkers, offline: offlineWorkers },
      deadLetterQueue: { unresolved: recentDlq },
      serverTime: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
}
