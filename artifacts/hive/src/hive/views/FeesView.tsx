import { money, type Txn } from '../api';

const BANDS: Array<[string, number, number]> = [['Under $10', 0, 1000], ['$10 to $50', 1000, 5000], ['$50 to $200', 5000, 20000], ['Over $200', 20000, Infinity]];

/** What PayPal fees cost, by payment size. A fixed per-payment fee hurts small payments most, so the band view shows where. */
export function FeesView({ txns }: { txns: Txn[] }) {
  const pays = txns.filter((t) => t.kind === 'payment');
  const rows = BANDS.map(([label, lo, hi]) => {
    const g = pays.filter((t) => t.amountCents >= lo && t.amountCents < hi);
    const rev = g.reduce((s, t) => s + t.amountCents, 0), fee = g.reduce((s, t) => s + t.feeCents, 0);
    return { label, n: g.length, rev, fee, pct: rev ? (fee / rev) * 100 : 0 };
  });
  const rev = rows.reduce((s, r) => s + r.rev, 0), fee = rows.reduce((s, r) => s + r.fee, 0);
  const worst = rows.filter((r) => r.n > 0).sort((a, b) => b.pct - a.pct)[0];
  const max = Math.max(1, ...rows.map((r) => r.pct));
  return (
    <section className="panel" aria-labelledby="fe-h">
      <h2 id="fe-h">Fee insights</h2>
      <p className="muted">All payments in your history. Fees are what PayPal recorded for each payment.</p>
      <p className="bignum">{money(fee)} <small>in fees on {money(rev)} ({rev ? ((fee / rev) * 100).toFixed(2) : '0.00'}% overall)</small></p>
      <ul className="bars">
        {rows.map((r) => (
          <li key={r.label}><span>{r.label} <small className="muted">({r.n} payments)</small></span>
            <span className="bar"><i style={{ width: `${(r.pct / max) * 100}%` }} /></span><b>{r.pct.toFixed(1)}%</b></li>
        ))}
      </ul>
      {worst && <p>Your highest effective fee rate is on <b>{worst.label.toLowerCase()}</b> payments ({worst.pct.toFixed(1)}%). Bundling or setting a minimum order there is the quickest way to keep more.</p>}
    </section>
  );
}
