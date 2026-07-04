import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../db/prisma';
import { authenticate } from '../middleware/auth';

const createProjectSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  // GET /api/projects — list projects for user's orgs
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const memberships = await prisma.orgMembership.findMany({
      where: { userId },
      select: { orgId: true },
    });
    const orgIds = memberships.map((m) => m.orgId);

    const projects = await prisma.project.findMany({
      where: { orgId: { in: orgIds } },
      include: {
        org: { select: { name: true, slug: true } },
        _count: { select: { queues: true, workers: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ projects });
  });

  // POST /api/projects — create project
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const body = createProjectSchema.parse(request.body);

    // Verify membership
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: body.orgId } },
    });
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient permissions' });
    }

    // Generate API key
    const rawApiKey = `jf_${randomBytes(32).toString('hex')}`;
    const apiKeyHash = await bcrypt.hash(rawApiKey, 10);
    const slug = body.slug || body.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const project = await prisma.project.create({
      data: { orgId: body.orgId, name: body.name, slug, apiKeyHash },
    });

    return reply.status(201).send({
      project: { id: project.id, name: project.name, slug: project.slug, orgId: project.orgId, createdAt: project.createdAt },
      apiKey: rawApiKey, // shown only once
    });
  });

  // GET /api/projects/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = (request as any).user;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        org: true,
        queues: { include: { _count: { select: { jobs: true } } } },
        workers: { where: { status: { not: 'OFFLINE' } } },
        _count: { select: { queues: true, workers: true } },
      },
    });
    if (!project) return reply.status(404).send({ error: 'Not Found' });

    // Auth check
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (!membership) return reply.status(403).send({ error: 'Forbidden' });

    return reply.send({ project });
  });

  // DELETE /api/projects/:id
  app.delete('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = (request as any).user;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.status(404).send({ error: 'Not Found' });

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (!membership || membership.role !== 'OWNER') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Only owners can delete projects' });
    }

    await prisma.project.delete({ where: { id } });
    return reply.status(204).send();
  });

  // POST /api/projects/:id/rotate-key
  app.post('/:id/rotate-key', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = (request as any).user;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return reply.status(404).send({ error: 'Not Found' });

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const rawApiKey = `jf_${randomBytes(32).toString('hex')}`;
    const apiKeyHash = await bcrypt.hash(rawApiKey, 10);
    await prisma.project.update({ where: { id }, data: { apiKeyHash } });

    return reply.send({ apiKey: rawApiKey });
  });
}
