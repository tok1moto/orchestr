import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getDbConfig } from '../src/plugins/db';

describe('Database Seed & Migration Config', () => {
  it('correctly defaults database target to orchestr_dev and orchestr user', () => {
    process.env.POSTGRES_USER = 'orchestr';
    process.env.POSTGRES_DB = 'orchestr_dev';
    delete process.env.DATABASE_URL;

    const config = getDbConfig();
    assert.strictEqual(config.user, 'orchestr');
    assert.strictEqual(config.database, 'orchestr_dev');
  });
});
