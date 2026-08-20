import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { ReservationService } from '../src/services/reservation.service';
import { ReservationExpiryQueue } from '../src/queues/reservationExpiry.queue';
import { DbQuerier } from '../src/services/auth.service';
import reservationRoutes from '../src/routes/reservation.routes';

describe('Reservation Service & Stock Hold Enforcement', () => {
  const sellerId = 'seller-res-1';
  const mockReservationsDb: Map<string, any> = new Map();
  const mockProductsDb: Map<string, any> = new Map();

  const mockDb: DbQuerier = {
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

      // SELECT products stock
      if (sql.includes('SELECT id, inventory_quantity FROM products')) {
        const sku = params[1].toLowerCase();
        const prod = mockProductsDb.get(sku);
        return {
          rows: prod ? [{ id: prod.id, inventory_quantity: prod.inventory_quantity }] : [{ id: 'p-default', inventory_quantity: 10 }],
          rowCount: 1,
        };
      }

      // SELECT SUM(quantity) active reservations
      if (sql.includes('SELECT COALESCE(SUM(quantity), 0) AS active_qty')) {
        const sku = params[1].toLowerCase();
        const activeSum = Array.from(mockReservationsDb.values())
          .filter((r) => r.seller_id === params[0] && r.sku.toLowerCase() === sku && r.status === 'active')
          .reduce((sum, r) => sum + r.quantity, 0);

        return { rows: [{ active_qty: activeSum }], rowCount: 1 };
      }

      // INSERT INTO reservations
      if (sql.includes('INSERT INTO reservations')) {
        const id = `res-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const record = {
          id,
          seller_id: params[0],
          channel_id: params[1],
          product_id: params[2],
          sku: params[3],
          quantity: params[4],
          customer_email: params[5],
          status: 'active',
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        mockReservationsDb.set(id, record);
        return { rows: [record], rowCount: 1 };
      }

      // UPDATE reservations SET status = 'expired'
      if (sql.includes("status = 'expired'")) {
        const expired = Array.from(mockReservationsDb.values()).filter((r) => r.status === 'active' && r.isExpired);
        expired.forEach((r) => {
          r.status = 'expired';
          mockReservationsDb.set(r.id, r);
        });
        return { rows: expired, rowCount: expired.length };
      }

      // UPDATE reservations SET status = 'released'
      if (sql.includes("status = 'released'")) {
        const resId = params[0];
        const record = mockReservationsDb.get(resId);
        if (record) {
          record.status = 'released';
          mockReservationsDb.set(resId, record);
          return { rows: [record], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // SELECT FROM reservations
      if (sql.includes('SELECT') && sql.includes('FROM reservations')) {
        const list = Array.from(mockReservationsDb.values()).filter((r) => r.seller_id === params[0]);
        return { rows: list, rowCount: list.length };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  beforeEach(() => {
    mockReservationsDb.clear();
    mockProductsDb.clear();
    mockProductsDb.set('prod-mouse-001', { id: 'p1', inventory_quantity: 5 });
  });

  afterEach(() => {
    ReservationExpiryQueue.stopReservationExpiryScheduler();
  });

  it('reserves stock for 15 minutes when available stock is sufficient', async () => {
    const res = await ReservationService.reserveStock(mockDb, sellerId, {
      sku: 'PROD-MOUSE-001',
      quantity: 2,
      customerEmail: 'customer@example.com',
    });

    assert.ok(res.id);
    assert.strictEqual(res.sku, 'PROD-MOUSE-001');
    assert.strictEqual(res.quantity, 2);
    assert.strictEqual(res.status, 'active');
    assert.ok(res.expiresAt);
  });

  it('rejects reservation when requested quantity exceeds available stock', async () => {
    // 1st reservation takes 4 of 5 units
    await ReservationService.reserveStock(mockDb, sellerId, {
      sku: 'PROD-MOUSE-001',
      quantity: 4,
    });

    // 2nd reservation attempts to take 2 units (only 1 available)
    await assert.rejects(async () => {
      await ReservationService.reserveStock(mockDb, sellerId, {
        sku: 'PROD-MOUSE-001',
        quantity: 2,
      });
    }, (err: any) => err.statusCode === 400 && err.message.includes('Insufficient available stock'));
  });

  it('manually releases a reservation hold via releaseReservation()', async () => {
    const created = await ReservationService.reserveStock(mockDb, sellerId, {
      sku: 'PROD-MOUSE-001',
      quantity: 1,
    });

    const released = await ReservationService.releaseReservation(mockDb, sellerId, created.id);
    assert.strictEqual(released.id, created.id);
    assert.strictEqual(released.status, 'released');
  });

  it('cleanupExpiredReservations auto-releases expired holds', async () => {
    // Create mock expired reservation
    mockReservationsDb.set('res-expired-99', {
      id: 'res-expired-99',
      seller_id: sellerId,
      sku: 'PROD-MOUSE-001',
      quantity: 2,
      status: 'active',
      isExpired: true,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const result = await ReservationService.cleanupExpiredReservations(mockDb);
    assert.strictEqual(result.releasedCount, 1);
    assert.strictEqual(result.releasedIds[0], 'res-expired-99');
  });
});

describe('Reservation API Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Mock pg decorator
    app.decorate('pg', {
      async query(text: string, params: any[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();

        if (sql.includes('SELECT id, inventory_quantity FROM products')) {
          return { rows: [{ id: 'p1', inventory_quantity: 50 }], rowCount: 1 };
        }

        if (sql.includes('SELECT COALESCE(SUM(quantity), 0)')) {
          return { rows: [{ active_qty: 0 }], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO reservations')) {
          return {
            rows: [
              {
                id: 'res-api-1',
                seller_id: params[0],
                channel_id: params[1],
                product_id: params[2],
                sku: params[3],
                quantity: params[4],
                customer_email: params[5],
                status: 'active',
                expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }

        if (sql.includes('SELECT') && sql.includes('FROM reservations')) {
          return {
            rows: [
              {
                id: 'res-api-1',
                seller_id: 'seller-dev-1',
                sku: 'PROD-MOUSE-001',
                quantity: 2,
                customer_email: 'buyer@test.com',
                status: 'active',
                expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }

        if (sql.includes("status = 'released'")) {
          return {
            rows: [
              {
                id: params[0],
                seller_id: params[1],
                sku: 'PROD-MOUSE-001',
                quantity: 2,
                status: 'released',
                expires_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 0 };
      },
    } as any);

    await app.register(reservationRoutes);
  });

  afterEach(() => {
    ReservationExpiryQueue.stopReservationExpiryScheduler();
  });

  it('POST /api/reservations creates a 15-minute stock reservation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/reservations',
      payload: {
        sku: 'PROD-MOUSE-001',
        quantity: 2,
        customerEmail: 'buyer@test.com',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 201);
    assert.ok(body.reservation);
    assert.strictEqual(body.reservation.sku, 'PROD-MOUSE-001');
    assert.strictEqual(body.reservation.quantity, 2);
    assert.strictEqual(body.reservation.status, 'active');
  });

  it('GET /api/reservations returns list of seller stock reservations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reservations',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.ok(Array.isArray(body.reservations));
    assert.strictEqual(body.reservations[0].sku, 'PROD-MOUSE-001');
  });

  it('DELETE /api/reservations/:id manually releases stock reservation', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/reservations/res-api-1',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.strictEqual(body.reservation.status, 'released');
  });
});
