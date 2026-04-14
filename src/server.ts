import 'dotenv/config';
import { buildApp } from './app';
import { env } from './config/env';
import { redis, redisSub } from './config/redis';
import { prisma } from './config/database';
import { setupSocketServer } from './modules/websocket/socket.server';
import { runSeed } from './seed';

async function main() {
  // ── Connect infrastructure ─────────────────────────────────────────────
  await redis.connect();
  await redisSub.connect();
  await prisma.$connect();

  // ── Auto-seed on first boot ────────────────────────────────────────────
  try {
    const userCount = await prisma.user.count();
    if (userCount === 0) await runSeed(prisma);
  } catch (e) {
    console.warn('Seed skipped:', (e as Error).message);
  }

  // ── Build Fastify app ──────────────────────────────────────────────────
  const app = await buildApp();
  await app.ready();

  // ── Attach Socket.io to Fastify's underlying HTTP server ───────────────
  setupSocketServer(app.server);

  // ── Start listening ────────────────────────────────────────────────────
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  console.log(`\n🚀  Server listening on http://0.0.0.0:${env.PORT}`);
  console.log(`🗂   Board UI         → http://localhost:${env.PORT}/`);
  console.log(`📖  Swagger UI        → http://localhost:${env.PORT}/docs`);
  console.log(`❤️   Health check      → http://localhost:${env.PORT}/health\n`);

  // ── Graceful shutdown ──────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down…`);
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    redisSub.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
