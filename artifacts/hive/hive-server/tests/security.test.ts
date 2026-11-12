import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** Boot the config module in a clean process with chosen environment variables. */
const boot = (env: Record<string, string>) => {
  try {
    execFileSync('npx', ['tsx', 'tests/fixtures/boot-config.ts'], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? `${process.env.HOME ?? ''}/.config`, DOTENV_CONFIG_PATH: '/nonexistent/.env', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
    });
    return { ok: true, err: '' }; // reached the BOOTED line
  } catch (e) {
    return { ok: false, err: String((e as { stderr?: string }).stderr ?? e) };
  }
};

describe('fail closed', () => {
  it('refuses to start against a database without an admin token', () => {
    const r = boot({ DATABASE_URL: 'postgres://u:p@localhost:5432/hive' });
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/ADMIN_TOKEN is required/);
  }, 15_000);
  it('starts against a database when a token is set', () => {
    expect(boot({ DATABASE_URL: 'postgres://u:p@localhost:5432/hive', ADMIN_TOKEN: 'a-long-random-token', CUSTOMER_HASH_SALT: 'a-unique-random-hash-salt-with-at-least-32-characters' }).ok).toBe(true);
  });
  it('demo mode needs no token', () => {
    expect(boot({}).ok).toBe(true);
  });
  it('an explicit DEMO_MODE=false is also treated as live and needs a token', () => {
    const r = boot({ DEMO_MODE: 'false' });
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/ADMIN_TOKEN is required/); // failing for the right reason, not a broken harness
  });
  it('refuses to point at the real PayPal', () => {
    const r = boot({ PAYPAL_BASE_URL: 'https://api-m.paypal.com' });
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/sandbox/);
  });
  it('refuses the development-only customer salt outside demo mode', () => {
    const r = boot({ DEMO_MODE: 'false', ADMIN_TOKEN: 'a-long-random-token', CUSTOMER_HASH_SALT: 'dev-only-change-me' });
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/CUSTOMER_HASH_SALT must be a unique secret/);
  });
});
