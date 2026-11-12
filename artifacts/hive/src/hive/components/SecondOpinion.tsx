import { useEffect, useState } from 'react';
import { api, money, when, type SecondOpinion as Resp } from '../api';
import type { Focus } from '../App';

const FEATURE_WORDS: Record<string, string> = {
  small_amt: 'a very small amount', n_small_10m: 'several tiny payments just now', g_small_10m: 'tiny payments across the shop just now',
  g_new_10m: 'many new customers just now', g_pay_10m: 'a burst of payments across the shop', is_new: 'a first-time customer',
  amt_vs_median: 'an amount far from the shop’s usual', amt_vs_own: 'an amount far from this customer’s usual', dup_120s: 'a repeat of a payment seconds ago',
  fails_1h: 'several failed attempts', is_fail: 'a failed attempt', refunds_30d: 'repeated refunds', share_7d: 'a large share of the week’s revenue',
  n_10m: 'many payments from this customer just now', n_1h: 'many payments from this customer this hour', log_amt: 'the size of the amount',
  distinct_cust_1h: 'many different customers this hour', pays_30d: 'this customer’s payment count', g_fail_10m: 'failed attempts across the shop just now', is_refund: 'a refund',
};

/** What the learned model flags that the rules did not. Rules remain the source of alerts. */
export function SecondOpinion({ onShow }: { onShow: (f: Focus) => void }) {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Resp>('/api/brain/second-opinion').then(setData).catch((e: Error) => setErr(e.message)); }, []);
  if (!data && !err) return <section className="panel"><p className="muted">Asking the learned model…</p></section>;
  if (err || !data?.enabled) return err ? <section className="panel"><p className="notice error" role="alert">{err}</p></section> : null;
  if (data.applicable === false) {
    return (
      <section className="panel" aria-labelledby="so-h">
        <h2 id="so-h">Second opinion</h2>
        <div className="notice warn"><p><strong>Switched off for your shop.</strong> {data.reason}</p></div>
      </section>
    );
  }
  const rows = data.modelOnly ?? [];
  return (
    <section className="panel" aria-labelledby="so-h">
      <h2 id="so-h">Second opinion</h2>
      <p className="muted">A separate learned model also scored every transaction. It flagged {data.flaggedByModel} of {data.scored}; the {rows.length === 25 ? 'latest 25' : rows.length} below were not flagged by any rule.</p>
      <div className="notice warn"><p>{data.note}</p></div>
      {rows.length === 0 ? <p className="muted pad">The model and the rules agree: nothing extra to look at.</p> : (
        <>
          <div className="table-wrap">
            <table className="mini">
              <thead><tr><th>When</th><th>Type</th><th className="num">Amount</th><th>Customer</th><th>Why the model leaned this way</th></tr></thead>
              <tbody>
                {rows.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td>{when(r.at)}</td><td>{r.kind === 'pay' || r.kind === 'payment' ? 'Payment' : r.kind === 'refund' ? 'Refund' : 'Failed'}</td>
                    <td className="num">{money(Math.round(r.amountCents))}</td><td>{r.customer}</td>
                    <td>{(r.why[0] ? FEATURE_WORDS[r.why[0][0]] ?? r.why[0][0] : 'combined signals')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="link" onClick={() => onShow({ ids: rows.map((r) => r.id), label: 'transactions the learned model flagged and no rule did' })}>Show all {rows.length} in the grid</button>
        </>
      )}
    </section>
  );
}
