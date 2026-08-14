import dotenv from 'dotenv';
import Fastify from 'fastify';

dotenv.config();

const server = Fastify({
  logger: true,
});

server.get('/health', async (_request, _reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';
    await server.listen({ port, host });
    console.log(`Server running on http://${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
