import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { OrderNormalizationService } from '../src/services/orderNormalization.service';
import { OrderSyncService } from '../src/services/orderSync.service';
import { OrderSyncQueue } from '../src/queues/orderSync.queue';
import { DbQuerier } from '../src/services/auth.service';
import orderRoutes from '../src/routes/order.routes';
import { AuthService } from '../src/services/auth.service';

describe('Order Normalization Service', () => {
  it('converts raw Shopify order payload to unified Orchestr order schema', () => {
    const rawShopifyOrder = {
      id: 99401,
      name: '#SH-99401',
      order_number: 99401,
      currency: 'usd',
      total_price: '199.50',
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      cancelled_at: null,
      customer: {
        first_name: 'Arthur',
        last_name: 'Dent',
        email: 'arthur@galaxy.com',
      },
      line_items: [
        { id: 501, title: 'Towel', quantity: 1, price: '42.00', sku: 'TOWEL-042' },
        { id: 502, title: 'Don\'t Panic Guide', quantity: 1, price: '157.50', sku: 'GUIDE-001' },
      ],
    };

    const normalized = OrderNormalizationService.normalizeShopifyOrder(rawShopifyOrder);

    assert.strictEqual(normalized.externalOrderId, '99401');
    assert.strictEqual(normalized.orderNumber, '#SH-99401');
    assert.strictEqual(normalized.customerName, 'Arthur Dent');
    assert.strictEqual(normalized.customerEmail, 'arthur@galaxy.com');
    assert.strictEqual(normalized.totalPrice, 199.50);
    assert.strictEqual(normalized.currency, 'USD');
    assert.strictEqual(normalized.financialStatus, 'paid');
    assert.strictEqual(normalized.fulfillmentStatus, 'fulfilled');
    assert.strictEqual(normalized.status, 'delivered'); // fulfilled -> delivered
    assert.strictEqual(normalized.lineItems.length, 2);
    assert.strictEqual(normalized.lineItems[0].sku, 'TOWEL-042');
  });

  it('maps cancelled Shopify order to cancelled status', () => {
    const rawCancelled = {
      id: 99402,
      name: '#SH-99402',
      cancelled_at: '2026-08-20T10:00:00Z',
      cancel_reason: 'customer',
      total_price: '50.00',
    };

    const normalized = OrderNormalizationService.normalizeShopifyOrder(rawCancelled);
    assert.strictEqual(normalized.status, 'cancelled');
  });
});

describe('Order Sync Service & Sync Logs (Unit & Integration)', () => {
  const sellerId = 'seller-111';
  const channelId = 'chan-222';
  const mockOrdersDb: Map<string, any> = new Map();
  const mockSyncLogsDb: Map<string, any> = new Map();

  const mockDb: DbQuerier = {
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

      // INSERT INTO sync_logs RETURNING id
      if (sql.includes('INSERT INTO sync_logs')) {
        const id = `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const logItem = {
          id,
          seller_id: params[0],
          channel_id: params[1],
          status: params[2],
          orders_synced: params[3],
          error_message: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        mockSyncLogsDb.set(id, logItem);
        return { rows: [{ id }], rowCount: 1 };
      }

      // UPDATE sync_logs
      if (sql.includes('UPDATE sync_logs')) {
        const logId = params[params.length - 1];
        const logItem = mockSyncLogsDb.get(logId);
        if (logItem) {
          if (sql.includes("status = 'success'")) {
            logItem.status = 'success';
            logItem.orders_synced = params[0];
          } else if (sql.includes("status = 'failed'")) {
            logItem.status = 'failed';
            logItem.error_message = params[0];
          }
          mockSyncLogsDb.set(logId, logItem);
        }
        return { rows: [logItem], rowCount: 1 };
      }

      // SELECT channels
      if (sql.includes('SELECT id, seller_id, name, type, credentials, status FROM channels')) {
        return {
          rows: [
            {
              id: channelId,
              seller_id: sellerId,
              name: 'Shopify Store',
              type: 'shopify',
              credentials: JSON.stringify({ shop_domain: 'test.myshopify.com', access_token: 'shpat_test' }),
              status: 'active',
            },
          ],
          rowCount: 1,
        };
      }

      // INSERT/UPSERT INTO orders
      if (sql.includes('INSERT INTO orders')) {
        const extId = params[2];
        const orderRecord = {
          id: `ord-${Date.now()}-${extId}`,
          seller_id: params[0],
          channel_id: params[1],
          external_order_id: extId,
          order_number: params[3],
          customer_name: params[4],
          customer_email: params[5],
          total_price: params[6],
          currency: params[7],
          financial_status: params[8],
          fulfillment_status: params[9],
          status: params[10],
          line_items: params[11],
          raw_data: params[12],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        mockOrdersDb.set(extId, orderRecord);
        return { rows: [orderRecord], rowCount: 1 };
      }

      // SELECT FROM orders
      if (sql.includes('SELECT') && sql.includes('FROM orders')) {
        const orders = Array.from(mockOrdersDb.values()).filter((o) => o.seller_id === params[0]);
        return { rows: orders, rowCount: orders.length };
      }

      // SELECT FROM sync_logs
      if (sql.includes('SELECT') && sql.includes('FROM sync_logs')) {
        const logs = Array.from(mockSyncLogsDb.values()).filter((l) => l.seller_id === params[0]);
        return { rows: logs, rowCount: logs.length };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  beforeEach(() => {
    mockOrdersDb.clear();
    mockSyncLogsDb.clear();
  });

  afterEach(() => {
    OrderSyncQueue.stopOrderSyncScheduler();
  });

  it('syncShopifyOrders polls Shopify orders, stores in DB, and records sync log', async () => {
    const result = await OrderSyncService.syncShopifyOrders(mockDb, sellerId, channelId, async () => [
      {
        id: 7001,
        name: '#SH-7001',
        total_price: '89.99',
        currency: 'USD',
        financial_status: 'paid',
        fulfillment_status: 'fulfilled',
        customer: { first_name: 'Ford', last_name: 'Prefect', email: 'ford@guide.com' },
        line_items: [{ id: 1, title: 'Sub-Etha Sens-O-Matic', quantity: 1, price: '89.99', sku: 'SENS-001' }],
      },
    ]);

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.ordersSynced, 1);
    assert.strictEqual(result.orders[0].orderNumber, '#SH-7001');

    // Verify sync_logs entry created
    const logs = await OrderSyncService.getSyncLogs(mockDb, sellerId);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].status, 'success');
    assert.strictEqual(logs[0].ordersSynced, 1);

    // Verify query SELECT * FROM orders WHERE seller_id = ?
    const ordersInDb = await OrderSyncService.getOrdersBySeller(mockDb, sellerId);
    assert.strictEqual(ordersInDb.length, 1);
    assert.strictEqual(ordersInDb[0].externalOrderId, '7001');
  });

  it('records failed status in sync_logs when order sync encounters an error', async () => {
    await assert.rejects(async () => {
      await OrderSyncService.syncShopifyOrders(mockDb, sellerId, channelId, async () => {
        throw new Error('Shopify API Connection Timeout');
      });
    });

    const logs = await OrderSyncService.getSyncLogs(mockDb, sellerId);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].status, 'failed');
    assert.strictEqual(logs[0].errorMessage, 'Shopify API Connection Timeout');
  });
});

describe('Order API Routes & 5-Minute Queue Scheduler', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Mock pg decorator
    app.decorate('pg', {
      async query(text: string, params: any[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();

        if (sql.includes('SELECT id FROM channels')) {
          return { rows: [{ id: 'chan-default-123' }], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO sync_logs')) {
          return { rows: [{ id: 'log-test-1' }], rowCount: 1 };
        }

        if (sql.includes('SELECT id, seller_id, name, type, credentials, status FROM channels')) {
          return {
            rows: [
              {
                id: 'chan-default-123',
                seller_id: params[1] || 'seller-dev-1',
                name: 'Dev Shopify Store',
                type: 'shopify',
                credentials: JSON.stringify({ shop_domain: 'dev.myshopify.com', access_token: 'shpat_dev' }),
                status: 'active',
              },
            ],
            rowCount: 1,
          };
        }

        if (sql.includes('INSERT INTO orders')) {
          return {
            rows: [
              {
                id: 'ord-100',
                seller_id: params[0],
                channel_id: params[1],
                external_order_id: params[2],
                order_number: params[3],
                customer_name: params[4],
                customer_email: params[5],
                total_price: params[6],
                currency: params[7],
                financial_status: params[8],
                fulfillment_status: params[9],
                status: params[10],
                line_items: params[11],
                raw_data: params[12],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }

        if (sql.includes('SELECT') && sql.includes('FROM orders')) {
          return {
            rows: [
              {
                id: 'ord-100',
                seller_id: 'seller-dev-1',
                channel_id: 'chan-default-123',
                external_order_id: '9401',
                order_number: '#SH-9401',
                customer_name: 'Test Customer',
                customer_email: 'customer@test.com',
                total_price: 179.98,
                currency: 'USD',
                financial_status: 'paid',
                fulfillment_status: 'unfulfilled',
                status: 'pending',
                line_items: '[]',
                raw_data: '{}',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }

        if (sql.includes('SELECT') && sql.includes('FROM sync_logs')) {
          return {
            rows: [
              {
                id: 'log-1',
                seller_id: 'seller-dev-1',
                channel_id: 'chan-default-123',
                status: 'success',
                orders_synced: 2,
                error_message: null,
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

    await app.register(orderRoutes);
  });

  afterEach(() => {
    OrderSyncQueue.stopOrderSyncScheduler();
  });

  it('GET /api/orders returns orders from PostgreSQL database', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/orders',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.ok(Array.isArray(body.orders));
    assert.strictEqual(body.orders.length, 1);
    assert.strictEqual(body.orders[0].orderNumber, '#SH-9401');
  });

  it('POST /api/orders/sync triggers order polling and returns sync result', async () => {
    const token = AuthService.generateToken({ userId: 'u1', sellerId: 's1', email: 'merchant@test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/orders/sync',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        channelId: 'chan-default-123',
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.ok(body.syncLogId);
    assert.ok(body.ordersSynced >= 0);
  });

  it('GET /api/sync-logs returns list of sync logs for authenticated seller', async () => {
    const token = AuthService.generateToken({ userId: 'u1', sellerId: 's1', email: 'merchant@test.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/sync-logs',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.ok(Array.isArray(body.syncLogs));
    assert.strictEqual(body.syncLogs[0].status, 'success');
  });
});
