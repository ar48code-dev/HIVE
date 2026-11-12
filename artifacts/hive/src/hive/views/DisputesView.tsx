import { useEffect, useState } from 'react';
import { api, money, post, when } from '../api';
import { Decide, StatusPill, type Op } from './OpParts';

interface Case { id: string; reason: string; amountCents: number; status: string; customer: string; txnId?: string; openedAt: number; respondBy: number; simulated: boolean; response?: Op }
const reason = (r: string) => r.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Disputes: HIVE writes the evidence note from your transaction records, you approve it, then it goes to the PayPal Disputes API. */
export function DisputesView({ onToast }: { onToast: (m: string) => void }) {
  const [d, setD] = useState<{ items: Case[]; live: boolean } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const load = () => api<{ items: Case[]; live: boolean }>('/api/disputes').then(setD).catch((e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const prepare = async (id: string) => { setBusy(id); setErr(''); try { await post(`/api/disputes/${encodeURIComponent(id)}/prepare`, {}); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  return (
    <section className="panel" aria-labelledby="di-h">
      <h2 id="di-h">Disputes</h2>
      <p className="muted">{d?.live ? 'Open disputes from your PayPal sandbox account.' : 'Demo mode: these disputes are simulated from real rows in the demo history. Connect PayPal to see your own.'} HIVE writes the evidence from your records; you approve before anything is sent.</p>
      {err && <div className="notice error" role="alert"><p>{err}</p></div>}
      {d && d.items.length === 0 && <p className="muted">No open disputes. Nothing needs a response.</p>}
      <ul className="cards">
        {d?.items.map((c) => (
          <li key={c.id} className="card-row">
            <div className="card-head"><strong>{reason(c.reason)}</strong> <span className="muted">· {money(c.amountCents)} · {c.customer}</span>{c.response && <StatusPill op={c.response} />}</div>
            <p className="muted">{c.id} · opened {when(c.openedAt)} · respond by {when(c.respondBy)}{c.simulated ? ' · simulated' : ''}</p>
            {!c.response && <button className="primary" disabled={busy === c.id} onClick={() => void prepare(c.id)}>{busy === c.id ? 'Preparing…' : 'Prepare evidence'}</button>}
            {c.response && (
              <>
                <p><b>HIVE’s read:</b> {c.response.payload.why} <span className="muted">(suggests: {c.response.payload.recommendation === 'accept' ? 'accept the claim' : 'contest with evidence'})</span></p>
                <pre className="packet">{String(c.response.payload.notes)}</pre>
                <Decide op={c.response} verb="Send evidence" onDone={(m) => { onToast(m); void load(); }} />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
