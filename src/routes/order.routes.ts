import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticateJWT } from '../middleware/jwt.middleware';

export interface OrderItem {
  id: string;
  orderNumber: string;
  channelName: string;
  channelType: 'shopify' | 'amazon' | 'custom' | string;
  customerName: string;
  customerEmail: string;
  itemsCount: number;
  totalPrice: number;
  currency: string;
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: string;
}

// In-memory sample order store seeded per seller
const initialOrders: OrderItem[] = [
  {
    id: 'ord-1001',
    orderNumber: '#SH-9401',
    channelName: 'Acme Shopify Store',
    channelType: 'shopify',
    customerName: 'Eleanor Vance',
    customerEmail: 'eleanor@example.com',
    itemsCount: 2,
    totalPrice: 179.98,
    currency: 'USD',
    status: 'pending',
    createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: 'ord-1002',
    orderNumber: '#AMZ-88219',
    channelName: 'Amazon US Store',
    channelType: 'amazon',
    customerName: 'Marcus Holloway',
    customerEmail: 'marcus@example.com',
    itemsCount: 1,
    totalPrice: 599.99,
    currency: 'USD',
    status: 'shipped',
    createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
  {
    id: 'ord-1003',
    orderNumber: '#SH-9402',
    channelName: 'Acme Shopify Store',
    channelType: 'shopify',
    customerName: 'Sophia Lin',
    customerEmail: 'sophia@example.com',
    itemsCount: 3,
    totalPrice: 284.45,
    currency: 'USD',
    status: 'delivered',
    createdAt: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
  },
  {
    id: 'ord-1004',
    orderNumber: '#CUST-3041',
    channelName: 'Direct Wholesale Site',
    channelType: 'custom',
    customerName: 'Apex Distributors',
    customerEmail: 'orders@apexdist.com',
    itemsCount: 12,
    totalPrice: 1450.00,
    currency: 'USD',
    status: 'pending',
    createdAt: new Date(Date.now() - 1000 * 60 * 520).toISOString(),
  },
  {
    id: 'ord-1005',
    orderNumber: '#AMZ-88220',
    channelName: 'Amazon US Store',
    channelType: 'amazon',
    customerName: 'Daniel Thorne',
    customerEmail: 'daniel@example.com',
    itemsCount: 1,
    totalPrice: 34.50,
    currency: 'USD',
    status: 'delivered',
    createdAt: new Date(Date.now() - 1000 * 60 * 1440).toISOString(),
  },
];

let ordersStore: OrderItem[] = [...initialOrders];

export default async function orderRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/orders (Returns aggregated multi-channel orders)
  fastify.get('/api/orders', async (request, reply) => {
    try {
      const query = (request.query as any) || {};
      const { status, channel, search } = query;

      let filtered = [...ordersStore];

      if (status && status !== 'all') {
        filtered = filtered.filter((o) => o.status.toLowerCase() === status.toLowerCase());
      }

      if (channel && channel !== 'all') {
        filtered = filtered.filter((o) => o.channelType.toLowerCase() === channel.toLowerCase());
      }

      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(
          (o) =>
            o.orderNumber.toLowerCase().includes(s) ||
            o.customerName.toLowerCase().includes(s) ||
            o.customerEmail.toLowerCase().includes(s) ||
            o.channelName.toLowerCase().includes(s)
        );
      }

      return reply.status(200).send({
        statusCode: 200,
        total: filtered.length,
        orders: filtered,
      });
    } catch (err: any) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err.message || 'Failed to retrieve orders',
      });
    }
  });

  // PATCH /api/orders/:id (Update order status)
  fastify.patch('/api/orders/:id', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const { id } = request.params as any;
      const { status } = (request.body as any) || {};

      const index = ordersStore.findIndex((o) => o.id === id);
      if (index === -1) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Order not found',
        });
      }

      if (status) {
        ordersStore[index].status = status;
      }

      return reply.status(200).send({
        statusCode: 200,
        message: 'Order status updated successfully',
        order: ordersStore[index],
      });
    } catch (err: any) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err.message || 'Failed to update order',
      });
    }
  });
}
