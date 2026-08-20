import { DbQuerier } from '../services/auth.service';
import { ReservationService } from '../services/reservation.service';

export class ReservationExpiryQueue {
  private static timerId: NodeJS.Timeout | null = null;
  private static isRunning = false;

  /**
   * Starts recurring 1-minute scheduler job (`cleanup-expired-reservations`) to release expired stock holds.
   */
  public static startReservationExpiryScheduler(db: DbQuerier, intervalMs = 60 * 1000) {
    if (this.timerId) {
      clearInterval(this.timerId);
    }

    console.log(`[ReservationExpiryQueue] Started 1-minute reservation expiry cleanup scheduler (interval: ${intervalMs}ms)`);

    // Immediate initial check
    this.processCleanupJob(db).catch((err) => console.error('[ReservationExpiryQueue] Cleanup error:', err.message));

    // Schedule recurring 1-minute job
    this.timerId = setInterval(() => {
      this.processCleanupJob(db).catch((err) => console.error('[ReservationExpiryQueue] Cleanup error:', err.message));
    }, intervalMs);
  }

  /**
   * Stops the background cleanup scheduler timer.
   */
  public static stopReservationExpiryScheduler() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      console.log('[ReservationExpiryQueue] Stopped reservation expiry scheduler');
    }
  }

  /**
   * Executes the `cleanup-expired-reservations` job.
   */
  public static async processCleanupJob(db: DbQuerier): Promise<{ releasedCount: number }> {
    if (this.isRunning) {
      return { releasedCount: 0 };
    }

    this.isRunning = true;

    try {
      const res = await ReservationService.cleanupExpiredReservations(db);
      if (res.releasedCount > 0) {
        console.log(`[ReservationExpiryQueue] Auto-released ${res.releasedCount} expired stock reservations`);
      }
      return res;
    } finally {
      this.isRunning = false;
    }
  }
}
