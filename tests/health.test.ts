import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { HealthService } from '../src/services/health.service';
import { AlertService } from '../src/services/alert.service';
import { DbQuerier } from '../src/services/auth.service';
import healthRoutes from '../src/routes/health.routes';

describe('Alerting Service & 3x Consecutive Sync Failure Alerts', () => {
  const sellerId = 'seller-alert-1';
  const channelId = 'chan-alert-1';
  const mockSyncLogsDb: Map<string, any> = new Map();

  const mockDb: DbQuerier = {
    async query(text: string, params: any[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

      if (sql.includes('SELECT id, status, error_message, created_at FROM sync_logs')) {
        const logs = Array.from(mockSyncLogsDb.values())
          .filter((l) => l.channel_id === params[0] && l.seller_id === params[1])
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 3);
        return { rows: logs, rowCount: logs.length };
      }

      if (sql.includes('SELECT name, type FROM channels')) {
        return { rows: [{ name: 'Shopify US Store', type: 'shopify' }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  beforeEach(() => {
    mockSyncLogsDb.clear();
  });

  it('triggers critical email alert when 3 consecutive syncs fail for a channel', async () => {
    mockSyncLogsDb.set('log-1', { id: 'log-1', seller_id: sellerId, channel_id: channelId, status: 'failed', error_message: 'Timeout 1', created_at: new Date(Date.now() - 300000).toISOString() });
    mockSyncLogsDb.set('log-2', { id: 'log-2', seller_id: sellerId, channel_id: channelId, status: 'failed', error_message: 'Timeout 2', created_at: new Date(Date.now() - 600000).toISOString() });
    mockSyncLogsDb.set('log-3', { id: 'log-3', seller_id: sellerId, channel_id: channelId, status: 'failed', error_message: 'Timeout 3', created_at: new Date(Date.now() - 900000).toISOString() });

    const result = await AlertService.checkAndAlertConsecutiveFailures(mockDb, sellerId, channelId, 'merchant@test.com');

    assert.strictEqual(result.alerted, true);
    assert.strictEqual(result.consecutiveFailures, 3);
    assert.ok(result.emailAlert);
    assert.strictEqual(result.emailAlert.sent, true);
    assert.ok(result.emailAlert.subject.includes('CRITICAL ALERT'));
    assert.strictEqual(result.emailAlert.recipient, 'merchant@test.com');
  });

  it('does not trigger email alert when fewer than 3 consecutive failures occur', async () => {
    mockSyncLogsDb.set('log-1', { id: 'log-1', seller_id: sellerId, channel_id: channelId, status: 'success', created_at: new Date(Date.now() - 300000).toISOString() });
    mockSyncLogsDb.set('log-2', { id: 'log-2', seller_id: sellerId, channel_id: channelId, status: 'failed', created_at: new Date(Date.now() - 600000).toISOString() });

    const result = await AlertService.checkAndAlertConsecutiveFailures(mockDb, sellerId, channelId);

    assert.strictEqual(result.alerted, false);
  });
});

describe('Health Service & 24-Hour Dashboard', () => {
  const sellerId = 'seller-health-1';

  const mockDb: DbQuerier = {
    async query(text: string, _params: any[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

      if (sql.includes('SELECT 1')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }

      if (sql.includes("SELECT created_at FROM sync_logs WHERE status = 'success'")) {
        return { rows: [{ created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }], rowCount: 1 };
      }

      if (sql.includes("SELECT COUNT(*) AS count FROM orders WHERE LOWER(status) = 'pending'")) {
        return { rows: [{ count: '12' }], rowCount: 1 };
      }

      if (sql.includes('SELECT s.id, s.seller_id, s.channel_id')) {
        return {
          rows: [
            { id: 'l1', seller_id: sellerId, channel_id: 'c1', channel_name: 'Shopify Store', channel_type: 'shopify', status: 'success', orders_synced: 5, error_message: null, created_at: new Date().toISOString() },
            { id: 'l2', seller_id: sellerId, channel_id: 'c1', channel_name: 'Shopify Store', channel_type: 'shopify', status: 'failed', orders_synced: 0, error_message: 'API Timeout', created_at: new Date(Date.now() - 3600000).toISOString() },
          ],
          rowCount: 2,
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  it('getSystemHealth returns health status, lastSync lag, and pendingOrders count', async () => {
    const health = await HealthService.getSystemHealth(mockDb);

    assert.strictEqual(health.status, 'healthy');
    assert.ok(health.lastSync);
    assert.strictEqual(health.syncLagMinutes, 5);
    assert.strictEqual(health.pendingOrders, 12);
    assert.strictEqual(health.database.status, 'up');
  });

  it('get24HourSyncDashboard calculates success/failed rates over past 24 hours', async () => {
    const dash = await HealthService.get24HourSyncDashboard(mockDb, sellerId);

    assert.strictEqual(dash.period, 'Past 24 Hours');
    assert.strictEqual(dash.totalSyncs, 2);
    assert.strictEqual(dash.successCount, 1);
    assert.strictEqual(dash.failedCount, 1);
    assert.strictEqual(dash.failureRatePercent, 50.0);
    assert.strictEqual(dash.recentLogs.length, 2);
  });
});

describe('Health & Sync Logs Dashboard API Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Mock pg decorator
    app.decorate('pg', {
      async query(text: string, _params: any[] = []) {
        const sql = text.replace(/\s+/g, ' ').trim();

        if (sql.includes('SELECT 1')) {
          return { rows: [{ '?column?': 1 }], rowCount: 1 };
        }

        if (sql.includes("SELECT created_at FROM sync_logs WHERE status = 'success'")) {
          return { rows: [{ created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }], rowCount: 1 };
        }

        if (sql.includes("SELECT COUNT(*) AS count FROM orders WHERE LOWER(status) = 'pending'")) {
          return { rows: [{ count: '12' }], rowCount: 1 };
        }

        if (sql.includes('SELECT s.id, s.seller_id, s.channel_id')) {
          return {
            rows: [
              { id: 'l1', seller_id: 's1', channel_id: 'c1', channel_name: 'Shopify Store', channel_type: 'shopify', status: 'success', orders_synced: 3, created_at: new Date().toISOString() },
            ],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 0 };
      },
    } as any);

    await app.register(healthRoutes);
  });

  it('GET /health returns health metrics payload with lastSync and pendingOrders', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.status, 'healthy');
    assert.ok(body.lastSync);
    assert.strictEqual(typeof body.syncLagMinutes, 'number');
    assert.strictEqual(body.pendingOrders, 12);
    assert.strictEqual(body.database.status, 'up');
  });

  it('GET /api/sync-logs/dashboard returns 24-hour sync dashboard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sync-logs/dashboard',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.statusCode, 200);
    assert.strictEqual(body.period, 'Past 24 Hours');
    assert.ok(Array.isArray(body.recentLogs));
  });
});
