import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { FulfillmentReportService } from '../src/services/fulfillmentReport.service';
import { DbQuerier } from '../src/services/auth.service';
import fulfillmentRoutes from '../src/routes/fulfillment.routes';

describe('Fulfillment Report Service & CSV Exporter (Unit & Integration)', () => {
  const sellerId = 'seller-ful-1';
  const mockOrdersDb: Map<string, any> = new Map();

  const mockDb: DbQuerier = {
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

      if (sql.includes('SELECT o.id, o.seller_id, o.channel_id')) {
        const targetStatus = params[1] || 'pending';
        const orders = Array.from(mockOrdersDb.values()).filter(
          (o) => o.seller_id === params[0] && o.status.toLowerCase() === targetStatus.toLowerCase()
        );
        return { rows: orders, rowCount: orders.length };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  beforeEach(() => {
    mockOrdersDb.clear();
    mockOrdersDb.set('ord-1', {
      id: 'ord-1',
      seller_id: sellerId,
      channel_id: 'chan-1',
      channel_name: 'Shopify Store',
      channel_type: 'shopify',
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
      line_items: JSON.stringify([
        { id: 101, title: 'Wireless Ergonomic Mouse', quantity: 2, price: '49.99', sku: 'PROD-MOUSE-001' },
      ]),
      created_at: '2026-08-21T10:00:00Z',
      updated_at: '2026-08-21T10:00:00Z',
    });
  });

  it('getFulfillmentReport retrieves pending orders and generates valid CSV format', async () => {
    const report = await FulfillmentReportService.getFulfillmentReport(mockDb, sellerId, { status: 'pending' });

    assert.strictEqual(report.total, 1);
    assert.strictEqual(report.items[0].orderNumber, '#SH-9401');
    assert.strictEqual(report.items[0].customerName, 'Eleanor Vance');

    // Verify CSV output
    assert.ok(report.csv.includes('Order Number,Channel,Customer Name,Customer Email'));
    assert.ok(report.csv.includes('"#SH-9401"'));
    assert.ok(report.csv.includes('"Eleanor Vance"'));
    assert.ok(report.csv.includes('"eleanor@example.com"'));
  });

  it('convertToCSV handles special characters and quotes correctly', () => {
    const mockItem: any = {
      orderNumber: '#SH-9402, "Special"',
      channelName: 'Shopify Store',
      customerName: 'O\'Connor, John',
      customerEmail: 'john@example.com',
      itemsCount: 1,
      lineItemsSummary: 'Widget A (x1) [SKU: WID-01]',
      totalPrice: 99.95,
      currency: 'USD',
      status: 'pending',
      trackingNumber: '',
      trackingCompany: '',
      createdAt: '2026-08-21T12:00:00Z',
    };

    const csv = FulfillmentReportService.convertToCSV([mockItem]);
    assert.ok(csv.includes('""Special""'));
    assert.ok(csv.includes('"O\'Connor, John"'));
  });
});

describe('Fulfillment API Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Mock pg decorator
    app.decorate('pg', {
      async query(text: string, params: any[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();

        if (sql.includes('SELECT o.id, o.seller_id, o.channel_id')) {
          return {
            rows: [
              {
                id: 'ord-api-1',
                seller_id: 'seller-dev-1',
                channel_id: 'chan-1',
                channel_name: 'Dev Shopify Store',
                channel_type: 'shopify',
                external_order_id: '9401',
                order_number: '#SH-9401',
                customer_name: 'Test Customer',
                customer_email: 'customer@test.com',
                total_price: 179.98,
                currency: 'USD',
                financial_status: 'paid',
                fulfillment_status: 'unfulfilled',
                status: 'pending',
                tracking_number: null,
                tracking_company: null,
                line_items: JSON.stringify([
                  { id: 101, title: 'Ergonomic Mouse', quantity: 2, price: '49.99', sku: 'PROD-MOUSE-001' },
                ]),
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

    await app.register(fulfillmentRoutes);
  });

  it('GET /api/fulfillment?status=pending returns JSON array of pending orders', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/fulfillment?status=pending',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.ok(Array.isArray(body.orders));
    assert.strictEqual(body.orders[0].orderNumber, '#SH-9401');
  });

  it('GET /api/fulfillment?status=pending&format=csv returns CSV file download', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/fulfillment?status=pending&format=csv',
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.ok(res.headers['content-disposition']?.includes('attachment; filename="fulfillment-report.csv"'));
    assert.ok(res.payload.includes('Order Number,Channel,Customer Name,Customer Email'));
    assert.ok(res.payload.includes('"#SH-9401"'));
  });
});
