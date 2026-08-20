import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Orders Table
  pgm.createTable('orders', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    seller_id: {
      type: 'uuid',
      notNull: true,
      references: '"sellers"',
      onDelete: 'CASCADE',
    },
    channel_id: {
      type: 'uuid',
      references: '"channels"',
      onDelete: 'SET NULL',
    },
    external_order_id: {
      type: 'varchar(255)',
      notNull: true,
    },
    order_number: {
      type: 'varchar(100)',
      notNull: true,
    },
    customer_name: {
      type: 'varchar(255)',
      notNull: false,
    },
    customer_email: {
      type: 'varchar(255)',
      notNull: false,
    },
    total_price: {
      type: 'numeric(12,2)',
      notNull: true,
      default: 0.00,
    },
    currency: {
      type: 'varchar(10)',
      notNull: true,
      default: 'USD',
    },
    financial_status: {
      type: 'varchar(50)',
      notNull: false,
    },
    fulfillment_status: {
      type: 'varchar(50)',
      notNull: false,
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'pending',
    },
    line_items: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    raw_data: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createConstraint('orders', 'orders_channel_external_id_unique', {
    unique: ['channel_id', 'external_order_id'],
  });

  pgm.createIndex('orders', 'seller_id');
  pgm.createIndex('orders', 'channel_id');
  pgm.createIndex('orders', 'status');

  // Sync Logs Table
  pgm.createTable('sync_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    seller_id: {
      type: 'uuid',
      notNull: true,
      references: '"sellers"',
      onDelete: 'CASCADE',
    },
    channel_id: {
      type: 'uuid',
      references: '"channels"',
      onDelete: 'CASCADE',
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'running',
    },
    orders_synced: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    error_message: {
      type: 'text',
      notNull: false,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('sync_logs', 'seller_id');
  pgm.createIndex('sync_logs', 'channel_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('sync_logs');
  pgm.dropTable('orders');
}
