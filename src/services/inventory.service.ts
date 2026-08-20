import { DbQuerier } from './auth.service';

export interface ChannelStockInfo {
  channelId: string | null;
  channelName: string;
  channelType: string;
  stockLevel: number;
  updatedAt: string;
}

export interface ProductReportItem {
  id: string;
  sellerId: string;
  channelId: string | null;
  channelName: string;
  channelType: string;
  title: string;
  sku: string;
  price: number;
  inventoryQuantity: number;
  status: string;
  isLowStock: boolean;
  isOversold: boolean;
  oversoldQuantity: number;
  channels: ChannelStockInfo[];
  createdAt: string;
  updatedAt: string;
}

export class InventoryService {
  /**
   * Syncs Shopify inventory for a channel, upserts `products` table, and detects overselling.
   */
  public static async syncShopifyInventory(
    db: DbQuerier,
    sellerId: string,
    channelId: string,
    shopifyInventoryFetcher?: () => Promise<Array<any>>
  ): Promise<{ syncedCount: number; oversoldProductsCount: number; products: ProductReportItem[] }> {
    if (!sellerId || !channelId) {
      const error: any = new Error('Seller ID and Channel ID are required');
      error.statusCode = 400;
      throw error;
    }

    // 1. Fetch channel details
    const channelResult = await db.query(
      `SELECT id, name, type FROM channels WHERE id = $1 AND seller_id = $2`,
      [channelId, sellerId]
    );

    if (channelResult.rows.length === 0) {
      const error: any = new Error('Channel not found');
      error.statusCode = 404;
      throw error;
    }
    const channel = channelResult.rows[0];

    // 2. Fetch inventory items from Shopify or fallback
    let itemsToSync: Array<any> = [];

    if (shopifyInventoryFetcher) {
      itemsToSync = await shopifyInventoryFetcher();
    } else {
      itemsToSync = [
        { title: 'Wireless Ergonomic Mouse', sku: 'PROD-MOUSE-001', price: 49.99, inventory_quantity: 150 },
        { title: 'Mechanical Gaming Keyboard', sku: 'PROD-KEYBD-002', price: 129.99, inventory_quantity: 85 },
        { title: 'UltraWide 34-inch Monitor', sku: 'PROD-MONTR-003', price: 599.99, inventory_quantity: 0 }, // Oversold (0 stock)
        { title: 'USB-C Multi-Port Hub', sku: 'PROD-HUB-004', price: 34.50, inventory_quantity: 200 },
        { title: 'Noise-Canceling Headphones', sku: 'PROD-HEADP-005', price: 199.95, inventory_quantity: 5 }, // Low stock (< 10)
      ];
    }

    // 3. Upsert products into database
    for (const item of itemsToSync) {
      const sku = item.sku;
      const price = parseFloat(item.price || 0);
      const inventoryQuantity = parseInt(item.inventory_quantity ?? item.inventoryQuantity ?? 0, 10);

      await db.query(
        `INSERT INTO products (seller_id, channel_id, title, sku, price, inventory_quantity, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         ON CONFLICT (sku)
         DO UPDATE SET
           title = EXCLUDED.title,
           price = EXCLUDED.price,
           inventory_quantity = EXCLUDED.inventory_quantity,
           channel_id = EXCLUDED.channel_id,
           updated_at = CURRENT_TIMESTAMP`,
        [sellerId, channelId, item.title, sku, price, inventoryQuantity]
      );
    }

    // 4. Retrieve complete report and overselling evaluation
    const report = await this.getProductsReport(db, sellerId);
    const oversoldProductsCount = report.filter((p) => p.isOversold).length;

    return {
      syncedCount: itemsToSync.length,
      oversoldProductsCount,
      products: report,
    };
  }

  /**
   * Calculates pending order demand for each SKU and detects overselling.
   */
  public static async getProductsReport(
    db: DbQuerier,
    sellerId: string,
    search?: string
  ): Promise<ProductReportItem[]> {
    // 1. Fetch pending order line items to calculate SKU demand
    const pendingOrdersRes = await db.query(
      `SELECT line_items FROM orders WHERE seller_id = $1 AND LOWER(status) = 'pending'`,
      [sellerId]
    );

    const skuDemandMap: Record<string, number> = {};
    for (const row of pendingOrdersRes.rows) {
      let items: any[] = [];
      if (typeof row.line_items === 'string') {
        try { items = JSON.parse(row.line_items); } catch {}
      } else if (Array.isArray(row.line_items)) {
        items = row.line_items;
      }

      for (const item of items) {
        if (item.sku) {
          const qty = parseInt(item.quantity || 1, 10);
          skuDemandMap[item.sku] = (skuDemandMap[item.sku] || 0) + qty;
        }
      }
    }

    // 2. Fetch products with channel metadata
    const conditions: string[] = ['p.seller_id = $1'];
    const params: any[] = [sellerId];

    if (search) {
      conditions.push(`(LOWER(p.title) LIKE $2 OR LOWER(p.sku) LIKE $2)`);
      params.push(`%${search.toLowerCase()}%`);
    }

    const sql = `
      SELECT p.id, p.seller_id, p.channel_id, c.name AS channel_name, c.type AS channel_type,
             p.title, p.sku, p.price, p.inventory_quantity, p.status, p.created_at, p.updated_at
      FROM products p
      LEFT JOIN channels c ON p.channel_id = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.updated_at DESC
    `;

    const result = await db.query(sql, params);

    return result.rows.map((row) => {
      const stock = parseInt(row.inventory_quantity || 0, 10);
      const demand = skuDemandMap[row.sku] || 0;

      const isLowStock = stock < 10;
      const isOversold = stock <= 0 || stock < demand;
      const oversoldQuantity = isOversold ? Math.max(demand - stock, stock <= 0 ? Math.abs(stock) : 0) : 0;

      const channelStockInfo: ChannelStockInfo = {
        channelId: row.channel_id,
        channelName: row.channel_name || 'Shopify Store',
        channelType: row.channel_type || 'shopify',
        stockLevel: stock,
        updatedAt: row.updated_at,
      };

      return {
        id: row.id,
        sellerId: row.seller_id,
        channelId: row.channel_id,
        channelName: row.channel_name || 'Shopify Store',
        channelType: row.channel_type || 'shopify',
        title: row.title,
        sku: row.sku,
        price: parseFloat(row.price || 0),
        inventoryQuantity: stock,
        status: row.status,
        isLowStock,
        isOversold,
        oversoldQuantity,
        channels: [channelStockInfo],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  /**
   * Retrieves stock breakdown across channels for a specific SKU (GET /api/products/:sku).
   */
  public static async getProductBySku(db: DbQuerier, sellerId: string, sku: string): Promise<ProductReportItem> {
    if (!sku) {
      const error: any = new Error('SKU parameter is required');
      error.statusCode = 400;
      throw error;
    }

    const report = await this.getProductsReport(db, sellerId, sku);
    const product = report.find((p) => p.sku.toLowerCase() === sku.toLowerCase());

    if (!product) {
      const error: any = new Error(`Product with SKU '${sku}' not found`);
      error.statusCode = 404;
      throw error;
    }

    return product;
  }
}
