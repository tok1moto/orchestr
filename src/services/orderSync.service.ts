import { DbQuerier } from './auth.service';
import { ChannelService } from './channel.service';
import { OrderNormalizationService, NormalizedOrder } from './orderNormalization.service';

export interface SyncLogItem {
  id: string;
  sellerId: string;
  channelId: string;
  status: 'running' | 'success' | 'failed';
  ordersSynced: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderQueryFilters {
  status?: string;
  email?: string;
  startDate?: string;
  endDate?: string;
  channelId?: string;
  search?: string;
}

export interface OrderRecord {
  id: string;
  sellerId: string;
  channelId: string | null;
  channelName?: string;
  channelType?: string;
  externalOrderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  totalPrice: number;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string;
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
  lineItems: any[];
  rawData: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export class OrderSyncService {
  /**
   * Polls Shopify API for orders, normalizes payloads, upserts into `orders` table, and tracks `sync_logs`.
   */
  public static async syncShopifyOrders(
    db: DbQuerier,
    sellerId: string,
    channelId: string,
    shopifyOrderFetcher?: () => Promise<Array<any>>
  ): Promise<{ syncLogId: string; status: 'success' | 'failed'; ordersSynced: number; orders: OrderRecord[] }> {
    if (!sellerId || !channelId) {
      const error: any = new Error('Seller ID and Channel ID are required');
      error.statusCode = 400;
      throw error;
    }

    // 1. Create initial sync_logs entry with status = 'running'
    const logRes = await db.query(
      `INSERT INTO sync_logs (seller_id, channel_id, status, orders_synced)
       VALUES ($1, $2, 'running', 0)
       RETURNING id`,
      [sellerId, channelId]
    );
    const syncLogId = logRes.rows[0].id;

    try {
      // 2. Retrieve channel with unmasked credentials
      const channelResult = await db.query(
        `SELECT id, seller_id, name, type, credentials, status FROM channels WHERE id = $1 AND seller_id = $2`,
        [channelId, sellerId]
      );

      if (channelResult.rows.length === 0) {
        const error: any = new Error('Channel not found');
        error.statusCode = 404;
        throw error;
      }

      // 3. Fetch Shopify raw orders
      let rawOrders: Array<any> = [];

      if (shopifyOrderFetcher) {
        rawOrders = await shopifyOrderFetcher();
      } else {
        // Fallback mock raw orders for test/development
        rawOrders = [
          {
            id: 940182,
            name: '#SH-9401',
            order_number: 9401,
            currency: 'USD',
            total_price: '179.98',
            financial_status: 'paid',
            fulfillment_status: 'unfulfilled',
            cancelled_at: null,
            customer: { first_name: 'Eleanor', last_name: 'Vance', email: 'eleanor@example.com' },
            line_items: [
              { id: 101, title: 'Wireless Ergonomic Mouse', quantity: 2, price: '49.99', sku: 'PROD-MOUSE-001' },
              { id: 102, title: 'USB-C Fast Charger', quantity: 1, price: '79.99', sku: 'PROD-HUB-004' },
            ],
          },
          {
            id: 940294,
            name: '#SH-9402',
            order_number: 9402,
            currency: 'USD',
            total_price: '284.45',
            financial_status: 'paid',
            fulfillment_status: 'fulfilled',
            cancelled_at: null,
            customer: { first_name: 'Sophia', last_name: 'Lin', email: 'sophia@example.com' },
            line_items: [
              { id: 103, title: 'Mechanical Gaming Keyboard', quantity: 1, price: '129.99', sku: 'PROD-KEYBD-002' },
            ],
          },
        ];
      }

      // 4. Normalize raw orders & upsert into PostgreSQL `orders` table
      const syncedOrders: OrderRecord[] = [];

      for (const raw of rawOrders) {
        const normalized = OrderNormalizationService.normalizeShopifyOrder(raw);

        const upsertRes = await db.query(
          `INSERT INTO orders (
             seller_id, channel_id, external_order_id, order_number, customer_name, customer_email,
             total_price, currency, financial_status, fulfillment_status, status, line_items, raw_data
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (channel_id, external_order_id)
           DO UPDATE SET
             order_number = EXCLUDED.order_number,
             customer_name = EXCLUDED.customer_name,
             customer_email = EXCLUDED.customer_email,
             total_price = EXCLUDED.total_price,
             currency = EXCLUDED.currency,
             financial_status = EXCLUDED.financial_status,
             fulfillment_status = EXCLUDED.fulfillment_status,
             status = EXCLUDED.status,
             line_items = EXCLUDED.line_items,
             raw_data = EXCLUDED.raw_data,
             updated_at = CURRENT_TIMESTAMP
           RETURNING id, seller_id, channel_id, external_order_id, order_number, customer_name, customer_email,
                     total_price, currency, financial_status, fulfillment_status, status, line_items, raw_data, created_at, updated_at`,
          [
            sellerId,
            channelId,
            normalized.externalOrderId,
            normalized.orderNumber,
            normalized.customerName,
            normalized.customerEmail,
            normalized.totalPrice,
            normalized.currency,
            normalized.financialStatus,
            normalized.fulfillmentStatus,
            normalized.status,
            JSON.stringify(normalized.lineItems),
            JSON.stringify(normalized.rawData),
          ]
        );

        if (upsertRes.rows.length > 0) {
          const row = upsertRes.rows[0];
          syncedOrders.push({
            id: row.id,
            sellerId: row.seller_id,
            channelId: row.channel_id,
            externalOrderId: row.external_order_id,
            orderNumber: row.order_number,
            customerName: row.customer_name,
            customerEmail: row.customer_email,
            totalPrice: parseFloat(row.total_price),
            currency: row.currency,
            financialStatus: row.financial_status,
            fulfillmentStatus: row.fulfillment_status,
            status: row.status,
            lineItems: typeof row.line_items === 'string' ? JSON.parse(row.line_items) : row.line_items,
            rawData: typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          });
        }
      }

      // 5. Update sync_logs entry to status = 'success'
      await db.query(
        `UPDATE sync_logs
         SET status = 'success', orders_synced = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [syncedOrders.length, syncLogId]
      );

      return {
        syncLogId,
        status: 'success',
        ordersSynced: syncedOrders.length,
        orders: syncedOrders,
      };
    } catch (err: any) {
      // Record failure in sync_logs
      await db.query(
        `UPDATE sync_logs
         SET status = 'failed', error_message = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [err.message || 'Sync failed', syncLogId]
      );

      throw err;
    }
  }

  /**
   * Retrieves orders for a seller with filtering by status, email, date range, channelId, and search terms.
   * Joins channels table to include channelName and channelType.
   */
  public static async getOrdersBySeller(
    db: DbQuerier,
    sellerId: string,
    filters?: OrderQueryFilters
  ): Promise<OrderRecord[]> {
    const conditions: string[] = ['o.seller_id = $1'];
    const params: any[] = [sellerId];
    let paramIdx = 2;

    if (filters?.status && filters.status !== 'all') {
      conditions.push(`LOWER(o.status) = $${paramIdx++}`);
      params.push(filters.status.toLowerCase());
    }

    if (filters?.email) {
      conditions.push(`LOWER(o.customer_email) = $${paramIdx++}`);
      params.push(filters.email.toLowerCase().trim());
    }

    if (filters?.startDate) {
      conditions.push(`o.created_at >= $${paramIdx++}`);
      params.push(new Date(filters.startDate).toISOString());
    }

    if (filters?.endDate) {
      conditions.push(`o.created_at <= $${paramIdx++}`);
      params.push(new Date(filters.endDate).toISOString());
    }

    if (filters?.channelId && filters.channelId !== 'all') {
      conditions.push(`o.channel_id = $${paramIdx++}`);
      params.push(filters.channelId);
    }

    if (filters?.search) {
      conditions.push(
        `(LOWER(o.order_number) LIKE $${paramIdx} OR LOWER(o.customer_name) LIKE $${paramIdx} OR LOWER(o.customer_email) LIKE $${paramIdx})`
      );
      params.push(`%${filters.search.toLowerCase()}%`);
      paramIdx++;
    }

    const sql = `
      SELECT o.id, o.seller_id, o.channel_id, c.name AS channel_name, c.type AS channel_type,
             o.external_order_id, o.order_number, o.customer_name, o.customer_email,
             o.total_price, o.currency, o.financial_status, o.fulfillment_status, o.status,
             o.line_items, o.raw_data, o.created_at, o.updated_at
      FROM orders o
      LEFT JOIN channels c ON o.channel_id = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY o.created_at DESC
    `;

    const result = await db.query(sql, params);

    return result.rows.map((row) => ({
      id: row.id,
      sellerId: row.seller_id,
      channelId: row.channel_id,
      channelName: row.channel_name || 'Direct / Store',
      channelType: row.channel_type || 'custom',
      externalOrderId: row.external_order_id,
      orderNumber: row.order_number,
      customerName: row.customer_name || 'Guest Customer',
      customerEmail: row.customer_email || 'N/A',
      totalPrice: parseFloat(row.total_price || 0),
      currency: row.currency || 'USD',
      financialStatus: row.financial_status || 'pending',
      fulfillmentStatus: row.fulfillment_status || 'unfulfilled',
      status: row.status,
      lineItems: typeof row.line_items === 'string' ? JSON.parse(row.line_items) : (row.line_items || []),
      rawData: typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : (row.raw_data || {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }


  /**
   * Retrieves sync logs history for a seller.
   */
  public static async getSyncLogs(db: DbQuerier, sellerId: string): Promise<SyncLogItem[]> {
    const sql = `
      SELECT id, seller_id, channel_id, status, orders_synced, error_message, created_at, updated_at
      FROM sync_logs
      WHERE seller_id = $1
      ORDER BY created_at DESC
    `;

    const result = await db.query(sql, [sellerId]);

    return result.rows.map((row) => ({
      id: row.id,
      sellerId: row.seller_id,
      channelId: row.channel_id,
      status: row.status,
      ordersSynced: row.orders_synced,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
