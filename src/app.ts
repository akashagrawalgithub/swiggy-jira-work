import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import staticFiles from '@fastify/static';

import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';

import { authRoutes }         from './modules/auth/auth.routes';
import { projectRoutes }      from './modules/projects/projects.routes';
import { issueRoutes }        from './modules/issues/issues.routes';
import { sprintRoutes }       from './modules/sprints/sprints.routes';
import { commentRoutes }      from './modules/comments/comments.routes';
import { searchRoutes }       from './modules/search/search.routes';
import { notificationRoutes } from './modules/notifications/notification.routes';
import { workflowRoutes }     from './modules/workflow/workflow.routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.isDev
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : true,
    trustProxy: true,
  });

  // ── CORS ───────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'Too Many Requests',
      message: 'Slow down — you are being rate-limited',
    }),
  });

  // ── JWT ────────────────────────────────────────────────────────────────────
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  // ── Swagger / OpenAPI ──────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Jira-Swiggy API',
        description: 'Project Management Platform — SDE-1 Take-Home',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  // ── Error handler ──────────────────────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ── Static UI ──────────────────────────────────────────────────────────────
  await app.register(staticFiles, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
    decorateReply: false,
  });

  // ── Health check ───────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // ── API Routes ─────────────────────────────────────────────────────────────
  await app.register(authRoutes,         { prefix: '/api/auth' });
  await app.register(projectRoutes,      { prefix: '/api/projects' });
  await app.register(issueRoutes,        { prefix: '/api' });
  await app.register(sprintRoutes,       { prefix: '/api' });
  await app.register(commentRoutes,      { prefix: '/api' });
  await app.register(searchRoutes,       { prefix: '/api/search' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(workflowRoutes,     { prefix: '/api/projects' });

  return app;
}
