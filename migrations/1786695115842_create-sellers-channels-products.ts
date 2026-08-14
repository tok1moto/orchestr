import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Sellers Table
  pgm.createTable('sellers', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
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

  // Channels Table (e.g., Shopify)
  pgm.createTable('channels', {
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
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    type: {
      type: 'varchar(50)',
      notNull: true,
    },
    credentials: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'active',
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

  pgm.createIndex('channels', 'seller_id');

  // Products Table
  pgm.createTable('products', {
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
    title: {
      type: 'varchar(255)',
      notNull: true,
    },
    sku: {
      type: 'varchar(100)',
      notNull: true,
      unique: true,
    },
    price: {
      type: 'numeric(12,2)',
      notNull: true,
      default: 0.00,
    },
    inventory_quantity: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'active',
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

  pgm.createIndex('products', 'seller_id');
  pgm.createIndex('products', 'channel_id');
  pgm.createIndex('products', 'sku');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('products');
  pgm.dropTable('channels');
  pgm.dropTable('sellers');
}
