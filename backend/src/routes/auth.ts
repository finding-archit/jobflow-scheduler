import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/prisma';
import { authenticate } from '../middleware/auth';

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  orgName: z.string().min(2).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/register
  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.status(409).send({ error: 'Conflict', message: 'Email already registered' });

    const passwordHash = await bcrypt.hash(body.password, 12);

    const slug = body.orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: body.email, passwordHash, name: body.name },
      });
      const org = await tx.organization.create({
        data: { name: body.orgName, slug },
      });
      await tx.orgMembership.create({
        data: { userId: user.id, orgId: org.id, role: 'OWNER' },
      });
      return { user, org };
    });

    const token = app.jwt.sign({ userId: result.user.id, email: result.user.email });

    return reply.status(201).send({
      token,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      organization: { id: result.org.id, name: result.org.name, slug: result.org.slug },
    });
  });

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid credentials' });

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid credentials' });

    const token = app.jwt.sign({ userId: user.id, email: user.email });

    // Load orgs
    const memberships = await prisma.orgMembership.findMany({
      where: { userId: user.id },
      include: { org: true },
    });

    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      organizations: memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
      })),
    });
  });

  // GET /api/auth/me
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = (request as any).user;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { org: { include: { projects: true } } } },
      },
    });
    if (!user) return reply.status(404).send({ error: 'Not Found' });

    return reply.send({
      id: user.id,
      email: user.email,
      name: user.name,
      organizations: user.memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
        projects: m.org.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
      })),
    });
  });
}
