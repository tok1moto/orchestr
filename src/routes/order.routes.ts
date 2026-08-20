import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticateJWT } from '../middleware/jwt.middleware';
import { OrderSyncService } from '../services/orderSync.service';

export default async function orderRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/orders (Retrieves normalized orders from PostgreSQL database)
  fastify.get('/api/orders', async (request, reply) => {
    try {
      const query = (request.query as any) || {};
      const { status, channelId, search } = query;
      const sellerId = (request as any).sellerId || query.sellerId || '11111111-1111-1111-1111-111111111111';

      if (!fastify.pg) {
        return reply.status(200).send({
          statusCode: 200,
          total: 2,
          orders: [
            {
              id: 'ord-1001',
              orderNumber: '#SH-9401',
              channelName: 'Shopify Store',
              channelType: 'shopify',
              customerName: 'Eleanor Vance',
              customerEmail: 'eleanor@example.com',
              itemsCount: 2,
              totalPrice: 179.98,
              currency: 'USD',
              status: status || 'pending',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'ord-1002',
              orderNumber: '#AMZ-88219',
              channelName: 'Amazon Store',
              channelType: 'amazon',
              customerName: 'Marcus Holloway',
              customerEmail: 'marcus@example.com',
              itemsCount: 1,
              totalPrice: 599.99,
              currency: 'USD',
              status: status || 'pending',
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }

      const orders = await OrderSyncService.getOrdersBySeller(fastify.pg, sellerId, {
        status,
        channelId,
        search,
      });

      return reply.status(200).send({
        statusCode: 200,
        total: orders.length,
        orders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          channelId: o.channelId,
          channelName: 'Shopify Store',
          channelType: 'shopify',
          customerName: o.customerName,
          customerEmail: o.customerEmail,
          itemsCount: o.lineItems.length,
          totalPrice: o.totalPrice,
          currency: o.currency,
          status: o.status,
          createdAt: o.createdAt,
        })),
      });
    } catch (err: any) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err.message || 'Failed to retrieve orders',
      });
    }
  });


  // POST /api/orders/sync (Triggers order polling for a channel and records sync log)
  fastify.post('/api/orders/sync', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId!;
      const { channelId } = (request.body as any) || {};

      let targetChannelId = channelId;

      // If no channelId provided, pick the first active channel for seller
      if (!targetChannelId) {
        const chRes = await fastify.pg.query(
          `SELECT id FROM channels WHERE seller_id = $1 AND status = 'active' LIMIT 1`,
          [sellerId]
        );
        if (chRes.rows.length === 0) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'No active channel found to sync orders',
          });
        }
        targetChannelId = chRes.rows[0].id;
      }

      const syncResult = await OrderSyncService.syncShopifyOrders(fastify.pg, sellerId, targetChannelId);

      return reply.status(200).send({
        statusCode: 200,
        message: 'Order sync completed successfully',
        syncLogId: syncResult.syncLogId,
        ordersSynced: syncResult.ordersSynced,
        orders: syncResult.orders,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 404 ? 'Not Found' : 'Internal Server Error',
        message: err.message || 'Order sync failed',
      });
    }
  });

  // GET /api/sync-logs (Retrieves sync logs history for seller)
  fastify.get('/api/sync-logs', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId!;
      const syncLogs = await OrderSyncService.getSyncLogs(fastify.pg, sellerId);

      return reply.status(200).send({
        statusCode: 200,
        total: syncLogs.length,
        syncLogs,
      });
    } catch (err: any) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err.message || 'Failed to retrieve sync logs',
      });
    }
  });

  // PATCH /api/orders/:id (Update order status)
  fastify.patch('/api/orders/:id', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId!;
      const { id } = request.params as any;
      const { status } = (request.body as any) || {};

      if (!status) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Status is required',
        });
      }

      const res = await fastify.pg.query(
        `UPDATE orders
         SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND seller_id = $3
         RETURNING id, order_number, status`,
        [status.toLowerCase(), id, sellerId]
      );

      if (res.rows.length === 0) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Order not found',
        });
      }

      return reply.status(200).send({
        statusCode: 200,
        message: 'Order status updated successfully',
        order: res.rows[0],
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
