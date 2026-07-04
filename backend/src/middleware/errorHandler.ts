import { FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export async function errorHandler(
  error: FastifyError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  logger.error({ err: error, url: request.url, method: request.method }, 'Request error');

  // Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      statusCode: 400,
      error: 'Validation Error',
      message: 'Request validation failed',
      details: error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Fastify errors (e.g., 404, 405)
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      error: error.name,
      message: error.message,
    });
  }

  // JWT errors
  if (error.message?.includes('jwt') || error.message?.includes('token')) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }

  // Prisma unique constraint
  if ((error as any).code === 'P2002') {
    return reply.status(409).send({
      statusCode: 409,
      error: 'Conflict',
      message: 'Resource already exists',
    });
  }

  // Prisma not found
  if ((error as any).code === 'P2025') {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'Resource not found',
    });
  }

  // Generic server error
  return reply.status(500).send({
    statusCode: 500,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message,
  });
}
