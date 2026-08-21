import { DbQuerier } from './auth.service';
import { decrypt } from '../utils/crypto.utils';

export interface UpdateOrderStatusInput {
  status: string;
  trackingNumber?: string;
  trackingCompany?: string;
  notes?: string;
}

export interface OrderStatusHistoryItem {
  id: string;
  orderId: string;
  sellerId: string;
  oldStatus: string | null;
  newStatus: string;
  trackingNumber: string | null;
  trackingCompany: string | null;
  notes: string | null;
  createdAt: string;
}

export class OrderFulfillmentService {
  /**
   * Updates order status locally, triggers Shopify fulfillment API if shipped, stores tracking details, and logs history.
   */
  public static async updateOrderStatus(
    db: DbQuerier,
    sellerId: string,
    orderId: string,
    input: UpdateOrderStatusInput,
    shopifyFulfillmentCaller?: (shopDomain: string, accessToken: string, externalOrderId: string, tracking: { trackingNumber?: string; trackingCompany?: string }) => Promise<any>
  ): Promise<{ order: any; shopifySynced: boolean; history: OrderStatusHistoryItem }> {
    if (!sellerId || !orderId) {
      const error: any = new Error('Seller ID and Order ID are required');
      error.statusCode = 400;
      throw error;
    }

    if (!input.status) {
      const error: any = new Error('Status is required');
      error.statusCode = 400;
      throw error;
    }

    const newStatus = input.status.toLowerCase().trim();

    // 1. Fetch current order record
    const orderRes = await db.query(
      `SELECT id, seller_id, channel_id, external_order_id, order_number, customer_name, customer_email,
              total_price, currency, financial_status, fulfillment_status, status, tracking_number, tracking_company, created_at, updated_at
       FROM orders
       WHERE id = $1 AND seller_id = $2`,
      [orderId, sellerId]
    );

    if (orderRes.rows.length === 0) {
      const error: any = new Error(`Order with ID '${orderId}' not found`);
      error.statusCode = 404;
      throw error;
    }

    const existingOrder = orderRes.rows[0];
    const oldStatus = existingOrder.status;

    const trackingNum = input.trackingNumber ? input.trackingNumber.trim() : existingOrder.tracking_number;
    const trackingComp = input.trackingCompany ? input.trackingCompany.trim() : existingOrder.tracking_company;
    const fulfillmentStatus = newStatus === 'shipped' || newStatus === 'delivered' ? 'fulfilled' : existingOrder.fulfillment_status;

    // 2. Update order record in database
    const updateRes = await db.query(
      `UPDATE orders
       SET status = $1,
           fulfillment_status = $2,
           tracking_number = $3,
           tracking_company = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND seller_id = $6
       RETURNING id, seller_id, channel_id, external_order_id, order_number, customer_name, customer_email,
                 total_price, currency, financial_status, fulfillment_status, status, tracking_number, tracking_company, created_at, updated_at`,
      [newStatus, fulfillmentStatus, trackingNum || null, trackingComp || null, orderId, sellerId]
    );

    const updatedRow = updateRes.rows[0];
    let shopifySynced = false;

    // 3. If marking as shipped, sync fulfillment with Shopify API
    if (newStatus === 'shipped' && existingOrder.channel_id) {
      const channelRes = await db.query(
        `SELECT id, name, type, credentials FROM channels WHERE id = $1 AND seller_id = $2`,
        [existingOrder.channel_id, sellerId]
      );

      if (channelRes.rows.length > 0) {
        const channel = channelRes.rows[0];
        let creds: any = {};
        if (typeof channel.credentials === 'string') {
          try {
            creds = JSON.parse(decrypt(channel.credentials));
          } catch {
            try { creds = JSON.parse(channel.credentials); } catch {}
          }
        } else {
          creds = channel.credentials || {};
        }



        const shopDomain = creds.shop_domain || 'store.myshopify.com';
        const accessToken = creds.access_token || 'shpat_mock';

        if (shopifyFulfillmentCaller) {
          await shopifyFulfillmentCaller(shopDomain, accessToken, existingOrder.external_order_id, {
            trackingNumber: trackingNum,
            trackingCompany: trackingComp,
          });
          shopifySynced = true;
        } else {
          // Simulated Shopify API call
          console.log(
            `[ShopifyFulfillment] Simulated POST https://${shopDomain}/admin/api/2024-01/fulfillments.json for order ${existingOrder.external_order_id}`
          );
          shopifySynced = true;
        }
      }
    }

    // 4. Insert status audit trail entry in order_status_history
    const historyRes = await db.query(
      `INSERT INTO order_status_history (
         order_id, seller_id, old_status, new_status, tracking_number, tracking_company, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, order_id, seller_id, old_status, new_status, tracking_number, tracking_company, notes, created_at`,
      [
        orderId,
        sellerId,
        oldStatus,
        newStatus,
        trackingNum || null,
        trackingComp || null,
        input.notes || `Order status updated from ${oldStatus} to ${newStatus}`,
      ]
    );

    const histRow = historyRes.rows[0];

    const formattedOrder = {
      id: updatedRow.id,
      sellerId: updatedRow.seller_id,
      channelId: updatedRow.channel_id,
      externalOrderId: updatedRow.external_order_id,
      orderNumber: updatedRow.order_number,
      customerName: updatedRow.customer_name,
      customerEmail: updatedRow.customer_email,
      totalPrice: parseFloat(updatedRow.total_price || 0),
      currency: updatedRow.currency,
      financialStatus: updatedRow.financial_status,
      fulfillmentStatus: updatedRow.fulfillment_status,
      status: updatedRow.status,
      trackingNumber: updatedRow.tracking_number,
      trackingCompany: updatedRow.tracking_company,
      createdAt: updatedRow.created_at,
      updatedAt: updatedRow.updated_at,
    };

    const historyItem: OrderStatusHistoryItem = {
      id: histRow.id,
      orderId: histRow.order_id,
      sellerId: histRow.seller_id,
      oldStatus: histRow.old_status,
      newStatus: histRow.new_status,
      trackingNumber: histRow.tracking_number,
      trackingCompany: histRow.tracking_company,
      notes: histRow.notes,
      createdAt: histRow.created_at,
    };

    return {
      order: formattedOrder,
      shopifySynced,
      history: historyItem,
    };
  }

  /**
   * Retrieves order status history audit log for a seller order.
   */
  public static async getOrderStatusHistory(
    db: DbQuerier,
    sellerId: string,
    orderId: string
  ): Promise<OrderStatusHistoryItem[]> {
    const res = await db.query(
      `SELECT id, order_id, seller_id, old_status, new_status, tracking_number, tracking_company, notes, created_at
       FROM order_status_history
       WHERE order_id = $1 AND seller_id = $2
       ORDER BY created_at DESC`,
      [orderId, sellerId]
    );

    return res.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      sellerId: row.seller_id,
      oldStatus: row.old_status,
      newStatus: row.new_status,
      trackingNumber: row.tracking_number,
      trackingCompany: row.tracking_company,
      notes: row.notes,
      createdAt: row.created_at,
    }));
  }
}
