import { describe, expect, it } from 'vitest';
import { hiveDevServerEnv } from '../../scripts/dev-env.mjs';

describe('HIVE preview environment', () => {
  it('remains demo-only unless explicitly opted in, even when the database secret exists', () => {
    expect(hiveDevServerEnv({ HIVE_DATABASE_URL: 'private-dsn' })).toEqual({
      DATABASE_URL: '',
      DEMO_MODE: 'true',
    });
  });

  it('refuses live mode until the HIVE-specific database and security secrets exist', () => {
    expect(() => hiveDevServerEnv({ HIVE_LIVE_MODE: 'true' }))
      .toThrow(/HIVE_DATABASE_URL, ADMIN_TOKEN, CUSTOMER_HASH_SALT/);
  });

  it('maps only the HIVE database to live mode and never leaks the salt in an error', () => {
    const env = hiveDevServerEnv({
      HIVE_LIVE_MODE: 'true',
      HIVE_DATABASE_URL: 'private-dsn',
      ADMIN_TOKEN: 'admin-secret',
      CUSTOMER_HASH_SALT: 'correct-hive-only-salt-with-at-least-32-characters',
      DATABASE_URL: 'unrelated-workspace-database',
    });
    expect(env).toEqual({ DATABASE_URL: 'private-dsn', DEMO_MODE: 'false' });
    expect(JSON.stringify(env)).not.toContain('admin-secret');
  });

  it('rejects short salts before starting the API', () => {
    expect(() => hiveDevServerEnv({
      HIVE_LIVE_MODE: 'true',
      HIVE_DATABASE_URL: 'private-dsn',
      ADMIN_TOKEN: 'admin-secret',
      CUSTOMER_HASH_SALT: 'too-short',
    })).toThrow(/unique CUSTOMER_HASH_SALT of at least 32 characters/);
  });
});
