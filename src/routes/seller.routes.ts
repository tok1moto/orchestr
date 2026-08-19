import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { SellerService } from '../services/seller.service';
import { authenticateJWT } from '../middleware/jwt.middleware';

export default async function sellerRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/sellers/me (Authenticated endpoint returning seller profile)
  fastify.get('/api/sellers/me', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId || request.user?.sellerId;
      if (!sellerId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Seller ID missing from authentication token',
        });
      }

      const profile = await SellerService.getProfile(fastify.pg, sellerId);
      return reply.status(200).send({
        statusCode: 200,
        seller: profile,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 404 ? 'Not Found' : 'Internal Server Error',
        message: err.message || 'Failed to retrieve seller profile',
      });
    }
  });

  // PATCH /api/sellers/me (Authenticated endpoint updating company name, timezone, notification preferences)
  fastify.patch('/api/sellers/me', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId || request.user?.sellerId;
      if (!sellerId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Seller ID missing from authentication token',
        });
      }

      const body = (request.body as any) || {};
      const updatedProfile = await SellerService.updateProfile(fastify.pg, sellerId, body);
      return reply.status(200).send({
        statusCode: 200,
        message: 'Seller profile updated successfully',
        seller: updatedProfile,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 404 ? 'Not Found' : statusCode === 400 ? 'Bad Request' : 'Internal Server Error',
        message: err.message || 'Failed to update seller profile',
      });
    }
  });
}
