import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Zod validation errors
  if (error instanceof ZodError) {
    reply.code(400).send({
      error: 'Validation Error',
      details: error.flatten().fieldErrors,
    });
    return;
  }

  // Fastify schema validation (ajv)
  const fErr = error as FastifyError;
  if (fErr.statusCode === 400 && fErr.validation) {
    reply.code(400).send({ error: 'Bad Request', message: fErr.message });
    return;
  }

  // Known HTTP errors with a statusCode
  if (fErr.statusCode) {
    reply.code(fErr.statusCode).send({ error: error.message });
    return;
  }

  // Unknown errors
  console.error('[Unhandled]', error);
  reply.code(500).send({ error: 'Internal Server Error' });
}
