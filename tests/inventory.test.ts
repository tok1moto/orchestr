import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { InventoryService } from '../src/services/inventory.service';
import { InventorySyncQueue } from '../src/queues/inventorySync.queue';
import { DbQuerier } from '../src/services/auth.service';
import productRoutes from '../src/routes/product.routes';

describe('Inventory Service & Overselling Detection', () => {
  const sellerId = 'seller-inv-1';
  const channelId = 'chan-inv-1';
  const mockProductsDb: Map<string, any> = new Map();
  const mockOrdersDb: Map<string, any> = new Map();

  const mockDb: DbQuerier = {
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

      // SELECT channels
      if (sql.includes('SELECT id, name, type FROM channels')) {
        return {
          rows: [{ id: channelId, name: 'Shopify Store', type: 'shopify' }],
          rowCount: 1,
        };
      }

      // INSERT/UPSERT INTO products
      if (sql.includes('INSERT INTO products')) {
        const sku = params[3];
        const record = {
          id: `prod-${sku}`,
          seller_id: params[0],
          channel_id: params[1],
          title: params[2],
          sku: params[3],
          price: params[4],
          inventory_quantity: params[5],
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        mockProductsDb.set(sku, record);
        return { rows: [record], rowCount: 1 };
      }

      // SELECT line_items FROM orders WHERE seller_id = $1 AND LOWER(status) = 'pending'
      if (sql.includes('SELECT line_items FROM orders')) {
        const pendingOrders = Array.from(mockOrdersDb.values()).filter((o) => o.status === 'pending');
        return { rows: pendingOrders.map((o) => ({ line_items: o.line_items })), rowCount: pendingOrders.length };
      }

      // SELECT FROM products
      if (sql.includes('SELECT') && sql.includes('FROM products')) {
        let products = Array.from(mockProductsDb.values()).filter((p) => p.seller_id === params[0]);
        if (params.length > 1 && params[1]) {
          const search = params[1].replace(/%/g, '').toLowerCase();
          products = products.filter((p) => p.sku.toLowerCase().includes(search) || p.title.toLowerCase().includes(search));
        }
        return { rows: products, rowCount: products.length };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  beforeEach(() => {
    mockProductsDb.clear();
    mockOrdersDb.clear();
  });

  afterEach(() => {
    InventorySyncQueue.stopInventorySyncScheduler();
  });

  it('syncShopifyInventory updates products stock levels in database', async () => {
    const res = await InventoryService.syncShopifyInventory(mockDb, sellerId, channelId, async () => [
      { title: 'Gaming Chair', sku: 'CHAIR-001', price: 199.99, inventory_quantity: 40 },
    ]);

    assert.strictEqual(res.syncedCount, 1);
    assert.strictEqual(res.products.length, 1);
    assert.strictEqual(res.products[0].sku, 'CHAIR-001');
    assert.strictEqual(res.products[0].inventoryQuantity, 40);
  });

  it('detects overselling when inventory is 0 or less than pending order demand', async () => {
    // Add pending order demanding 5 units of MONTR-003
    mockOrdersDb.set('ord-1', {
      status: 'pending',
      line_items: JSON.stringify([{ id: '1', title: 'Monitor', quantity: 5, price: 599.99, sku: 'MONTR-003' }]),
    });

    // Sync product with 0 stock
    await InventoryService.syncShopifyInventory(mockDb, sellerId, channelId, async () => [
      { title: 'Monitor 34-inch', sku: 'MONTR-003', price: 599.99, inventory_quantity: 0 },
    ]);

    const report = await InventoryService.getProductsReport(mockDb, sellerId);
    assert.strictEqual(report.length, 1);

    const monitor = report[0];
    assert.strictEqual(monitor.isOversold, true);
    assert.strictEqual(monitor.oversoldQuantity, 5); // 5 demanded vs 0 in stock
  });

  it('getProductBySku returns multi-channel stock level for specific SKU', async () => {
    await InventoryService.syncShopifyInventory(mockDb, sellerId, channelId, async () => [
      { title: 'USB Hub', sku: 'HUB-99', price: 29.99, inventory_quantity: 50 },
    ]);

    const item = await InventoryService.getProductBySku(mockDb, sellerId, 'HUB-99');
    assert.strictEqual(item.sku, 'HUB-99');
    assert.strictEqual(item.inventoryQuantity, 50);
    assert.strictEqual(item.channels.length, 1);
  });
});

describe('Product API Routes & Inventory Queue Scheduler', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Mock pg decorator
    app.decorate('pg', {
      async query(text: string, params: any[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();

        if (sql.includes('SELECT id FROM channels')) {
          return { rows: [{ id: 'chan-inv-100' }], rowCount: 1 };
        }

        if (sql.includes('SELECT id, name, type FROM channels')) {
          return { rows: [{ id: 'chan-inv-100', name: 'Dev Shopify Store', type: 'shopify' }], rowCount: 1 };
        }

        if (sql.includes('SELECT line_items FROM orders')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('INSERT INTO products')) {
          return { rows: [{ id: 'p1' }], rowCount: 1 };
        }

        if (sql.includes('SELECT') && sql.includes('FROM products')) {
          return {
            rows: [
              {
                id: 'p1',
                seller_id: 'seller-1',
                channel_id: 'chan-inv-100',
                channel_name: 'Dev Shopify Store',
                channel_type: 'shopify',
                title: 'Ergonomic Mouse',
                sku: 'PROD-MOUSE-001',
                price: 49.99,
                inventory_quantity: 150,
                status: 'active',
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

    await app.register(productRoutes);
  });

  afterEach(() => {
    InventorySyncQueue.stopInventorySyncScheduler();
  });

  it('GET /api/products returns multi-channel inventory report', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/products',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.ok(Array.isArray(body.products));
    assert.strictEqual(body.products[0].sku, 'PROD-MOUSE-001');
    assert.strictEqual(body.products[0].inventoryQuantity, 150);
  });

  it('GET /api/products/:sku returns stock details for specific SKU', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/products/PROD-MOUSE-001',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.ok(body.product);
    assert.strictEqual(body.product.sku, 'PROD-MOUSE-001');
    assert.ok(Array.isArray(body.product.channels));
  });
});
