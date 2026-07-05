import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp, registerAndLogin, createProject, createQueue } from './helpers';
import { prisma } from '../src/db/prisma';

let app: FastifyInstance;
let token: string;
let orgId: string;
let projectId: string;
let queueId: string;

beforeAll(async () => {
  app = await buildApp();
  const auth = await registerAndLogin(app);
  token = auth.token;
  orgId = auth.orgId;

  const proj = await createProject(app, token, orgId);
  projectId = proj.project.id;

  const q = await createQueue(app, token, projectId);
  queueId = q.queue.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

function authHeader() {
  return { authorization: `Bearer ${token}` };
}

// ── Auth Routes ───────────────────────────────────────────────────────────────

describe('Auth API', () => {
  it('POST /api/auth/register creates user and returns JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'New User',
        email: `new-${Date.now()}@test.com`,
        password: 'password123',
        orgName: 'New Org',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
    expect(body.user.email).toContain('@test.com');
    expect(body.organization.name).toBe('New Org');
  });

  it('POST /api/auth/register rejects duplicate email', async () => {
    const email = `dup-${Date.now()}@test.com`;
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'A', email, password: 'password123', orgName: 'Org' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'B', email, password: 'password123', orgName: 'Org2' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /api/auth/login returns JWT on valid credentials', async () => {
    const email = `login-${Date.now()}@test.com`;
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Login User', email, password: 'password123', orgName: 'Org' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
    expect(body.organizations).toBeInstanceOf(Array);
  });

  it('POST /api/auth/login rejects invalid password', async () => {
    const email = `bad-${Date.now()}@test.com`;
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'User', email, password: 'password123', orgName: 'Org' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'wrongpassword' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/me requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/me returns user profile with valid JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.email).toBeDefined();
    expect(body.organizations).toBeInstanceOf(Array);
  });
});

// ── Queue Routes ──────────────────────────────────────────────────────────────

describe('Queue API', () => {
  it('POST /api/queues creates a queue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/queues',
      headers: authHeader(),
      payload: {
        projectId,
        name: `q-${Date.now()}`,
        concurrencyLimit: 10,
        retryStrategy: 'FIXED',
        maxRetries: 5,
        retryDelayMs: 2000,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.queue.id).toBeDefined();
    expect(body.queue.retryStrategy).toBe('FIXED');
    expect(body.queue.maxRetries).toBe(5);
  });

  it('POST /api/queues rejects invalid queue name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/queues',
      headers: authHeader(),
      payload: {
        projectId,
        name: 'invalid name with spaces!',
        concurrencyLimit: 10,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/queues lists queues with live stats', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/queues?projectId=${projectId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.queues).toBeInstanceOf(Array);
    expect(body.queues.length).toBeGreaterThanOrEqual(1);
    expect(body.queues[0].stats).toBeDefined();
  });

  it('POST /api/queues/:id/pause pauses a queue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/queues/${queueId}/pause`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.queue.paused).toBe(true);
  });

  it('POST /api/queues/:id/resume resumes a paused queue', async () => {
    await app.inject({ method: 'POST', url: `/api/queues/${queueId}/pause`, headers: authHeader() });
    const res = await app.inject({
      method: 'POST',
      url: `/api/queues/${queueId}/resume`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.queue.paused).toBe(false);
  });
});

// ── Job Routes ────────────────────────────────────────────────────────────────

describe('Job API', () => {
  it('POST /api/jobs creates an immediate job with status QUEUED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: authHeader(),
      payload: {
        queueId,
        type: 'email.send',
        payload: { to: 'user@test.com', subject: 'Hello' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.job.status).toBe('QUEUED');
    expect(body.job.queueId).toBe(queueId);
  });

  it('POST /api/jobs creates a delayed job with status SCHEDULED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: authHeader(),
      payload: {
        queueId,
        type: 'report.generate',
        payload: { reportId: '123' },
        delayMs: 60000,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.job.status).toBe('SCHEDULED');
    expect(body.job.scheduledAt).toBeDefined();
  });

  it('POST /api/jobs creates a cron job with scheduled_jobs entry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: authHeader(),
      payload: {
        queueId,
        type: 'cleanup.daily',
        payload: { daysOld: 30 },
        cronExpression: '0 3 * * *',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.job.status).toBe('SCHEDULED');
    expect(body.job.cronExpression).toBe('0 3 * * *');
  });

  it('POST /api/jobs rejects invalid cron expression', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: authHeader(),
      payload: {
        queueId,
        type: 'bad-cron',
        payload: {},
        cronExpression: 'not-a-cron',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/jobs rejects job on paused queue', async () => {
    await app.inject({ method: 'POST', url: `/api/queues/${queueId}/pause`, headers: authHeader() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: authHeader(),
      payload: { queueId, type: 'test', payload: {} },
    });
    expect(res.statusCode).toBe(409);
    // Resume for subsequent tests
    await app.inject({ method: 'POST', url: `/api/queues/${queueId}/resume`, headers: authHeader() });
  });

  it('POST /api/jobs/batch creates multiple jobs atomically', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs/batch',
      headers: authHeader(),
      payload: {
        queueId,
        jobs: [
          { type: 'batch.item', payload: { index: 0 } },
          { type: 'batch.item', payload: { index: 1 } },
          { type: 'batch.item', payload: { index: 2 } },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.count).toBe(3);
    expect(body.batchId).toBeDefined();
    expect(body.jobs).toHaveLength(3);
  });

  it('GET /api/jobs lists jobs with pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/jobs?queueId=${queueId}&limit=5`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobs).toBeInstanceOf(Array);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/jobs filters by status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/jobs?queueId=${queueId}&status=QUEUED`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    for (const job of body.jobs) {
      expect(job.status).toBe('QUEUED');
    }
  });

  it('GET /api/jobs/:id returns full job detail', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: authHeader(),
      payload: { queueId, type: 'detail.test', payload: { key: 'value' } },
    });
    const jobId = JSON.parse(createRes.body).job.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/jobs/${jobId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.job.id).toBe(jobId);
    expect(body.job.executions).toBeInstanceOf(Array);
    expect(body.job.logs).toBeInstanceOf(Array);
  });

  it('POST /api/jobs/:id/cancel cancels a queued job', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: authHeader(),
      payload: { queueId, type: 'cancel.test', payload: {} },
    });
    const jobId = JSON.parse(createRes.body).job.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.job.status).toBe('CANCELLED');
  });

  it('POST /api/jobs/:id/cancel rejects cancelling a completed job', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: authHeader(),
      payload: { queueId, type: 'no-cancel', payload: {} },
    });
    const jobId = JSON.parse(createRes.body).job.id;
    // Force status to COMPLETED
    await prisma.job.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /api/jobs/:id/retry re-queues a failed job', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: authHeader(),
      payload: { queueId, type: 'retry.test', payload: {} },
    });
    const jobId = JSON.parse(createRes.body).job.id;
    // Force status to FAILED
    await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED', retryCount: 2 } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/retry`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.job.status).toBe('QUEUED');
    expect(body.job.retryCount).toBe(0);
  });
});

// ── Validation & Error Handling ───────────────────────────────────────────────

describe('Input Validation', () => {
  it('rejects missing required fields with 400 and field details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.details).toBeInstanceOf(Array);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it('rejects invalid email format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Test', email: 'not-an-email', password: 'password123', orgName: 'Org' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects password shorter than 8 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Test', email: 'short@test.com', password: '123', orgName: 'Org' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Health Check ──────────────────────────────────────────────────────────────

describe('Health Check', () => {
  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });
});
