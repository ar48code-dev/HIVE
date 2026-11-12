import { useEffect, useState } from 'react';
import { api, money, type Recurring, type Summary } from '../api';

/** A cautious 30-day range: the median of recent 30-day net, spread by how much it has varied, plus expected repeat payments. Always an estimate. */
export function OutlookView({ summary }: { summary: Summary }) {
  const [rec, setRec] = useState<Recurring[]>([]);
  useEffect(() => { api<{ items: Recurring[] }>('/api/recurring').then((r) => setRec(r.items)).catch(() => undefined); }, []);
  const d = summary.daily;
  const weeks: number[] = [];
  for (let i = d.length; i - 7 >= 0 && weeks.length < 8; i -= 7) weeks.push(d.slice(i - 7, i).reduce((s, x) => s + x.revenue - x.refunds, 0));
  const sorted = [...weeks].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] ?? 0;
  const lo = Math.round(q(0.25) * (30 / 7) * 100), mid = Math.round(q(0.5) * (30 / 7) * 100), hi = Math.round(q(0.75) * (30 / 7) * 100);
  const soon = rec.filter((r) => r.daysUntil >= 0 && r.daysUntil <= 30);
  const expected = soon.reduce((s, r) => s + r.typicalCents, 0);
  return (
    <section className="panel" aria-labelledby="ou-h">
      <h2 id="ou-h">Cash outlook</h2>
      <p className="notice warn">This is an estimate from your own history, not confirmed income and not financial advice.</p>
      {weeks.length < 4 ? <p className="muted">Not enough history yet. HIVE needs at least four weeks of payments.</p> : (
        <>
          <p className="bignum">{money(lo)} to {money(hi)} <small>likely net over the next 30 days (middle estimate {money(mid)})</small></p>
          <p className="muted">Built from your last {weeks.length} weeks: the lower and upper quartile of weekly net revenue, scaled to 30 days. If you have had a spike or attack lately, widen it in your head.</p>
        </>
      )}
      <h3>Repeat payments expected in the next 30 days</h3>
      {soon.length === 0 ? <p className="muted">None detected.</p> : (
        <ul className="plain">{soon.map((r) => <li key={r.customer}>{r.customer}: about {money(r.typicalCents)} in {r.daysUntil} days <span className="muted">({r.confidence} confidence)</span></li>)}</ul>
      )}
      {soon.length > 0 && <p className="muted">That is about {money(expected)} if they all pay as usual.</p>}
    </section>
  );
}
