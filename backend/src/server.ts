import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { prisma } from './db/prisma';
import { redis } from './db/redis';
import { authRoutes } from './routes/auth';
import { projectRoutes } from './routes/projects';
import { queueRoutes } from './routes/queues';
import { jobRoutes } from './routes/jobs';
import { workerRoutes } from './routes/workers';
import { metricsRoutes } from './routes/metrics';
import { dlqRoutes } from './routes/dlq';
import { wsRoutes } from './routes/websocket';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

const app = Fastify({
  logger: false, // using pino directly
  trustProxy: true,
});

async function bootstrap() {
  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'fallback-secret',
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    redis,
  });

  await app.register(websocket);

  // ── Error handler ──────────────────────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ── Health check ───────────────────────────────────────────────────────────
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() };
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(queueRoutes, { prefix: '/api/queues' });
  await app.register(jobRoutes, { prefix: '/api/jobs' });
  await app.register(workerRoutes, { prefix: '/api/workers' });
  await app.register(metricsRoutes, { prefix: '/api/metrics' });
  await app.register(dlqRoutes, { prefix: '/api/dlq' });
  await app.register(wsRoutes, { prefix: '/ws' });

  // ── Start ──────────────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT || '3001');
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`🚀 JobFlow API running on http://localhost:${port}`);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = async () => {
  logger.info('Shutting down API server...');
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});

export { app };
