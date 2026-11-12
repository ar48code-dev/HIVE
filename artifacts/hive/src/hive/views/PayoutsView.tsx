import { useEffect, useState } from 'react';
import { api, money, post } from '../api';
import { Decide, StatusPill, type Op } from './OpParts';

interface P { capCents: number; usedCents: number; items: Op[]; simulated: boolean }

/** Payouts: you write the payout, you approve it, and a hard 24-hour cap applies at the moment of approval. */
export function PayoutsView({ onToast }: { onToast: (m: string) => void }) {
  const [p, setP] = useState<P | null>(null);
  const [f, setF] = useState({ email: '', amount: '', note: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => api<P>('/api/payouts').then(setP).catch((e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const add = async (e: React.SyntheticEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post('/api/payouts', f); setF({ email: '', amount: '', note: '' }); await load(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const left = p ? p.capCents - p.usedCents : 0;
  return (
    <section className="panel" aria-labelledby="po-h">
      <h2 id="po-h">Payouts</h2>
      <p className="muted">Pay a contractor or send a goodwill payment through PayPal Payouts. {p?.simulated ? 'Demo mode: payouts are simulated.' : 'Sandbox money only.'}</p>
      {p && <p className="capbar"><b>{money(left)}</b> left today <span className="muted">of a {money(p.capCents)} cap per rolling 24 hours</span></p>}
      <form className="form-grid" onSubmit={(e) => void add(e)}>
        <label>Recipient PayPal email<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" /></label>
        <label>Amount (USD)<input type="number" step="0.01" min="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="wide">What is it for?<input required maxLength={150} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Draft payout'}</button>
      </form>
      {err && <div className="notice error" role="alert"><p>{err}</p></div>}
      <h3>Payouts</h3>
      {p && p.items.length === 0 && <p className="muted">None yet.</p>}
      <ul className="cards">
        {p?.items.map((o) => (
          <li key={o.id} className="card-row">
            <div className="card-head"><strong>{money(Number(o.payload.amountCents))}</strong> <span className="muted">to {String(o.payload.email)} · {String(o.payload.note)}</span> <StatusPill op={o} /></div>
            <Decide op={o} verb="Send payout" onDone={(m) => { onToast(m); void load(); }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
