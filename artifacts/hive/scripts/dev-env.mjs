/**
 * HIVE preview stays synthetic unless explicitly opted into its isolated Sandbox
 * setup. Never fall back to the workspace-wide DATABASE_URL for HIVE.
 */
export function hiveDevServerEnv(env) {
  if (env.HIVE_LIVE_MODE !== 'true') {
    return { DATABASE_URL: '', DEMO_MODE: 'true' };
  }

  const missing = ['HIVE_DATABASE_URL', 'ADMIN_TOKEN', 'CUSTOMER_HASH_SALT']
    .filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`HIVE_LIVE_MODE requires these Replit Secrets: ${missing.join(', ')}.`);
  }
  if (env.CUSTOMER_HASH_SALT.length < 32 || env.CUSTOMER_HASH_SALT === 'dev-only-change-me') {
    throw new Error('HIVE_LIVE_MODE requires a unique CUSTOMER_HASH_SALT of at least 32 characters.');
  }
  return { DATABASE_URL: env.HIVE_DATABASE_URL, DEMO_MODE: 'false' };
}
