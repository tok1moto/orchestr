import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import orderRoutes from '../src/routes/order.routes';

describe('Frontend & Order Aggregation API (Integration)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Register static file serving
    await app.register(fastifyStatic, {
      root: path.join(process.cwd(), 'public'),
      prefix: '/',
    });

    // Register order routes
    await app.register(orderRoutes);
  });

  it('GET / serves the index.html frontend entrypoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(String(res.headers['content-type']).includes('text/html'));
    assert.ok(res.payload.includes('<title>Orchestr'));
    assert.ok(res.payload.includes('id="app"'));
  });

  it('GET /api/orders returns aggregated multi-channel orders', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/orders',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.ok(Array.isArray(body.orders));
    assert.ok(body.orders.length > 0);

    // Verify multi-channel representation
    const channels = body.orders.map((o: any) => o.channelType);
    assert.ok(channels.includes('shopify'));
    assert.ok(channels.includes('amazon'));
  });

  it('GET /api/orders?status=pending filters orders by status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/orders?status=pending',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(body.orders.every((o: any) => o.status === 'pending'));
  });
});
