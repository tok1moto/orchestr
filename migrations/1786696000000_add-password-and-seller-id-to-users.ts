import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('users', {
    password_hash: {
      type: 'varchar(255)',
      notNull: true,
      default: '',
    },
    seller_id: {
      type: 'uuid',
      references: '"sellers"',
      onDelete: 'SET NULL',
    },
  });

  pgm.createIndex('users', 'seller_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('users', 'seller_id');
  pgm.dropColumn('users', ['password_hash', 'seller_id']);
}
