import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { authRoutes } from '../src/routes/auth';
import { projectRoutes } from '../src/routes/projects';
import { queueRoutes } from '../src/routes/queues';
import { jobRoutes } from '../src/routes/jobs';
import { workerRoutes } from '../src/routes/workers';
import { dlqRoutes } from '../src/routes/dlq';
import { metricsRoutes } from '../src/routes/metrics';
import { errorHandler } from '../src/middleware/errorHandler';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors);
  await app.register(jwt, { secret: 'test-secret-minimum-32-characters!' });
  await app.register(websocket);
  app.setErrorHandler(errorHandler);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(queueRoutes, { prefix: '/api/queues' });
  await app.register(jobRoutes, { prefix: '/api/jobs' });
  await app.register(workerRoutes, { prefix: '/api/workers' });
  await app.register(dlqRoutes, { prefix: '/api/dlq' });
  await app.register(metricsRoutes, { prefix: '/api/metrics' });

  await app.ready();
  return app;
}

export async function registerAndLogin(app: FastifyInstance) {
  const email = `test-${Date.now()}@jobflow.dev`;
  const registerRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Test User',
      email,
      password: 'password123',
      orgName: 'Test Org',
    },
  });
  const { token, organization } = JSON.parse(registerRes.body);
  return { token, orgId: organization.id, email };
}

export async function createProject(app: FastifyInstance, token: string, orgId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { authorization: `Bearer ${token}` },
    payload: { orgId, name: 'test-project', slug: `test-project-${Date.now()}` },
  });
  return JSON.parse(res.body);
}

export async function createQueue(app: FastifyInstance, token: string, projectId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/queues',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      projectId,
      name: `test-queue-${Date.now()}`,
      concurrencyLimit: 5,
      retryStrategy: 'EXPONENTIAL',
      maxRetries: 3,
      retryDelayMs: 1000,
    },
  });
  return JSON.parse(res.body);
}
