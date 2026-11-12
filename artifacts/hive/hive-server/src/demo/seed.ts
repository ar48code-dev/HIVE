import { createHash } from 'node:crypto';
import { DAY, evaluate } from '../risk/engine.js';
import { buildDemo } from '../wasplab/scenarios.js';
import { proposeActions } from '../actions.js';
import type { MemoryRepo } from '../repo.js';

/** Fill the in-memory repo with synthetic data and run the real engine over it. */
export async function seedDemo(repo: MemoryRepo, now = Date.now()) {
  // Hash synthetic customer names so they look like real (hashed) PayPal customer keys.
  const hash = (k: string) => createHash('sha256').update(`demo:${k}`).digest('hex').slice(0, 16);
  const txns = buildDemo(7, now).map((t) => ({ ...t, customerKey: hash(t.customerKey) }));
  for (const t of txns) await repo.upsertTxn(t);
  // Evaluate only the last 30 days; the 30 days before are history the engine learns from.
  const warmupEnd = now - 30 * DAY;
  for (let i = 0; i < txns.length; i++) {
    const t = txns[i]!;
    if (t.at < warmupEnd) continue;
    const a = evaluate(txns.slice(0, i), t);
    if (a) {
      const stored = await repo.saveAlert(a);
      await proposeActions(repo, stored);
    }
  }
  await repo.audit('system', 'demo_seeded', { transactions: txns.length, note: 'synthetic data' });
}
