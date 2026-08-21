import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { OrderFulfillmentService } from '../src/services/orderFulfillment.service';
import { DbQuerier } from '../src/services/auth.service';
import orderRoutes from '../src/routes/order.routes';

describe('Order Fulfillment Service & Status History (Unit & Integration)', () => {
  const sellerId = 'seller-ful-1';
  const orderId = 'ord-ful-100';
  const channelId = 'chan-ful-200';
  const mockOrdersDb: Map<string, any> = new Map();
  const mockHistoryDb: Map<string, any> = new Map();

  const mockDb: DbQuerier = {
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

      // SELECT orders
      if (sql.includes('SELECT id, seller_id, channel_id, external_order_id')) {
        const order = mockOrdersDb.get(params[0]);
        if (order && order.seller_id === params[1]) {
          return { rows: [order], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // UPDATE orders
      if (sql.includes('UPDATE orders')) {
        const order = mockOrdersDb.get(params[4]);
        if (order) {
          order.status = params[0];
          order.fulfillment_status = params[1];
          order.tracking_number = params[2];
          order.tracking_company = params[3];
          order.updated_at = new Date().toISOString();
          mockOrdersDb.set(order.id, order);
          return { rows: [order], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // SELECT channels
      if (sql.includes('SELECT id, name, type, credentials FROM channels')) {
        return {
          rows: [
            {
              id: channelId,
              name: 'Shopify Store',
              type: 'shopify',
              credentials: JSON.stringify({ shop_domain: 'acme.myshopify.com', access_token: 'shpat_test123' }),
            },
          ],
          rowCount: 1,
        };
      }

      // INSERT INTO order_status_history
      if (sql.includes('INSERT INTO order_status_history')) {
        const id = `hist-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const record = {
          id,
          order_id: params[0],
          seller_id: params[1],
          old_status: params[2],
          new_status: params[3],
          tracking_number: params[4],
          tracking_company: params[5],
          notes: params[6],
          created_at: new Date().toISOString(),
        };
        mockHistoryDb.set(id, record);
        return { rows: [record], rowCount: 1 };
      }

      // SELECT FROM order_status_history
      if (sql.includes('SELECT') && sql.includes('FROM order_status_history')) {
        const history = Array.from(mockHistoryDb.values()).filter(
          (h) => h.order_id === params[0] && h.seller_id === params[1]
        );
        return { rows: history, rowCount: history.length };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  beforeEach(() => {
    mockOrdersDb.clear();
    mockHistoryDb.clear();

    mockOrdersDb.set(orderId, {
      id: orderId,
      seller_id: sellerId,
      channel_id: channelId,
      external_order_id: '9401',
      order_number: '#SH-9401',
      customer_name: 'Eleanor Vance',
      customer_email: 'eleanor@example.com',
      total_price: 179.98,
      currency: 'USD',
      financial_status: 'paid',
      fulfillment_status: 'unfulfilled',
      status: 'pending',
      tracking_number: null,
      tracking_company: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  it('updates order status to shipped, stores tracking number, triggers Shopify API, and logs history', async () => {
    let shopifyFulfillmentCalled = false;

    const result = await OrderFulfillmentService.updateOrderStatus(
      mockDb,
      sellerId,
      orderId,
      {
        status: 'shipped',
        trackingNumber: 'TRACK-998822',
        trackingCompany: 'UPS',
        notes: 'Shipped via UPS Express',
      },
      async (shopDomain, accessToken, extOrderId, tracking) => {
        assert.strictEqual(shopDomain, 'acme.myshopify.com');
        assert.strictEqual(accessToken, 'shpat_test123');
        assert.strictEqual(extOrderId, '9401');
        assert.strictEqual(tracking.trackingNumber, 'TRACK-998822');
        assert.strictEqual(tracking.trackingCompany, 'UPS');
        shopifyFulfillmentCalled = true;
      }
    );

    assert.strictEqual(shopifyFulfillmentCalled, true);
    assert.strictEqual(result.shopifySynced, true);
    assert.strictEqual(result.order.status, 'shipped');
    assert.strictEqual(result.order.fulfillmentStatus, 'fulfilled');
    assert.strictEqual(result.order.trackingNumber, 'TRACK-998822');
    assert.strictEqual(result.order.trackingCompany, 'UPS');

    // Verify history recorded
    assert.strictEqual(result.history.oldStatus, 'pending');
    assert.strictEqual(result.history.newStatus, 'shipped');
    assert.strictEqual(result.history.trackingNumber, 'TRACK-998822');
  });

  it('retrieves order status history via getOrderStatusHistory()', async () => {
    await OrderFulfillmentService.updateOrderStatus(mockDb, sellerId, orderId, {
      status: 'shipped',
      trackingNumber: 'TRACK-1122',
    });

    const history = await OrderFulfillmentService.getOrderStatusHistory(mockDb, sellerId, orderId);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].newStatus, 'shipped');
    assert.strictEqual(history[0].trackingNumber, 'TRACK-1122');
  });
});

describe('Order Status Sync API Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Mock pg decorator
    app.decorate('pg', {
      async query(text: string, params: any[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();

        if (sql.includes('SELECT id, seller_id, channel_id, external_order_id')) {
          return {
            rows: [
              {
                id: 'ord-api-1',
                seller_id: 'seller-dev-1',
                channel_id: 'chan-1',
                external_order_id: '9401',
                order_number: '#SH-9401',
                customer_name: 'Test Customer',
                customer_email: 'test@customer.com',
                total_price: 150.0,
                currency: 'USD',
                financial_status: 'paid',
                fulfillment_status: 'unfulfilled',
                status: 'pending',
                tracking_number: null,
                tracking_company: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }

        if (sql.includes('UPDATE orders')) {
          return {
            rows: [
              {
                id: 'ord-api-1',
                seller_id: 'seller-dev-1',
                channel_id: 'chan-1',
                external_order_id: '9401',
                order_number: '#SH-9401',
                customer_name: 'Test Customer',
                customer_email: 'test@customer.com',
                total_price: 150.0,
                currency: 'USD',
                financial_status: 'paid',
                fulfillment_status: 'fulfilled',
                status: 'shipped',
                tracking_number: params[2],
                tracking_company: params[3],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }

        if (sql.includes('SELECT id, name, type, credentials FROM channels')) {
          return {
            rows: [
              {
                id: 'chan-1',
                name: 'Dev Shopify Store',
                type: 'shopify',
                credentials: JSON.stringify({ shop_domain: 'dev.myshopify.com', access_token: 'shpat_dev' }),
              },
            ],
            rowCount: 1,
          };
        }

        if (sql.includes('INSERT INTO order_status_history')) {
          return {
            rows: [
              {
                id: 'hist-api-1',
                order_id: params[0],
                seller_id: params[1],
                old_status: params[2],
                new_status: params[3],
                tracking_number: params[4],
                tracking_company: params[5],
                notes: params[6],
                created_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }

        if (sql.includes('SELECT') && sql.includes('FROM order_status_history')) {
          return {
            rows: [
              {
                id: 'hist-api-1',
                order_id: 'ord-api-1',
                seller_id: 'seller-dev-1',
                old_status: 'pending',
                new_status: 'shipped',
                tracking_number: '123456',
                tracking_company: 'UPS',
                notes: 'Order status updated from pending to shipped',
                created_at: new Date().toISOString(),
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

  it('PATCH /api/orders/:id marks order as shipped, stores tracking number, and logs status change', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/orders/ord-api-1',
      payload: {
        status: 'shipped',
        trackingNumber: '123456',
        trackingCompany: 'UPS',
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.strictEqual(body.order.status, 'shipped');
    assert.strictEqual(body.order.trackingNumber, '123456');
    assert.strictEqual(body.order.trackingCompany, 'UPS');
    assert.strictEqual(body.shopifySynced, true);
    assert.ok(body.history);
  });

  it('GET /api/orders/:id/history returns order status audit trail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/orders/ord-api-1/history',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.ok(Array.isArray(body.history));
    assert.strictEqual(body.history[0].newStatus, 'shipped');
    assert.strictEqual(body.history[0].trackingNumber, '123456');
  });
});
