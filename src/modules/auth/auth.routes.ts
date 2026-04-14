import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authService } from './auth.service';
import { authenticate } from '../../middleware/authenticate';
import { JwtPayload } from '../../types';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/register
  fastify.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const user = await authService.register(body);
    const token = fastify.jwt.sign(
      { userId: user.id, email: user.email } satisfies JwtPayload,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' },
    );
    reply.code(201).send({ user, token });
  });

  // POST /api/auth/login
  fastify.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await authService.login(body);
    const token = fastify.jwt.sign(
      { userId: user.id, email: user.email } satisfies JwtPayload,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' },
    );
    reply.send({ user, token });
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const me = await authService.me(user.userId);
    reply.send(me);
  });
}
