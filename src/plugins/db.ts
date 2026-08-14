import fp from 'fastify-plugin';
import fastifyPostgres from '@fastify/postgres';
import { FastifyInstance } from 'fastify';

export interface PostgresPluginOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  ssl?: boolean | object;
}

/**
 * Constructs PostgreSQL pool configuration from environment variables.
 */
export const getDbConfig = (): PostgresPluginOptions => {
  const max = parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '20', 10);
  const idleTimeoutMillis = parseInt(process.env.POSTGRES_IDLE_TIMEOUT_MS || '30000', 10);
  const connectionTimeoutMillis = parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || '2000', 10);
  const ssl = process.env.POSTGRES_SSL === 'true';

  const basePoolConfig = {
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  };

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ...basePoolConfig,
    };
  }

  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.POSTGRES_DB || 'orchestr_db',
    ...basePoolConfig,
  };
};

/**
 * Fastify plugin for PostgreSQL connection pool management.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const config = getDbConfig();

    fastify.log.info({
      msg: 'Initializing PostgreSQL connection pool',
      maxPoolSize: config.max,
      idleTimeoutMs: config.idleTimeoutMillis,
      connTimeoutMs: config.connectionTimeoutMillis,
    });

    await fastify.register(fastifyPostgres, config);
  },
  {
    name: 'db-plugin',
  }
);
