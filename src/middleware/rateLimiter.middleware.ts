import { FastifyRequest, FastifyReply } from 'fastify';

interface RateLimiterOptions {
  max?: number;
  windowMs?: number;
}

export class RateLimiter {
  private attempts: Map<string, number[]> = new Map();
  private max: number;
  private windowMs: number;

  constructor(options: RateLimiterOptions = {}) {
    this.max = options.max ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000; // 15 minutes default
  }

  /**
   * Resets rate limiter memory (useful for testing).
   */
  public reset(): void {
    this.attempts.clear();
  }

  /**
   * Fastify preHandler middleware function for rate limiting.
   */
  public middleware = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ip = request.ip || '127.0.0.1';
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let userAttempts = this.attempts.get(ip) || [];

    // Filter out attempts outside the current window
    userAttempts = userAttempts.filter((timestamp) => timestamp > windowStart);

    if (userAttempts.length >= this.max) {
      const oldestAttempt = userAttempts[0];
      const retryAfterSeconds = Math.ceil((oldestAttempt + this.windowMs - now) / 1000);

      reply.header('Retry-After', retryAfterSeconds > 0 ? retryAfterSeconds : 1);
      reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Too many login attempts from this IP, please try again later.',
      });
      return;
    }

    // Record this attempt
    userAttempts.push(now);
    this.attempts.set(ip, userAttempts);
  };
}

export const defaultLoginRateLimiter = new RateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
export const loginRateLimiter = defaultLoginRateLimiter.middleware;
