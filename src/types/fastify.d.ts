import 'fastify';

export interface AuthUser {
  userId: string;
  sellerId: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    sellerId?: string;
  }
}
