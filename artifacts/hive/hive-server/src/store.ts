import { pool } from './db.js';

/** Webhook bookkeeping (Postgres only). Everything else goes through the Repo interface. */

/** Returns 'new', 'duplicate_done' or 'duplicate_pending' so retries and replays are safe. */
export async function recordEvent(eventId: string, type: string, payload: unknown): Promise<'new' | 'duplicate_done' | 'duplicate_pending'> {
  const ins = await pool.query(
    'INSERT INTO webhook_events (event_id, event_type, payload) VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
    [eventId, type, JSON.stringify(payload)],
  );
  if (ins.rowCount) return 'new';
  const r = await pool.query('SELECT processed_at FROM webhook_events WHERE event_id=$1', [eventId]);
  return r.rows[0]?.processed_at ? 'duplicate_done' : 'duplicate_pending';
}

export const markProcessed = (eventId: string) =>
  pool.query('UPDATE webhook_events SET processed_at=now() WHERE event_id=$1', [eventId]);

export async function findCustomerByCapture(captureId: string): Promise<string | null> {
  const r = await pool.query('SELECT customer_key FROM transactions WHERE capture_id=$1 LIMIT 1', [captureId]);
  return r.rows[0]?.customer_key ?? null;
}
