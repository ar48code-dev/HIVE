import { alias, } from './analytics.js';
import { DAY } from './risk/engine.js';
import { median } from './risk/engine.js';
import type { Txn } from './types.js';

export interface Recurring {
  customer: string;
  cadenceDays: number;
  typicalCents: number;
  lastAt: number;
  nextAt: number;
  /** Negative when the expected payment is late. */
  daysUntil: number;
  overdue: boolean;
  confidence: 'low' | 'medium' | 'high';
  paymentIds: string[];
  /** Always true: these are predictions from history, never confirmed income. */
  estimate: true;
}

const cv = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (m === 0) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / m;
};

/**
 * Find customers who pay on a steady rhythm and estimate when they will pay next.
 * Needs at least three payments with similar spacing and similar amounts.
 */
export function detectRecurring(txns: Txn[], asOf: number): Recurring[] {
  const byCustomer = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.kind !== 'payment' || t.at > asOf || t.at < asOf - 150 * DAY) continue;
    byCustomer.set(t.customerKey, [...(byCustomer.get(t.customerKey) ?? []), t]);
  }
  // Money that was mostly handed back is not income to plan around.
  const refunded = new Map<string, number>();
  for (const t of txns) if (t.kind === 'refund' && t.at <= asOf && t.at >= asOf - 150 * DAY) refunded.set(t.customerKey, (refunded.get(t.customerKey) ?? 0) + t.amountCents);
  const out: Recurring[] = [];
  for (const [key, list] of byCustomer) {
    if (list.length < 3) continue;
    const paid = list.reduce((s, t) => s + t.amountCents, 0);
    if ((refunded.get(key) ?? 0) >= 0.5 * paid) continue;
    const ps = [...list].sort((a, b) => a.at - b.at);
    const gaps = ps.slice(1).map((p, i) => (p.at - (ps[i] as Txn).at) / DAY);
    const cadence = median(gaps);
    if (cadence < 3 || cadence > 45) continue;
    if (cv(gaps) > 0.3 || cv(ps.map((p) => p.amountCents)) > 0.25) continue;
    const last = ps[ps.length - 1] as Txn;
    const nextAt = last.at + cadence * DAY;
    const daysUntil = (nextAt - asOf) / DAY;
    if (daysUntil < -2 * cadence || daysUntil > 45) continue; // lapsed long ago, or too far ahead
    const spread = cv(gaps);
    out.push({
      customer: alias(key), cadenceDays: Math.round(cadence * 10) / 10, typicalCents: Math.round(median(ps.map((p) => p.amountCents))),
      lastAt: last.at, nextAt, daysUntil: Math.round(daysUntil * 10) / 10, overdue: daysUntil < -1,
      confidence: ps.length >= 5 && spread <= 0.15 ? 'high' : ps.length >= 4 ? 'medium' : 'low',
      paymentIds: ps.map((p) => p.id), estimate: true,
    });
  }
  return out.sort((a, b) => a.nextAt - b.nextAt);
}
