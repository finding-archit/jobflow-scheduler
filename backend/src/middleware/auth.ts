import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
  }
}

export async function authenticateApiKey(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'] as string;
  if (!apiKey) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'API key required' });
  }

  const bcrypt = require('bcryptjs');
  // Find matching project by hashing
  const projects = await prisma.project.findMany({ select: { id: true, orgId: true, apiKeyHash: true } });
  for (const project of projects) {
    if (await bcrypt.compare(apiKey, project.apiKeyHash)) {
      (request as any).projectId = project.id;
      (request as any).orgId = project.orgId;
      return;
    }
  }

  return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid API key' });
}

export async function requireOrgRole(roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user as { userId: string };
    const orgId = (request.params as any).orgId || (request.body as any)?.orgId;
    if (!orgId) return;

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: user.userId, orgId } },
    });

    if (!membership || !roles.includes(membership.role)) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient permissions' });
    }
  };
}
