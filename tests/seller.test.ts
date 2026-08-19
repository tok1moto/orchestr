import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { AuthService, DbQuerier } from '../src/services/auth.service';
import { SellerService } from '../src/services/seller.service';
import sellerRoutes from '../src/routes/seller.routes';

describe('Seller Profile Service & API (Unit & Integration)', () => {
  let app: FastifyInstance;
  const mockSellersDB: Map<string, any> = new Map();

  const mockDbQuerier: DbQuerier = {
    async query(text: string, params: any[] = []) {
      const normalizedText = text.replace(/\s+/g, ' ').trim();

      // SELECT seller profile
      if (normalizedText.includes('SELECT id, name, email, company_name, timezone, notification_preferences')) {
        const sellerId = params[0];
        const seller = mockSellersDB.get(sellerId);
        return { rows: seller ? [seller] : [], rowCount: seller ? 1 : 0 };
      }

      // UPDATE seller profile
      if (normalizedText.includes('UPDATE sellers SET')) {
        const sellerId = params[0];
        const seller = mockSellersDB.get(sellerId);
        if (!seller) {
          return { rows: [], rowCount: 0 };
        }

        let paramIdx = 1;
        if (/\bcompany_name = \$/.test(text)) {
          seller.company_name = params[paramIdx++];
        }
        if (/\bname = \$/.test(text)) {
          seller.name = params[paramIdx++];
        }
        if (/\btimezone = \$/.test(text)) {
          seller.timezone = params[paramIdx++];
        }
        if (/\bnotification_preferences = \$/.test(text)) {
          let val = params[paramIdx++];
          if (typeof val === 'string') {
            try {
              val = JSON.parse(val);
            } catch {}
          }
          seller.notification_preferences = val;
        }

        seller.updated_at = new Date().toISOString();
        mockSellersDB.set(sellerId, seller);

        return { rows: [seller], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  beforeEach(async () => {
    mockSellersDB.clear();

    // Insert a default test seller into mock DB
    mockSellersDB.set('seller-uuid-100', {
      id: 'seller-uuid-100',
      name: 'Acme Merchant',
      email: 'seller@acme.com',
      company_name: 'Acme Corporation',
      timezone: 'America/New_York',
      notification_preferences: { email_alerts: true, order_updates: true },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    app = Fastify({ logger: false });
    app.decorate('pg', mockDbQuerier as any);
    await app.register(sellerRoutes);
  });

  it('SellerService.getProfile returns formatted seller profile', async () => {
    const profile = await SellerService.getProfile(mockDbQuerier, 'seller-uuid-100');
    assert.strictEqual(profile.id, 'seller-uuid-100');
    assert.strictEqual(profile.name, 'Acme Merchant');
    assert.strictEqual(profile.email, 'seller@acme.com');
    assert.strictEqual(profile.companyName, 'Acme Corporation');
    assert.strictEqual(profile.timezone, 'America/New_York');
    assert.strictEqual(profile.notificationPreferences.email_alerts, true);
  });

  it('SellerService.getProfile throws 404 for unknown seller ID', async () => {
    await assert.rejects(
      async () => {
        await SellerService.getProfile(mockDbQuerier, 'non-existent-seller');
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.message, 'Seller profile not found');
        return true;
      }
    );
  });

  it('GET /api/sellers/me returns 401 Unauthorized when token is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sellers/me',
    });

    assert.strictEqual(res.statusCode, 401);
  });

  it('GET /api/sellers/me returns seller profile for authenticated seller', async () => {
    const token = AuthService.generateToken({
      userId: 'user-uuid-1',
      sellerId: 'seller-uuid-100',
      email: 'seller@acme.com',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/sellers/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.strictEqual(body.seller.id, 'seller-uuid-100');
    assert.strictEqual(body.seller.companyName, 'Acme Corporation');
    assert.strictEqual(body.seller.timezone, 'America/New_York');
  });

  it('PATCH /api/sellers/me updates company name, timezone, and notification preferences', async () => {
    const token = AuthService.generateToken({
      userId: 'user-uuid-1',
      sellerId: 'seller-uuid-100',
      email: 'seller@acme.com',
    });

    const updatePayload = {
      companyName: 'Acme Enterprise Global',
      timezone: 'Asia/Tokyo',
      notificationPreferences: { email_alerts: false, order_updates: true, sms_alerts: true },
    };

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sellers/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: updatePayload,
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.message, 'Seller profile updated successfully');
    assert.strictEqual(body.seller.companyName, 'Acme Enterprise Global');
    assert.strictEqual(body.seller.timezone, 'Asia/Tokyo');
    assert.strictEqual(body.seller.notificationPreferences.email_alerts, false);
    assert.strictEqual(body.seller.notificationPreferences.sms_alerts, true);
  });
});
