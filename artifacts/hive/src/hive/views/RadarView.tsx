import { useEffect, useMemo, useState } from 'react';
import { alertTitle, api, money, post, SEVERITY_LABEL, when, type Action, type Alert, type Txn } from '../api';
import type { Focus } from '../App';
import { SecondOpinion } from '../components/SecondOpinion';

interface Props {
  alerts: Alert[]; txns: Txn[]; selectedId: number | null;
  onSelect: (id: number) => void; onShow: (f: Focus) => void; onAsk: (q: string, alertId?: number) => void; onChanged: () => Promise<void>;
  brain?: boolean;
}

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' },
] as const;

export function RadarView({ alerts, txns, selectedId, onSelect, onShow, onAsk, onChanged, brain }: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('open');
  const list = alerts.filter((a) => filter === 'all' || a.status === filter);
  const selected = alerts.find((a) => a.id === selectedId) ?? list[0] ?? null;

  return (
    <div className="grid-radar">
      <section className="panel" aria-labelledby="r-list">
        <h2 id="r-list">Alerts</h2>
        <div className="seg" role="tablist" aria-label="Filter alerts">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label} ({alerts.filter((a) => f.id === 'all' || a.status === f.id).length})
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <p className="muted pad">No {filter === 'all' ? '' : filter} alerts. Rules check every payment as it arrives.</p>
        ) : (
          <ul className="alert-list">
            {list.map((a) => (
              <li key={a.id}>
                <button className={`alert-row sev-${a.severity} ${selected?.id === a.id ? 'sel' : ''}`} onClick={() => onSelect(a.id)}>
                  <span className="sev">{SEVERITY_LABEL[a.severity]}</span>
                  <span className="title">{alertTitle(a)}</span>
                  <span className="meta">{when(a.at)} · {a.evidenceCount} {a.evidenceCount === 1 ? 'transaction' : 'transactions'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel detail" aria-live="polite">
        {selected ? <Detail key={selected.id} alert={selected} txns={txns} onShow={onShow} onAsk={onAsk} onChanged={onChanged} /> : <p className="muted">Select an alert to see why it was raised.</p>}
      </section>

      {brain && <div className="second-opinion"><SecondOpinion onShow={onShow} /></div>}
    </div>
  );
}

function Detail({ alert, txns, onShow, onAsk, onChanged }: { alert: Alert; txns: Txn[]; onShow: Props['onShow']; onAsk: Props['onAsk']; onChanged: () => Promise<void> }) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const evidenceIds = useMemo(() => [...new Set(alert.signals.flatMap((s) => s.evidenceIds))], [alert]);
  const evidence = useMemo(() => txns.filter((t) => evidenceIds.includes(t.id)).sort((a, b) => a.at - b.at), [txns, evidenceIds]);

  const loadActions = async () => setActions((await api<{ actions: Action[] }>(`/api/alerts/${alert.id}`)).actions);
  useEffect(() => { void loadActions().catch(() => setActions([])); }, [alert.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); await Promise.all([loadActions(), onChanged()]); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); setConfirming(null); }
  };

  const setStatus = (status: Alert['status']) => run(() => post(`/api/alerts/${alert.id}/status`, { status }), status === 'open' ? 'Reopened.' : `Marked ${status}.`);
  const decide = (a: Action, decision: 'approve' | 'reject') =>
    run(async () => {
      const r = await post<{ simulated?: boolean }>(`/api/actions/${a.id}/decision`, { decision, confirm: decision === 'approve' });
      return r;
    }, decision === 'reject' ? 'Proposal rejected.' : a.type === 'refund_draft' ? 'Approved. Demo mode: no money moved.' : 'Approved.');

  return (
    <>
      <header className={`detail-head sev-${alert.severity}`}>
        <div>
          <h2>{alertTitle(alert)}</h2>
          <p className="muted">{SEVERITY_LABEL[alert.severity]} severity · score {alert.score.toFixed(2)} · {when(alert.at)} · {alert.status}</p>
        </div>
        <div className="row">
          <button className="primary" onClick={() => onAsk('Investigate this alert and explain what to check first.', alert.id)}>Ask Queen to investigate</button>
        </div>
      </header>

      <h3>Why this was flagged</h3>
      <ul className="signals">
        {alert.signals.map((s) => (
          <li key={s.rule}>
            <p>{s.reason}</p>
            <button className="link" onClick={() => onShow({ ids: s.evidenceIds, label: `${s.evidenceIds.length} transactions behind “${alertTitle({ signals: [s] })}”` })}>
              Show the {s.evidenceIds.length} {s.evidenceIds.length === 1 ? 'transaction' : 'transactions'} in the grid
            </button>
          </li>
        ))}
      </ul>

      <h3>Evidence</h3>
      <div className="table-wrap">
        <table className="mini">
          <thead><tr><th>When</th><th>Type</th><th className="num">Amount</th><th>Customer</th></tr></thead>
          <tbody>
            {evidence.slice(0, 8).map((t) => (
              <tr key={t.id}><td>{when(t.at)}</td><td>{t.kind === 'failed' ? 'Failed' : t.kind === 'refund' ? 'Refund' : 'Payment'}</td><td className="num">{t.kind === 'refund' ? '-' : ''}{money(t.amountCents)}</td><td>{t.customer}</td></tr>
            ))}
          </tbody>
        </table>
        {evidence.length > 8 && <p className="muted pad">and {evidence.length - 8} more in the grid</p>}
      </div>

      <h3>What to do next</h3>
      <p>{alert.nextStep}</p>
      <p className="muted">HIVE never freezes accounts, blocks customers or moves money by itself. Anything below waits for your decision.</p>

      {actions && actions.length > 0 && (
        <ul className="actions">
          {actions.map((a) => (
            <li key={a.id} className={`action st-${a.status}`}>
              <div>
                <strong>{a.type === 'refund_draft' ? 'Refund draft' : 'Evidence packet'}</strong>
                <p>{a.payload.summary as string}</p>
                {a.type === 'refund_draft' && <p className="muted">{a.payload.reason as string} {a.payload.simulated ? 'This is a demo transaction, so approving only simulates the refund.' : ''}</p>}
                {a.status !== 'proposed' && <p className="status">Status: {a.status}{a.result?.message ? `. ${a.result.message as string}` : ''}</p>}
              </div>
              {a.status === 'proposed' && (
                <div className="row">
                  {confirming === a.id ? (
                    <>
                      <button className="danger" disabled={busy} onClick={() => void decide(a, 'approve')}>
                        {a.type === 'refund_draft' ? `Confirm refund of ${money(a.payload.amountCents as number)}` : 'Confirm export'}
                      </button>
                      <button disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="primary" disabled={busy} onClick={() => setConfirming(a.id)}>{a.type === 'refund_draft' ? 'Approve refund' : 'Approve export'}</button>
                      <button disabled={busy} onClick={() => void decide(a, 'reject')}>Reject</button>
                    </>
                  )}
                </div>
              )}
              {a.type === 'evidence_packet' && (
                <details>
                  <summary>Preview packet</summary>
                  <pre>{a.payload.text as string}</pre>
                  <button onClick={() => { const b = new Blob([a.payload.text as string], { type: 'text/plain' }); const u = URL.createObjectURL(b); const l = document.createElement('a'); l.href = u; l.download = `hive-alert-${alert.id}.txt`; l.click(); URL.revokeObjectURL(u); }}>Download as text</button>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="row end">
        {alert.status === 'open' ? (
          <>
            <button disabled={busy} onClick={() => void setStatus('reviewed')}>Mark reviewed</button>
            <button disabled={busy} onClick={() => void setStatus('dismissed')}>Dismiss as expected</button>
          </>
        ) : (
          <button disabled={busy} onClick={() => void setStatus('open')}>Reopen</button>
        )}
      </div>
      {msg && <p className="toast" role="status">{msg}</p>}
    </>
  );
}
