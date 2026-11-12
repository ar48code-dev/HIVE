import { useState } from 'react';
import { alertTitle, money, post, SEVERITY_LABEL, type Alert, type QueenAnswer, type Summary } from '../api';

/** A daily brief: facts computed from your data first, then Queen's written take with checked evidence. */
export function BriefView({ summary, alerts, onAsk }: { summary: Summary; alerts: Alert[]; onAsk: (q: string) => void }) {
  const [ans, setAns] = useState<QueenAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const a = summary.last30, p = summary.prior30;
  const open = alerts.filter((x) => x.status === 'open');
  const high = open.filter((x) => x.severity === 'high');
  const today = summary.daily[summary.daily.length - 1];
  const delta = a.netCents - p.netCents;
  const ask = async () => {
    setBusy(true); setErr('');
    try { setAns(await post<QueenAnswer>('/api/queen/ask', { question: 'Give me a short brief: what changed recently and what should I check first?' })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="panel" aria-labelledby="br-h">
      <h2 id="br-h">Daily brief</h2>
      <p className="muted">Numbers below come straight from your transactions. Queen’s written take is checked against them.</p>
      <ol className="brief">
        <li><b>You kept {money(a.netCents)}</b> in the last 30 days, {money(Math.abs(delta))} {delta >= 0 ? 'more' : 'less'} than the 30 days before.</li>
        <li><b>{today?.payments ?? 0} payments</b> landed today{today ? `, ${money(Math.round(today.revenue * 100))} in revenue` : ''}.</li>
        <li><b>{open.length} open {open.length === 1 ? 'alert' : 'alerts'}</b>{high.length ? `, ${high.length} high severity.` : '.'}{open.slice(0, 3).map((x) => <span key={x.id} className="brief-al"> {SEVERITY_LABEL[x.severity]}: {alertTitle(x)}.</span>)}</li>
        <li><b>Refunds:</b> {a.refunds} in 30 days totalling {money(a.refundCents)}; {a.failed} failed payments.</li>
      </ol>
      <p><button className="primary" disabled={busy} onClick={() => void ask()}>{busy ? 'Asking Queen…' : 'Ask Queen for her take'}</button> <button onClick={() => onAsk('What should I check first today?')}>Open in Queen AI</button></p>
      {err && <div className="notice error" role="alert"><p>{err}</p></div>}
      {ans && <div className="notice"><p>{ans.answer}</p><p className="muted">Checked {ans.validation.checkedClaims} claims against {ans.validation.checkedTransactions} transactions{ans.mode === 'template' ? ' (rule-based text, no Gemini key)' : ''}.</p></div>}
    </section>
  );
}
