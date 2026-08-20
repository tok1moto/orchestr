import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('reservations', {
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
    product_id: {
      type: 'uuid',
      references: '"products"',
      onDelete: 'SET NULL',
    },
    sku: {
      type: 'varchar(100)',
      notNull: true,
    },
    quantity: {
      type: 'integer',
      notNull: true,
      default: 1,
    },
    customer_email: {
      type: 'varchar(255)',
      notNull: false,
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'active',
    },
    expires_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func("current_timestamp + interval '15 minutes'"),
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

  pgm.createIndex('reservations', 'seller_id');
  pgm.createIndex('reservations', 'sku');
  pgm.createIndex('reservations', 'status');
  pgm.createIndex('reservations', 'expires_at');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('reservations');
}
