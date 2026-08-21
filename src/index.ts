import path from 'path';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import dbPlugin from './plugins/db';
import authRoutes from './routes/auth.routes';
import sellerRoutes from './routes/seller.routes';
import channelRoutes from './routes/channel.routes';
import orderRoutes from './routes/order.routes';
import productRoutes from './routes/product.routes';
import reservationRoutes from './routes/reservation.routes';
import fulfillmentRoutes from './routes/fulfillment.routes';
import healthRoutes from './routes/health.routes';

dotenv.config();

const server = Fastify({
  logger: true,
});

server.register(fastifyStatic, {
  root: path.join(process.cwd(), 'public'),
  prefix: '/',
});

server.register(dbPlugin);
server.register(authRoutes);
server.register(sellerRoutes);
server.register(channelRoutes);
server.register(orderRoutes);
server.register(productRoutes);
server.register(reservationRoutes);
server.register(fulfillmentRoutes);
server.register(healthRoutes);





server.get('/api', async () => {
  return {
    name: 'Orchestr API',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      health: 'GET /health',
      register: 'POST /auth/register',
      login: 'POST /auth/login',
      myProfile: 'GET /api/sellers/me',
      updateProfile: 'PATCH /api/sellers/me',
      channels: 'GET /api/channels',
      createChannel: 'POST /api/channels',
      syncChannelProducts: 'POST /api/channels/:id/sync',
      syncLogsDashboard: 'GET /api/sync-logs/dashboard',
    },
  };
});


import { OrderSyncQueue } from './queues/orderSync.queue';
import { InventorySyncQueue } from './queues/inventorySync.queue';
import { ReservationExpiryQueue } from './queues/reservationExpiry.queue';

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';
    await server.listen({ port, host });
    console.log(`Server running on http://${host}:${port}`);

    // Start background schedulers (Order sync, Inventory sync, Reservation 1-min expiry cleanup)
    OrderSyncQueue.startOrderSyncScheduler(server.pg);
    InventorySyncQueue.startInventorySyncScheduler(server.pg);
    ReservationExpiryQueue.startReservationExpiryScheduler(server.pg);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
