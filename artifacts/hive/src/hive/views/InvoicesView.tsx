import { useEffect, useState } from 'react';
import { api, money, post } from '../api';
import { Decide, StatusPill, type Op } from './OpParts';

interface Sug { customer: string; typicalCents: number; daysLate: number; confidence: string }
interface I { items: Op[]; suggestions: Sug[]; simulated: boolean }

/** Invoices: HIVE spots repeat customers who are late. Approving creates a DRAFT; sending is a separate confirmation. */
export function InvoicesView({ onToast }: { onToast: (m: string) => void }) {
  const [d, setD] = useState<I | null>(null);
  const [f, setF] = useState({ customer: '', email: '', amount: '', description: '', dueDays: '10' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [sending, setSending] = useState<number | null>(null);
  const load = () => api<I>('/api/invoices').then(setD).catch((e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const add = async (e: React.SyntheticEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await post('/api/invoices', f); setF({ ...f, email: '', amount: '', description: '', customer: '' }); await load(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } };
  const send = async (o: Op) => { setSending(o.id); setErr(''); try { const r = await post<{ simulated: boolean }>(`/api/ops/${o.id}/send`, { confirm: true }); onToast(r.simulated ? 'Invoice sent: simulated, nothing was emailed.' : 'Invoice sent through PayPal.'); await load(); } catch (x) { setErr((x as Error).message); } finally { setSending(null); } };
  return (
    <section className="panel" aria-labelledby="in-h">
      <h2 id="in-h">Invoices</h2>
      <p className="muted">Draft a PayPal invoice for customers who usually pay on a rhythm and are now late. HIVE only stores anonymous aliases, so you add the billing email. {d?.simulated ? 'Demo mode: drafts are simulated.' : ''}</p>
      {d && d.suggestions.length > 0 && (
        <div className="notice"><b>Late repeat customers (estimates from history):</b>
          <ul className="plain">{d.suggestions.map((s) => <li key={s.customer}>{s.customer}: usually about {money(s.typicalCents)}, about {s.daysLate} days late <span className="muted">({s.confidence} confidence)</span>{' '}
            <button onClick={() => setF({ ...f, customer: s.customer, amount: (s.typicalCents / 100).toFixed(2), description: 'Recurring payment' })}>Use these details</button></li>)}</ul></div>
      )}
      <form className="form-grid" onSubmit={(e) => void add(e)}>
        <label>Customer billing email<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" /></label>
        <label>Amount (USD)<input type="number" step="0.01" min="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="wide">Description<input required maxLength={120} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label>Due in (days)<input type="number" min="1" max="60" value={f.dueDays} onChange={(e) => setF({ ...f, dueDays: e.target.value })} /></label>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Draft invoice'}</button>
      </form>
      {err && <div className="notice error" role="alert"><p>{err}</p></div>}
      <h3>Invoices</h3>
      {d && d.items.length === 0 && <p className="muted">None yet.</p>}
      <ul className="cards">
        {d?.items.map((o) => (
          <li key={o.id} className="card-row">
            <div className="card-head"><strong>{money(Number(o.payload.amountCents))}</strong> <span className="muted">to {String(o.payload.email)} · {String(o.payload.description)}</span> <StatusPill op={o} />{o.result?.sent && <span className="pill st-executed">Sent</span>}</div>
            <Decide op={o} verb="Create draft" onDone={(m) => { onToast(m); void load(); }} />
            {o.status === 'executed' && !o.result?.sent && <p>Draft ready ({String(o.result?.invoiceId ?? '')}). <button className="primary" disabled={sending === o.id} onClick={() => void send(o)}>{sending === o.id ? 'Sending…' : 'Send to customer'}</button></p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
