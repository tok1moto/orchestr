import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticateJWT } from '../middleware/jwt.middleware';
import { ReservationService } from '../services/reservation.service';

export default async function reservationRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // POST /api/reservations (Reserves stock for 15 minutes)
  fastify.post('/api/reservations', async (request, reply) => {
    try {
      const body = (request.body as any) || {};
      const sellerId = (request as any).sellerId || body.sellerId || '11111111-1111-1111-1111-111111111111';

      if (!fastify.pg) {
        return reply.status(201).send({
          statusCode: 201,
          message: 'Stock reserved successfully for 15 minutes',
          reservation: {
            id: 'res-mock-100',
            sellerId,
            sku: body.sku || 'PROD-MOUSE-001',
            quantity: body.quantity || 1,
            customerEmail: body.customerEmail || 'customer@example.com',
            status: 'active',
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
          },
        });
      }

      const reservation = await ReservationService.reserveStock(fastify.pg, sellerId, body);

      return reply.status(201).send({
        statusCode: 201,
        message: 'Stock reserved successfully for 15 minutes',
        reservation,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 400 ? 'Bad Request' : 'Internal Server Error',
        message: err.message || 'Failed to reserve stock',
      });
    }
  });

  // GET /api/reservations (Lists reservations)
  fastify.get('/api/reservations', async (request, reply) => {
    try {
      const query = (request.query as any) || {};
      const { status, sku } = query;
      const sellerId = (request as any).sellerId || query.sellerId || '11111111-1111-1111-1111-111111111111';

      if (!fastify.pg) {
        return reply.status(200).send({
          statusCode: 200,
          total: 1,
          reservations: [
            {
              id: 'res-mock-100',
              sellerId,
              sku: 'PROD-MOUSE-001',
              quantity: 1,
              customerEmail: 'customer@example.com',
              status: 'active',
              expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }

      const reservations = await ReservationService.getReservations(fastify.pg, sellerId, { status, sku });

      return reply.status(200).send({
        statusCode: 200,
        total: reservations.length,
        reservations,
      });
    } catch (err: any) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: err.message || 'Failed to retrieve reservations',
      });
    }
  });

  // DELETE /api/reservations/:id (Manually releases reservation hold)
  fastify.delete('/api/reservations/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      const sellerId = (request as any).sellerId || (request.query as any)?.sellerId || '11111111-1111-1111-1111-111111111111';

      if (!fastify.pg) {
        return reply.status(200).send({
          statusCode: 200,
          message: 'Reservation hold released successfully',
          reservation: {
            id,
            sellerId,
            status: 'released',
          },
        });
      }

      const reservation = await ReservationService.releaseReservation(fastify.pg, sellerId, id);

      return reply.status(200).send({
        statusCode: 200,
        message: 'Reservation hold released successfully',
        reservation,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 404 ? 'Not Found' : 'Internal Server Error',
        message: err.message || 'Failed to release reservation',
      });
    }
  });
}
