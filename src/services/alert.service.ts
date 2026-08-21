import { DbQuerier } from './auth.service';

export interface AlertEmailPayload {
  sent: boolean;
  recipient: string;
  subject: string;
  body: string;
  timestamp: string;
}

export class AlertService {
  /**
   * Evaluates recent sync logs for a channel and sends a critical email alert if 3 consecutive syncs fail.
   */
  public static async checkAndAlertConsecutiveFailures(
    db: DbQuerier,
    sellerId: string,
    channelId: string,
    alertEmailRecipient = 'alerts@orchestr.io'
  ): Promise<{ alerted: boolean; consecutiveFailures: number; emailAlert?: AlertEmailPayload }> {
    if (!sellerId || !channelId) {
      return { alerted: false, consecutiveFailures: 0 };
    }

    // 1. Fetch 3 most recent sync_logs for this channel
    const logsRes = await db.query(
      `SELECT id, status, error_message, created_at
       FROM sync_logs
       WHERE channel_id = $1 AND seller_id = $2
       ORDER BY created_at DESC
       LIMIT 3`,
      [channelId, sellerId]
    );

    const logs = logsRes.rows;
    if (logs.length < 3) {
      return { alerted: false, consecutiveFailures: logs.filter((l) => l.status === 'failed').length };
    }

    const consecutiveFailures = logs.filter((l) => l.status === 'failed').length;

    // 2. If all 3 recent syncs failed, trigger critical email alert
    if (consecutiveFailures >= 3) {
      const channelRes = await db.query(`SELECT name, type FROM channels WHERE id = $1`, [channelId]);
      const channelName = channelRes.rows[0]?.name || 'Connected Channel';
      const lastError = logs[0]?.error_message || 'Repeated connection timeout';

      const subject = `CRITICAL ALERT: Shopify Sync Failed 3x in a row for ${channelName}`;
      const body = `Channel "${channelName}" (ID: ${channelId}) has failed 3 consecutive sync attempts.\nLast error: ${lastError}\nPlease check your API credentials and channel status.`;

      const emailAlert = this.sendEmailAlert(alertEmailRecipient, subject, body);

      return {
        alerted: true,
        consecutiveFailures,
        emailAlert,
      };
    }

    return { alerted: false, consecutiveFailures };
  }

  /**
   * Simulates sending a critical email alert.
   */
  public static sendEmailAlert(recipient: string, subject: string, body: string): AlertEmailPayload {
    console.log(`[AlertService] 🚨 CRITICAL EMAIL ALERT SENT TO: ${recipient}`);
    console.log(`[AlertService] Subject: ${subject}`);
    console.log(`[AlertService] Body: ${body}`);

    return {
      sent: true,
      recipient,
      subject,
      body,
      timestamp: new Date().toISOString(),
    };
  }
}
