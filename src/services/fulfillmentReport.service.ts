import { DbQuerier } from './auth.service';

export interface FulfillmentReportItem {
  id: string;
  sellerId: string;
  orderNumber: string;
  externalOrderId: string;
  channelId: string | null;
  channelName: string;
  channelType: string;
  customerName: string;
  customerEmail: string;
  itemsCount: number;
  lineItemsSummary: string;
  totalPrice: number;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string;
  status: string;
  trackingNumber: string;
  trackingCompany: string;
  createdAt: string;
  updatedAt: string;
}

export class FulfillmentReportService {
  /**
   * Retrieves orders for fulfillment reporting and converts to CSV or JSON format.
   */
  public static async getFulfillmentReport(
    db: DbQuerier,
    sellerId: string,
    filters?: { status?: string; format?: string }
  ): Promise<{ items: FulfillmentReportItem[]; csv: string; total: number }> {
    if (!sellerId) {
      const error: any = new Error('Seller ID is required');
      error.statusCode = 400;
      throw error;
    }

    const targetStatus = filters?.status && filters.status !== 'all' ? filters.status.toLowerCase().trim() : 'pending';

    const conditions: string[] = ['o.seller_id = $1'];
    const params: any[] = [sellerId];

    if (targetStatus && targetStatus !== 'all') {
      conditions.push(`LOWER(o.status) = $2`);
      params.push(targetStatus);
    }

    const sql = `
      SELECT o.id, o.seller_id, o.channel_id, c.name AS channel_name, c.type AS channel_type,
             o.external_order_id, o.order_number, o.customer_name, o.customer_email,
             o.total_price, o.currency, o.financial_status, o.fulfillment_status, o.status,
             o.tracking_number, o.tracking_company, o.line_items, o.created_at, o.updated_at
      FROM orders o
      LEFT JOIN channels c ON o.channel_id = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY o.created_at DESC
    `;

    const result = await db.query(sql, params);

    const items: FulfillmentReportItem[] = result.rows.map((row) => {
      let parsedLineItems: any[] = [];
      if (typeof row.line_items === 'string') {
        try { parsedLineItems = JSON.parse(row.line_items); } catch {}
      } else if (Array.isArray(row.line_items)) {
        parsedLineItems = row.line_items;
      }

      const summaryParts = parsedLineItems.map(
        (li) => `${li.title || 'Item'} (x${li.quantity || 1}) [SKU: ${li.sku || 'N/A'}]`
      );
      const lineItemsSummary = summaryParts.join('; ');

      return {
        id: row.id,
        sellerId: row.seller_id,
        orderNumber: row.order_number,
        externalOrderId: row.external_order_id,
        channelId: row.channel_id,
        channelName: row.channel_name || 'Direct Store',
        channelType: row.channel_type || 'custom',
        customerName: row.customer_name || 'Guest Customer',
        customerEmail: row.customer_email || 'N/A',
        itemsCount: parsedLineItems.length,
        lineItemsSummary: lineItemsSummary || 'No items listed',
        totalPrice: parseFloat(row.total_price || 0),
        currency: row.currency || 'USD',
        financialStatus: row.financial_status || 'paid',
        fulfillmentStatus: row.fulfillment_status || 'unfulfilled',
        status: row.status,
        trackingNumber: row.tracking_number || '',
        trackingCompany: row.tracking_company || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    const csv = this.convertToCSV(items);

    return {
      items,
      csv,
      total: items.length,
    };
  }

  /**
   * Converts FulfillmentReportItem array into RFC 4180 compliant CSV string format.
   */
  public static convertToCSV(items: FulfillmentReportItem[]): string {
    const headers = [
      'Order Number',
      'Channel',
      'Customer Name',
      'Customer Email',
      'Items Count',
      'Line Items Summary',
      'Total Price',
      'Currency',
      'Status',
      'Tracking Number',
      'Tracking Company',
      'Created At',
    ];

    const escapeCsv = (val: any): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    const rows = items.map((item) => [
      escapeCsv(item.orderNumber),
      escapeCsv(item.channelName),
      escapeCsv(item.customerName),
      escapeCsv(item.customerEmail),
      escapeCsv(item.itemsCount),
      escapeCsv(item.lineItemsSummary),
      escapeCsv(item.totalPrice.toFixed(2)),
      escapeCsv(item.currency),
      escapeCsv(item.status),
      escapeCsv(item.trackingNumber),
      escapeCsv(item.trackingCompany),
      escapeCsv(item.createdAt),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
