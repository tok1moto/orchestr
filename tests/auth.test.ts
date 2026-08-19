import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { AuthService, DbQuerier } from '../src/services/auth.service';
import { RateLimiter } from '../src/middleware/rateLimiter.middleware';
import { authenticateJWT } from '../src/middleware/jwt.middleware';
import authRoutes from '../src/routes/auth.routes';

describe('Auth Service - Password Hashing & JWT', () => {
  it('hashes password and verifies match correctly', async () => {
    const plainText = 'SecurePass123!';
    const hash = await AuthService.hashPassword(plainText);

    assert.notStrictEqual(plainText, hash);
    assert.strictEqual(await AuthService.comparePassword(plainText, hash), true);
    assert.strictEqual(await AuthService.comparePassword('WrongPassword', hash), false);
  });

  it('generates and verifies JWT token with userId, sellerId, email', () => {
    const payload = {
      userId: 'user-uuid-1234',
      sellerId: 'seller-uuid-5678',
      email: 'merchant@example.com',
    };

    const token = AuthService.generateToken(payload);
    assert.ok(typeof token === 'string');
    assert.ok(token.length > 0);

    const decoded = AuthService.verifyToken(token);
    assert.strictEqual(decoded.userId, payload.userId);
    assert.strictEqual(decoded.sellerId, payload.sellerId);
    assert.strictEqual(decoded.email, payload.email);
  });

  it('throws when verifying invalid token', () => {
    assert.throws(() => {
      AuthService.verifyToken('invalid.jwt.token');
    });
  });
});

describe('Rate Limiter Middleware', () => {
  it('blocks request after 5 attempts from same IP', async () => {
    const rateLimiterInstance = new RateLimiter({ max: 5, windowMs: 60000 });
    const fastify = Fastify({ logger: false });

    fastify.post('/test-limit', { preHandler: [rateLimiterInstance.middleware] }, async () => {
      return { success: true };
    });

    // First 5 requests should succeed (200)
    for (let i = 1; i <= 5; i++) {
      const res = await fastify.inject({
        method: 'POST',
        url: '/test-limit',
        remoteAddress: '192.168.1.100',
      });
      assert.strictEqual(res.statusCode, 200, `Request ${i} should succeed`);
    }

    // 6th request from same IP should be blocked (429)
    const resBlocked = await fastify.inject({
      method: 'POST',
      url: '/test-limit',
      remoteAddress: '192.168.1.100',
    });
    assert.strictEqual(resBlocked.statusCode, 429);
    const body = JSON.parse(resBlocked.payload);
    assert.strictEqual(body.statusCode, 429);
    assert.strictEqual(body.error, 'Too Many Requests');

    // Request from a different IP should succeed
    const resOtherIp = await fastify.inject({
      method: 'POST',
      url: '/test-limit',
      remoteAddress: '192.168.1.101',
    });
    assert.strictEqual(resOtherIp.statusCode, 200);

    await fastify.close();
  });
});

describe('Auth Endpoints & Protected Routes (Integration)', () => {
  let app: FastifyInstance;
  const mockUsersDB: Map<string, any> = new Map();
  const mockSellersDB: Map<string, any> = new Map();

  const mockDbQuerier: DbQuerier = {
    async query(text: string, params: any[] = []) {
      const normalizedText = text.replace(/\s+/g, ' ').trim();

      // Check existing user: SELECT id FROM users WHERE email = $1
      if (normalizedText.includes('SELECT id FROM users WHERE email')) {
        const email = params[0];
        const user = Array.from(mockUsersDB.values()).find((u) => u.email === email);
        return { rows: user ? [{ id: user.id }] : [], rowCount: user ? 1 : 0 };
      }

      // Find user for login: SELECT id, email, name, password_hash, seller_id FROM users WHERE email = $1
      if (normalizedText.includes('SELECT id, email, name, password_hash, seller_id FROM users')) {
        const email = params[0];
        const user = Array.from(mockUsersDB.values()).find((u) => u.email === email);
        return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
      }

      // Insert seller
      if (normalizedText.includes('INSERT INTO sellers')) {
        const id = `seller-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const seller = { id, name: params[0], email: params[1] };
        mockSellersDB.set(id, seller);
        return { rows: [{ id }], rowCount: 1 };
      }

      // Insert user
      if (normalizedText.includes('INSERT INTO users')) {
        const userEmail = params[0];
        const id = `user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const user = {
          id,
          email: userEmail,
          name: params[1],
          password_hash: params[2],
          seller_id: params[3],
          created_at: new Date().toISOString(),
        };
        mockUsersDB.set(userEmail, user);
        return { rows: [user], rowCount: 1 };
      }


      return { rows: [], rowCount: 0 };
    },
  };

  beforeEach(async () => {
    mockUsersDB.clear();
    mockSellersDB.clear();

    app = Fastify({ logger: false });
    app.decorate('pg', mockDbQuerier as any);
    await app.register(authRoutes);
  });

  it('POST /auth/register creates user and returns JWT token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'test@merchant.com',
        password: 'Password123',
        name: 'Test Merchant',
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.ok(body.token);
    assert.strictEqual(body.user.email, 'test@merchant.com');
    assert.strictEqual(body.user.name, 'Test Merchant');
    assert.ok(body.user.sellerId);

    // Verify token validity and content
    const decoded = AuthService.verifyToken(body.token);
    assert.strictEqual(decoded.email, 'test@merchant.com');
    assert.strictEqual(decoded.sellerId, body.user.sellerId);
  });

  it('POST /auth/register rejects duplicate email', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'duplicate@merchant.com',
        password: 'Password123',
      },
    });

    const res2 = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'duplicate@merchant.com',
        password: 'Password123',
      },
    });

    assert.strictEqual(res2.statusCode, 400);
    const body = JSON.parse(res2.payload);
    assert.strictEqual(body.message, 'User already exists with this email');
  });

  it('POST /auth/login authenticates user and returns JWT token', async () => {
    // First register
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'login@merchant.com',
        password: 'MySecretPassword',
        name: 'Login Merchant',
      },
    });

    // Login with valid credentials
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'login@merchant.com',
        password: 'MySecretPassword',
      },
    });

    assert.strictEqual(loginRes.statusCode, 200);
    const body = JSON.parse(loginRes.payload);
    assert.ok(body.token);
    assert.strictEqual(body.user.email, 'login@merchant.com');
    assert.ok(body.user.sellerId);

    // Login with invalid password
    const badPassRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'login@merchant.com',
        password: 'WrongPassword',
      },
    });
    assert.strictEqual(badPassRes.statusCode, 401);
  });

  it('GET /auth/me protects route and extracts seller ID', async () => {
    // Register to get valid token
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'protected@merchant.com',
        password: 'ProtectedPassword',
      },
    });

    const { token, user } = JSON.parse(regRes.payload);

    // Request without token should fail
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/auth/me',
    });
    assert.strictEqual(unauthRes.statusCode, 401);

    // Request with valid token should succeed and return user + sellerId
    const authRes = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(authRes.statusCode, 200);
    const authBody = JSON.parse(authRes.payload);
    assert.strictEqual(authBody.sellerId, user.sellerId);
    assert.strictEqual(authBody.user.email, 'protected@merchant.com');
  });
});
