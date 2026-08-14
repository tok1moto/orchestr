import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import dbPlugin, { getDbConfig } from '../src/plugins/db';

describe('PostgreSQL Connection Pool Setup', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  after(() => {
    process.env = originalEnv;
  });

  it('getDbConfig parses pool configuration from env correctly', () => {
    process.env.POSTGRES_HOST = 'db.internal';
    process.env.POSTGRES_PORT = '5433';
    process.env.POSTGRES_USER = 'testuser';
    process.env.POSTGRES_PASSWORD = 'testpass';
    process.env.POSTGRES_DB = 'testdb';
    process.env.POSTGRES_MAX_CONNECTIONS = '15';
    process.env.POSTGRES_IDLE_TIMEOUT_MS = '10000';
    process.env.POSTGRES_CONNECTION_TIMEOUT_MS = '5000';
    delete process.env.DATABASE_URL;

    const config = getDbConfig();

    assert.strictEqual(config.host, 'db.internal');
    assert.strictEqual(config.port, 5433);
    assert.strictEqual(config.user, 'testuser');
    assert.strictEqual(config.password, 'testpass');
    assert.strictEqual(config.database, 'testdb');
    assert.strictEqual(config.max, 15);
    assert.strictEqual(config.idleTimeoutMillis, 10000);
    assert.strictEqual(config.connectionTimeoutMillis, 5000);
  });

  it('getDbConfig prioritizes DATABASE_URL if present', () => {
    process.env.DATABASE_URL = 'postgresql://admin:secret@remotehost:5432/production_db';
    process.env.POSTGRES_MAX_CONNECTIONS = '25';

    const config = getDbConfig();

    assert.strictEqual(config.connectionString, 'postgresql://admin:secret@remotehost:5432/production_db');
    assert.strictEqual(config.max, 25);
  });

  it('dbPlugin registers successfully on Fastify instance', async () => {
    const fastify = Fastify({ logger: false });
    await fastify.register(dbPlugin);

    assert.strictEqual(fastify.hasDecorator('pg'), true);
    assert.ok(fastify.pg);
    assert.ok(fastify.pg.pool);

    await fastify.close();
  });
});
