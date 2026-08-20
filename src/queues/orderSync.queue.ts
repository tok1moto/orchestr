import { DbQuerier } from '../services/auth.service';
import { OrderSyncService } from '../services/orderSync.service';

export class OrderSyncQueue {
  private static timerId: NodeJS.Timeout | null = null;
  private static isRunning = false;

  /**
   * Starts recurring 5-minute polling job for active Shopify channels.
   */
  public static startOrderSyncScheduler(db: DbQuerier, intervalMs = 5 * 60 * 1000) {
    if (this.timerId) {
      clearInterval(this.timerId);
    }

    console.log(`[OrderSyncQueue] Started 5-minute Shopify order sync queue scheduler (interval: ${intervalMs}ms)`);

    // Immediate initial run
    this.processSyncJob(db).catch((err) => console.error('[OrderSyncQueue] Sync error:', err.message));

    // Schedule recurring 5-minute job
    this.timerId = setInterval(() => {
      this.processSyncJob(db).catch((err) => console.error('[OrderSyncQueue] Sync error:', err.message));
    }, intervalMs);
  }

  /**
   * Stops the background scheduler timer.
   */
  public static stopOrderSyncScheduler() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      console.log('[OrderSyncQueue] Stopped order sync queue scheduler');
    }
  }

  /**
   * Executes the `sync-shopify-orders` job polling all active Shopify channels in PostgreSQL.
   */
  public static async processSyncJob(db: DbQuerier): Promise<{ processedChannels: number; totalOrdersSynced: number }> {
    if (this.isRunning) {
      console.log('[OrderSyncQueue] Job already running, skipping iteration');
      return { processedChannels: 0, totalOrdersSynced: 0 };
    }

    this.isRunning = true;
    let processedChannels = 0;
    let totalOrdersSynced = 0;

    try {
      // Find all active Shopify channels
      const channelsRes = await db.query(
        `SELECT id, seller_id, name FROM channels WHERE LOWER(type) = 'shopify' AND status = 'active'`
      );

      for (const ch of channelsRes.rows) {
        try {
          const res = await OrderSyncService.syncShopifyOrders(db, ch.seller_id, ch.id);
          processedChannels++;
          totalOrdersSynced += res.ordersSynced;
          console.log(`[OrderSyncQueue] Synced ${res.ordersSynced} orders for channel: ${ch.name} (${ch.id})`);
        } catch (err: any) {
          console.error(`[OrderSyncQueue] Failed to sync channel ${ch.name}:`, err.message);
        }
      }
    } finally {
      this.isRunning = false;
    }

    return { processedChannels, totalOrdersSynced };
  }
}
