import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PAYPAL_CLIENT_ID: z.string().default(''),
  PAYPAL_CLIENT_SECRET: z.string().default(''),
  HIVE_PAYPAL_WEBHOOK_ID: z.string().default(''),
  PAYPAL_BASE_URL: z.string().url().default('https://api-m.sandbox.paypal.com'),
  DATABASE_URL: z.string().default(''),
  CUSTOMER_HASH_SALT: z.string().min(8).default('dev-only-change-me'),
  PORT: z.coerce.number().default(8080),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  DEMO_MODE: z.string().default(''),
  /** If set, state-changing routes (approve/reject, alert status, backfill, checkout) need this token. Empty = open (demo mode). */
  /** AG Studio licence key (free 45-day trial from the hackathon page). The key is public in the browser by design. */
  AG_STUDIO_LICENSE: z.string().default(''),
  ADMIN_TOKEN: z.string().default(''),
  /** Bearer token other AI agents must send to the Agent Gate (/mcp). Required outside demo mode. */
  AGENT_TOKEN: z.string().default(''),
  /** Hard cap on money HIVE may pay out in any rolling 24 hours, in cents. */
  PAYOUT_DAILY_CAP_CENTS: z.coerce.number().int().positive().default(10000),
  /** Set to 'true' to save every validated Gemini answer so it can be replayed when the model is unavailable. */
  /** Gmail recipient for new or worsening alerts; sending uses the Replit Gmail connector's send-only scope. */
  HIVE_ALERT_EMAIL_TO: z.string().email().or(z.literal('')).default(''),
  HIVE_ALERT_MIN_SEVERITY: z.enum(['low', 'medium', 'high']).default('medium'),
  PUBLIC_URL: z.string().default(''),
  RECORD_ANSWERS: z.string().default(''),
});

export const config = schema.parse(process.env);

/** Fail loudly if someone points this demo at live PayPal by accident. */
if (!config.PAYPAL_BASE_URL.includes('sandbox')) {
  throw new Error('PAYPAL_BASE_URL must be the sandbox. HIVE is sandbox-only.');
}

/** Demo mode runs with synthetic data in memory: no database, no PayPal, no AI key needed. */
export const demoMode = config.DEMO_MODE ? config.DEMO_MODE === 'true' : !config.DATABASE_URL;

/**
 * Fail closed. Outside demo mode the server can approve refunds, so it must not start without an access token.
 * (Demo mode simulates everything, so it stays open for judges and local use.)
 */
if (!demoMode && !config.ADMIN_TOKEN) {
  throw new Error('ADMIN_TOKEN is required when HIVE is connected to a database or PayPal. Set a long random value and enter it in the banner on the web page.');
}
if (!demoMode && (config.CUSTOMER_HASH_SALT.length < 32 || config.CUSTOMER_HASH_SALT === 'dev-only-change-me')) {
  throw new Error('CUSTOMER_HASH_SALT must be a unique secret of at least 32 characters outside demo mode.');
}
