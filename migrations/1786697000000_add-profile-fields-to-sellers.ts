import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('sellers', {
    company_name: {
      type: 'varchar(255)',
    },
    timezone: {
      type: 'varchar(100)',
      notNull: true,
      default: 'UTC',
    },
    notification_preferences: {
      type: 'jsonb',
      notNull: true,
      default: JSON.stringify({ email_alerts: true, order_updates: true }),
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn('sellers', ['company_name', 'timezone', 'notification_preferences']);
}
