import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Add tracking columns to orders table
  pgm.addColumns('orders', {
    tracking_number: {
      type: 'varchar(255)',
      notNull: false,
    },
    tracking_company: {
      type: 'varchar(255)',
      notNull: false,
    },
  });

  // Create order_status_history audit table
  pgm.createTable('order_status_history', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    order_id: {
      type: 'uuid',
      notNull: true,
      references: '"orders"',
      onDelete: 'CASCADE',
    },
    seller_id: {
      type: 'uuid',
      notNull: true,
      references: '"sellers"',
      onDelete: 'CASCADE',
    },
    old_status: {
      type: 'varchar(50)',
      notNull: false,
    },
    new_status: {
      type: 'varchar(50)',
      notNull: true,
    },
    tracking_number: {
      type: 'varchar(255)',
      notNull: false,
    },
    tracking_company: {
      type: 'varchar(255)',
      notNull: false,
    },
    notes: {
      type: 'text',
      notNull: false,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('order_status_history', 'order_id');
  pgm.createIndex('order_status_history', 'seller_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('order_status_history');
  pgm.dropColumns('orders', ['tracking_number', 'tracking_company']);
}
