import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { AuthService } from '../services/auth.service';
import { loginRateLimiter } from '../middleware/rateLimiter.middleware';
import { authenticateJWT } from '../middleware/jwt.middleware';

export default async function authRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // POST /auth/register
  fastify.post('/auth/register', async (request, reply) => {
    try {
      const body = request.body as any || {};
      const result = await AuthService.registerUser(fastify.pg, body);
      return reply.status(201).send(result);
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 400 ? 'Bad Request' : 'Internal Server Error',
        message: err.message || 'Registration failed',
      });
    }
  });

  // POST /auth/login (protected by rate limiter)
  fastify.post('/auth/login', { preHandler: [loginRateLimiter] }, async (request, reply) => {
    try {
      const body = request.body as any || {};
      const result = await AuthService.loginUser(fastify.pg, body);
      return reply.status(200).send(result);
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 401 ? 'Unauthorized' : statusCode === 400 ? 'Bad Request' : 'Internal Server Error',
        message: err.message || 'Login failed',
      });
    }
  });

  // GET /auth/me (Protected route extracting seller ID from token)
  fastify.get('/auth/me', { preHandler: [authenticateJWT] }, async (request, reply) => {
    return reply.status(200).send({
      message: 'Authenticated successfully',
      user: request.user,
      sellerId: request.sellerId,
    });
  });

  // POST /auth/forgot-password
  fastify.post('/auth/forgot-password', async (request, reply) => {
    try {
      const { email } = (request.body as any) || {};
      const result = await AuthService.forgotPassword(fastify.pg, email);
      return reply.status(200).send({
        statusCode: 200,
        ...result,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 400 ? 'Bad Request' : 'Internal Server Error',
        message: err.message || 'Forgot password request failed',
      });
    }
  });

  // POST /auth/reset-password
  fastify.post('/auth/reset-password', async (request, reply) => {
    try {
      const { token, newPassword } = (request.body as any) || {};
      const result = await AuthService.resetPassword(fastify.pg, token, newPassword);
      return reply.status(200).send({
        statusCode: 200,
        ...result,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode === 400 ? 'Bad Request' : 'Internal Server Error',
        message: err.message || 'Password reset failed',
      });
    }
  });
}

