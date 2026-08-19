import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { AuthService, DbQuerier } from '../src/services/auth.service';
import { ChannelService } from '../src/services/channel.service';
import { encrypt, decrypt, encryptJson, decryptJson, maskCredentials } from '../src/utils/crypto.utils';
import channelRoutes from '../src/routes/channel.routes';

describe('Encryption & Security Utility (AES-256-GCM)', () => {
  it('encrypts and decrypts text correctly', () => {
    const plainText = 'shpat_test_secret_access_token_999';
    const ciphertext = encrypt(plainText);

    assert.notStrictEqual(ciphertext, plainText);
    assert.strictEqual(ciphertext.includes(':'), true);

    const decrypted = decrypt(ciphertext);
    assert.strictEqual(decrypted, plainText);
  });

  it('encrypts and decrypts JSON objects correctly', () => {
    const originalJson = { shop_domain: 'my-store.myshopify.com', access_token: 'shpat_token_abc' };
    const ciphertext = encryptJson(originalJson);

    const decrypted = decryptJson(ciphertext);
    assert.strictEqual(decrypted.shop_domain, originalJson.shop_domain);
    assert.strictEqual(decrypted.access_token, originalJson.access_token);
  });

  it('masks sensitive API token values in credentials payload', () => {
    const rawCreds = {
      shop_domain: 'test-store.myshopify.com',
      access_token: 'shpat_1234567890abcdef',
      connected_at: '2026-08-19T00:00:00Z',
    };

    const masked = maskCredentials(rawCreds);
    assert.strictEqual(masked.shop_domain, 'test-store.myshopify.com');
    assert.strictEqual(masked.access_token, 'shpa****cdef');
    assert.strictEqual(masked.connected_at, '2026-08-19T00:00:00Z');
  });
});

describe('Channel Service & Shopify Integration (Unit & Integration)', () => {
  let app: FastifyInstance;
  const mockChannelsDB: Map<string, any> = new Map();
  const mockProductsDB: Map<string, any> = new Map();

  const mockDbQuerier: DbQuerier = {
    async query(text: string, params: any[] = []) {
      const normalizedText = text.replace(/\s+/g, ' ').trim();

      // INSERT INTO channels
      if (normalizedText.includes('INSERT INTO channels')) {
        const id = `channel-uuid-${Math.random().toString(36).substring(2, 7)}`;
        const channel = {
          id,
          seller_id: params[0],
          name: params[1],
          type: params[2],
          credentials: params[3],
          status: params[4],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        mockChannelsDB.set(id, channel);
        return { rows: [channel], rowCount: 1 };
      }

      // SELECT channel by id
      if (normalizedText.includes('WHERE id = $1')) {
        const channelId = params[0];
        const channel = mockChannelsDB.get(channelId);
        return { rows: channel ? [channel] : [], rowCount: channel ? 1 : 0 };
      }

      // SELECT channels for seller
      if (normalizedText.includes('WHERE seller_id = $1')) {
        const sellerId = params[0];
        const channels = Array.from(mockChannelsDB.values()).filter((c) => c.seller_id === sellerId);
        return { rows: channels, rowCount: channels.length };
      }



      // UPDATE channels
      if (normalizedText.includes('UPDATE channels SET')) {
        const channelId = params[0];
        const channel = mockChannelsDB.get(channelId);
        if (!channel) return { rows: [], rowCount: 0 };

        let pIdx = 2;
        if (text.includes('name = $')) channel.name = params[pIdx++];
        if (text.includes('status = $')) channel.status = params[pIdx++];
        if (text.includes('credentials = $')) channel.credentials = params[pIdx++];
        channel.updated_at = new Date().toISOString();
        mockChannelsDB.set(channelId, channel);
        return { rows: [channel], rowCount: 1 };
      }

      // DELETE channels
      if (normalizedText.includes('DELETE FROM channels')) {
        const channelId = params[0];
        const existed = mockChannelsDB.has(channelId);
        mockChannelsDB.delete(channelId);
        return { rows: existed ? [{ id: channelId }] : [], rowCount: existed ? 1 : 0 };
      }

      // INSERT INTO products
      if (normalizedText.includes('INSERT INTO products')) {
        const sku = params[3];
        const id = `prod-uuid-${Math.random().toString(36).substring(2, 7)}`;
        const product = {
          id,
          seller_id: params[0],
          channel_id: params[1],
          title: params[2],
          sku,
          price: params[4],
          inventory_quantity: params[5],
          status: 'active',
        };
        mockProductsDB.set(sku, product);
        return { rows: [product], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  beforeEach(async () => {
    mockChannelsDB.clear();
    mockProductsDB.clear();

    app = Fastify({ logger: false });
    app.decorate('pg', mockDbQuerier as any);
    await app.register(channelRoutes);
  });

  it('initiateShopifyAuth generates valid Shopify OAuth URL', () => {
    const { authUrl, state } = ChannelService.initiateShopifyAuth('my-test-store.myshopify.com', 'seller-uuid-1');
    assert.ok(authUrl.includes('my-test-store.myshopify.com/admin/oauth/authorize'));
    assert.ok(authUrl.includes('client_id='));
    assert.ok(authUrl.includes('scope='));
    assert.ok(typeof state === 'string');
  });

  it('POST /api/channels with platform: shopify initiates OAuth flow', async () => {
    const token = AuthService.generateToken({ userId: 'u1', sellerId: 'seller-uuid-1', email: 's@test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        platform: 'shopify',
        shop: 'cool-gear-store.myshopify.com',
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.message, 'Shopify OAuth flow initiated');
    assert.ok(body.authUrl.includes('cool-gear-store.myshopify.com'));
  });

  it('POST /api/channels creates custom channel with encrypted credentials', async () => {
    const token = AuthService.generateToken({ userId: 'u1', sellerId: 'seller-uuid-1', email: 's@test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'My Custom Shopify Store',
        type: 'shopify',
        credentials: {
          shop_domain: 'acme-store.myshopify.com',
          access_token: 'shpat_secret_access_token_12345',
        },
      },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.channel.name, 'My Custom Shopify Store');
    assert.strictEqual(body.channel.type, 'shopify');
    // Verify credential masking
    assert.strictEqual(body.channel.credentials.access_token, 'shpa****2345');

  });

  it('GET /api/channels lists connected channels for seller', async () => {
    const token = AuthService.generateToken({ userId: 'u1', sellerId: 'seller-uuid-1', email: 's@test.com' });

    // Create 2 channels first
    await ChannelService.createChannel(mockDbQuerier, 'seller-uuid-1', {
      name: 'Shopify Store 1',
      type: 'shopify',
      credentials: { access_token: 'shpat_token_11111111' },
    });

    await ChannelService.createChannel(mockDbQuerier, 'seller-uuid-1', {
      name: 'Shopify Store 2',
      type: 'shopify',
      credentials: { access_token: 'shpat_token_22222222' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/channels',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.channels.length, 2);
  });

  it('GET /api/channels/shopify/callback completes OAuth and triggers product sync', async () => {
    const statePayload = Buffer.from(JSON.stringify({ sellerId: 'seller-uuid-1', nonce: '123' })).toString('base64');

    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/shopify/callback?shop=acme-online.myshopify.com&code=test_code_123&state=${statePayload}`,
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.message, 'Shopify channel connected and initial products synced successfully');
    assert.ok(body.channel.id);
    assert.ok(body.syncResult.syncedCount > 0);
  });

  it('POST /api/channels/:id/sync syncs products from Shopify to local database', async () => {
    const token = AuthService.generateToken({ userId: 'u1', sellerId: 'seller-uuid-1', email: 's@test.com' });

    // Create channel
    const channel = await ChannelService.createChannel(mockDbQuerier, 'seller-uuid-1', {
      name: 'Sync Shopify Store',
      type: 'shopify',
      credentials: { shop_domain: 'sync-store.myshopify.com', access_token: 'shpat_sync_token' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${channel.id}/sync`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.message, 'Shopify products synced successfully');
    assert.ok(body.syncResult.syncedCount > 0);
    assert.ok(mockProductsDB.size > 0);
  });
});
