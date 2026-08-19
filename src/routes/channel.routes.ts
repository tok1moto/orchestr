import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ChannelService } from '../services/channel.service';
import { authenticateJWT } from '../middleware/jwt.middleware';

export default async function channelRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // Public Shopify OAuth Callback Endpoint
  fastify.get('/api/channels/shopify/callback', async (request, reply) => {
    try {
      const query = (request.query as any) || {};
      const result = await ChannelService.handleShopifyCallback(fastify.pg, query);
      return reply.status(200).send({
        statusCode: 200,
        message: 'Shopify channel connected and initial products synced successfully',
        channel: result.channel,
        syncResult: result.syncResult,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 400 ? 'Bad Request' : 'Internal Server Error',
        message: err.message || 'Shopify OAuth callback failed',
      });
    }
  });

  // Public Shopify OAuth Initiate Endpoint (optional query)
  fastify.get('/api/channels/shopify/auth', async (request, reply) => {
    try {
      const query = (request.query as any) || {};
      const shop = query.shop;
      const sellerId = query.sellerId || 'default-seller';
      const result = ChannelService.initiateShopifyAuth(shop, sellerId);
      return reply.status(200).send({
        statusCode: 200,
        authUrl: result.authUrl,
        state: result.state,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      return reply.status(statusCode).send({
        statusCode,
        error: 'Bad Request',
        message: err.message || 'Failed to initiate Shopify OAuth',
      });
    }
  });

  // POST /api/channels (Create channel OR initiate OAuth)
  fastify.post('/api/channels', { preHandler: [authenticateJWT] }, async (request, reply) => {
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
      const platform = (body.platform || body.type || '').toLowerCase();

      // If initiating Shopify OAuth with shop domain
      if (platform === 'shopify' && (body.shop || body.shop_domain) && !body.credentials) {
        const shop = body.shop || body.shop_domain;
        const authData = ChannelService.initiateShopifyAuth(shop, sellerId);
        return reply.status(200).send({
          statusCode: 200,
          message: 'Shopify OAuth flow initiated',
          platform: 'shopify',
          authUrl: authData.authUrl,
          state: authData.state,
        });
      }

      // Direct channel creation
      const channel = await ChannelService.createChannel(fastify.pg, sellerId, {
        name: body.name || `${platform.toUpperCase()} Channel`,
        type: platform || 'custom',
        credentials: body.credentials || {},
        status: body.status || 'active',
      });

      return reply.status(201).send({
        statusCode: 201,
        message: 'Channel created successfully',
        channel,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 400 ? 'Bad Request' : 'Internal Server Error',
        message: err.message || 'Failed to create channel',
      });
    }
  });

  // GET /api/channels (List all channels for authenticated seller)
  fastify.get('/api/channels', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId || request.user?.sellerId;
      if (!sellerId) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Seller ID missing from authentication token',
        });
      }

      const channels = await ChannelService.getChannels(fastify.pg, sellerId);
      return reply.status(200).send({
        statusCode: 200,
        channels,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: 'Internal Server Error',
        message: err.message || 'Failed to retrieve channels',
      });
    }
  });

  // GET /api/channels/:id (Get channel details)
  fastify.get('/api/channels/:id', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId || request.user?.sellerId;
      const channelId = (request.params as any).id;

      if (!sellerId) {
        return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Seller ID missing' });
      }

      const channel = await ChannelService.getChannelById(fastify.pg, sellerId, channelId);
      return reply.status(200).send({ statusCode: 200, channel });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 404 ? 'Not Found' : 'Internal Server Error',
        message: err.message || 'Failed to retrieve channel',
      });
    }
  });

  // PATCH /api/channels/:id (Update channel details or status)
  fastify.patch('/api/channels/:id', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId || request.user?.sellerId;
      const channelId = (request.params as any).id;
      const body = (request.body as any) || {};

      if (!sellerId) {
        return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Seller ID missing' });
      }

      const channel = await ChannelService.updateChannel(fastify.pg, sellerId, channelId, body);
      return reply.status(200).send({
        statusCode: 200,
        message: 'Channel updated successfully',
        channel,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 404 ? 'Not Found' : 'Internal Server Error',
        message: err.message || 'Failed to update channel',
      });
    }
  });

  // DELETE /api/channels/:id (Disconnect channel)
  fastify.delete('/api/channels/:id', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId || request.user?.sellerId;
      const channelId = (request.params as any).id;

      if (!sellerId) {
        return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Seller ID missing' });
      }

      await ChannelService.deleteChannel(fastify.pg, sellerId, channelId);
      return reply.status(200).send({
        statusCode: 200,
        message: 'Channel disconnected successfully',
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 404 ? 'Not Found' : 'Internal Server Error',
        message: err.message || 'Failed to delete channel',
      });
    }
  });

  // POST /api/channels/:id/sync (Trigger product sync from channel)
  fastify.post('/api/channels/:id/sync', { preHandler: [authenticateJWT] }, async (request, reply) => {
    try {
      const sellerId = request.sellerId || request.user?.sellerId;
      const channelId = (request.params as any).id;

      if (!sellerId) {
        return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Seller ID missing' });
      }

      const syncResult = await ChannelService.syncShopifyProducts(fastify.pg, sellerId, channelId);
      return reply.status(200).send({
        statusCode: 200,
        message: 'Shopify products synced successfully',
        syncResult,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 404 ? 'Not Found' : 'Internal Server Error',
        message: err.message || 'Product sync failed',
      });
    }
  });
}
