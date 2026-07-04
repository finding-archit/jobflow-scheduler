import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authenticate } from '../middleware/auth';

const registerWorkerSchema = z.object({
  projectId: z.string().uuid(),
  hostname: z.string(),
  pid: z.number().int(),
  queueIds: z.array(z.string().uuid()),
  concurrency: z.number().int().min(1).max(100).default(5),
});

const heartbeatSchema = z.object({
  jobsRunning: z.number().int().min(0),
  memoryMb: z.number().optional(),
  cpuPct: z.number().min(0).max(100).optional(),
  status: z.enum(['IDLE', 'BUSY', 'DRAINING']).optional(),
});

export async function workerRoutes(app: FastifyInstance) {
  // POST /api/workers/register
  app.post('/register', { preHandler: [authenticate] }, async (request, reply) => {
    const body = registerWorkerSchema.parse(request.body);
    const worker = await prisma.worker.create({
      data: {
        projectId: body.projectId,
        hostname: body.hostname,
        pid: body.pid,
        queueIds: body.queueIds,
        concurrency: body.concurrency,
        status: 'IDLE',
        lastHeartbeatAt: new Date(),
      },
    });
    return reply.status(201).send({ worker });
  });

  // POST /api/workers/:id/heartbeat
  app.post('/:id/heartbeat', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = heartbeatSchema.parse(request.body);

    const [worker] = await prisma.$transaction([
      prisma.worker.update({
        where: { id },
        data: {
          lastHeartbeatAt: new Date(),
          status: body.status || (body.jobsRunning > 0 ? 'BUSY' : 'IDLE'),
        },
      }),
      prisma.workerHeartbeat.create({
        data: {
          workerId: id,
          jobsRunning: body.jobsRunning,
          memoryMb: body.memoryMb,
          cpuPct: body.cpuPct,
        },
      }),
    ]);

    return reply.send({ worker });
  });

  // GET /api/workers?projectId=
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { projectId, status } = request.query as any;
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    // Mark workers as offline if no heartbeat in 30s
    await prisma.worker.updateMany({
      where: {
        lastHeartbeatAt: { lt: new Date(Date.now() - 30000) },
        status: { not: 'OFFLINE' },
      },
      data: { status: 'OFFLINE' },
    });

    const workers = await prisma.worker.findMany({
      where,
      include: {
        heartbeats: { orderBy: { timestamp: 'desc' }, take: 1 },
        _count: { select: { executions: true } },
      },
      orderBy: { lastHeartbeatAt: 'desc' },
    });

    return reply.send({ workers });
  });

  // GET /api/workers/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const worker = await prisma.worker.findUnique({
      where: { id },
      include: {
        heartbeats: { orderBy: { timestamp: 'desc' }, take: 20 },
        executions: {
          where: { status: 'RUNNING' },
          include: { job: { select: { id: true, type: true, queueId: true } } },
        },
      },
    });
    if (!worker) return reply.status(404).send({ error: 'Not Found' });
    return reply.send({ worker });
  });

  // POST /api/workers/:id/deregister
  app.post('/:id/deregister', async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.worker.update({ where: { id }, data: { status: 'OFFLINE' } });
    return reply.send({ message: 'Worker deregistered' });
  });
}
