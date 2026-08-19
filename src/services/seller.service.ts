import { DbQuerier } from './auth.service';

export interface SellerProfile {
  id: string;
  name: string;
  email: string;
  companyName: string | null;
  timezone: string;
  notificationPreferences: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSellerInput {
  name?: string;
  company_name?: string;
  companyName?: string;
  timezone?: string;
  notification_preferences?: Record<string, any>;
  notificationPreferences?: Record<string, any>;
}

export class SellerService {
  /**
   * Formats a raw database row into a clean SellerProfile object.
   */
  private static formatSellerProfile(row: any): SellerProfile {
    let notificationPreferences = row.notification_preferences;
    if (typeof notificationPreferences === 'string') {
      try {
        notificationPreferences = JSON.parse(notificationPreferences);
      } catch {
        notificationPreferences = { email_alerts: true, order_updates: true };
      }
    }

    return {
      id: row.id,
      name: row.name,
      email: row.email,
      companyName: row.company_name ?? null,
      timezone: row.timezone ?? 'UTC',
      notificationPreferences: notificationPreferences ?? { email_alerts: true, order_updates: true },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Fetches the seller profile by seller ID.
   */
  public static async getProfile(db: DbQuerier, sellerId: string): Promise<SellerProfile> {
    if (!sellerId) {
      const error: any = new Error('Seller ID is required');
      error.statusCode = 400;
      throw error;
    }

    const result = await db.query(
      `SELECT id, name, email, company_name, timezone, notification_preferences, created_at, updated_at
       FROM sellers
       WHERE id = $1`,
      [sellerId]
    );

    if (result.rows.length === 0) {
      const error: any = new Error('Seller profile not found');
      error.statusCode = 404;
      throw error;
    }

    return this.formatSellerProfile(result.rows[0]);
  }

  /**
   * Updates fields on the seller profile.
   */
  public static async updateProfile(
    db: DbQuerier,
    sellerId: string,
    input: UpdateSellerInput
  ): Promise<SellerProfile> {
    if (!sellerId) {
      const error: any = new Error('Seller ID is required');
      error.statusCode = 400;
      throw error;
    }

    const name = input.name;
    const companyName = input.companyName ?? input.company_name;
    const timezone = input.timezone;
    const notificationPreferences = input.notificationPreferences ?? input.notification_preferences;

    const setClauses: string[] = [];
    const params: any[] = [sellerId];
    let paramIdx = 2;

    if (name !== undefined) {
      setClauses.push(`name = $${paramIdx++}`);
      params.push(name);
    }

    if (companyName !== undefined) {
      setClauses.push(`company_name = $${paramIdx++}`);
      params.push(companyName);
    }

    if (timezone !== undefined) {
      setClauses.push(`timezone = $${paramIdx++}`);
      params.push(timezone);
    }

    if (notificationPreferences !== undefined) {
      setClauses.push(`notification_preferences = $${paramIdx++}`);
      params.push(typeof notificationPreferences === 'object' ? JSON.stringify(notificationPreferences) : notificationPreferences);
    }

    if (setClauses.length === 0) {
      // Nothing to update, return current profile
      return this.getProfile(db, sellerId);
    }

    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);

    const sql = `
      UPDATE sellers
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING id, name, email, company_name, timezone, notification_preferences, created_at, updated_at
    `;

    const result = await db.query(sql, params);

    if (result.rows.length === 0) {
      const error: any = new Error('Seller profile not found');
      error.statusCode = 404;
      throw error;
    }

    return this.formatSellerProfile(result.rows[0]);
  }
}
