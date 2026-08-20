import { DbQuerier } from '../services/auth.service';
import { InventoryService } from '../services/inventory.service';

export class InventorySyncQueue {
  private static timerId: NodeJS.Timeout | null = null;
  private static isRunning = false;

  /**
   * Starts recurring 5-minute inventory sync scheduler job for active Shopify channels.
   */
  public static startInventorySyncScheduler(db: DbQuerier, intervalMs = 5 * 60 * 1000) {
    if (this.timerId) {
      clearInterval(this.timerId);
    }

    console.log(`[InventorySyncQueue] Started 5-minute Shopify inventory sync scheduler (interval: ${intervalMs}ms)`);

    // Immediate initial run
    this.processSyncJob(db).catch((err) => console.error('[InventorySyncQueue] Sync error:', err.message));

    // Schedule recurring 5-minute job
    this.timerId = setInterval(() => {
      this.processSyncJob(db).catch((err) => console.error('[InventorySyncQueue] Sync error:', err.message));
    }, intervalMs);
  }

  /**
   * Stops the background scheduler timer.
   */
  public static stopInventorySyncScheduler() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      console.log('[InventorySyncQueue] Stopped inventory sync scheduler');
    }
  }

  /**
   * Executes the `sync-shopify-inventory` job polling all active Shopify channels in PostgreSQL.
   */
  public static async processSyncJob(db: DbQuerier): Promise<{ processedChannels: number; totalProductsSynced: number }> {
    if (this.isRunning) {
      console.log('[InventorySyncQueue] Job already running, skipping iteration');
      return { processedChannels: 0, totalProductsSynced: 0 };
    }

    this.isRunning = true;
    let processedChannels = 0;
    let totalProductsSynced = 0;

    try {
      // Find all active Shopify channels
      const channelsRes = await db.query(
        `SELECT id, seller_id, name FROM channels WHERE LOWER(type) = 'shopify' AND status = 'active'`
      );

      for (const ch of channelsRes.rows) {
        try {
          const res = await InventoryService.syncShopifyInventory(db, ch.seller_id, ch.id);
          processedChannels++;
          totalProductsSynced += res.syncedCount;
          if (res.oversoldProductsCount > 0) {
            console.warn(`[InventorySyncQueue] ALERT: Detected ${res.oversoldProductsCount} oversold SKUs for channel: ${ch.name}`);
          }
          console.log(`[InventorySyncQueue] Synced ${res.syncedCount} product inventory levels for channel: ${ch.name} (${ch.id})`);
        } catch (err: any) {
          console.error(`[InventorySyncQueue] Failed to sync inventory for channel ${ch.name}:`, err.message);
        }
      }
    } finally {
      this.isRunning = false;
    }

    return { processedChannels, totalProductsSynced };
  }
}
