import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '../services/auth.service';

/**
 * Fastify preHandler middleware that authenticates requests using a JWT Bearer token.
 * Extracts user info and sellerId from the token payload and decorates request object.
 */
export const authenticateJWT = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = AuthService.verifyToken(token);
    request.user = payload;
    request.sellerId = payload.sellerId;
  } catch (err: any) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
    return;
  }
};
