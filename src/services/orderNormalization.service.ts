export interface NormalizedLineItem {
  id: string;
  title: string;
  quantity: number;
  price: number;
  sku: string;
}

export interface NormalizedOrder {
  externalOrderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  totalPrice: number;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string;
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
  lineItems: NormalizedLineItem[];
  rawData: Record<string, any>;
}

export class OrderNormalizationService {
  /**
   * Normalizes a raw Shopify order payload into Orchestr unified order schema.
   */
  public static normalizeShopifyOrder(rawOrder: any): NormalizedOrder {
    const externalOrderId = (rawOrder.id || rawOrder.admin_graphql_api_id || `shp_${Date.now()}`).toString();
    const orderNumber = rawOrder.name || (rawOrder.order_number ? `#${rawOrder.order_number}` : `#SH-${externalOrderId}`);

    // Customer Information
    let customerName = 'Guest Customer';
    if (rawOrder.customer) {
      const first = (rawOrder.customer.first_name || '').trim();
      const last = (rawOrder.customer.last_name || '').trim();
      const full = `${first} ${last}`.trim();
      if (full) customerName = full;
    } else if (rawOrder.billing_address) {
      const first = (rawOrder.billing_address.first_name || '').trim();
      const last = (rawOrder.billing_address.last_name || '').trim();
      const full = `${first} ${last}`.trim();
      if (full) customerName = full;
    }

    const customerEmail = rawOrder.customer?.email || rawOrder.email || 'customer@example.com';
    const totalPrice = parseFloat(rawOrder.total_price || rawOrder.current_total_price || '0.00');
    const currency = (rawOrder.currency || rawOrder.presentment_currency || 'USD').toUpperCase();

    const financialStatus = (rawOrder.financial_status || 'pending').toLowerCase();
    const fulfillmentStatus = (rawOrder.fulfillment_status || 'unfulfilled').toLowerCase();

    // Derive Unified Status
    let status: 'pending' | 'shipped' | 'delivered' | 'cancelled' = 'pending';
    if (rawOrder.cancelled_at || rawOrder.cancel_reason || financialStatus === 'voided') {
      status = 'cancelled';
    } else if (fulfillmentStatus === 'fulfilled') {
      status = 'delivered';
    } else if (fulfillmentStatus === 'partial' || fulfillmentStatus === 'in_transit') {
      status = 'shipped';
    } else {
      status = 'pending';
    }

    // Line Items Mapping
    const lineItems: NormalizedLineItem[] = (rawOrder.line_items || []).map((item: any, idx: number) => ({
      id: (item.id || item.variant_id || `item_${idx}`).toString(),
      title: item.title || item.name || 'Untitled Product',
      quantity: parseInt(item.quantity || 1, 10),
      price: parseFloat(item.price || '0.00'),
      sku: item.sku || `SKU-SHOPIFY-${item.variant_id || idx}`,
    }));

    return {
      externalOrderId,
      orderNumber,
      customerName,
      customerEmail,
      totalPrice,
      currency,
      financialStatus,
      fulfillmentStatus,
      status,
      lineItems,
      rawData: rawOrder,
    };
  }
}
