import { useState } from 'react';
import { post } from '../api';

export interface Op { id: number; kind: string; payload: Record<string, any>; status: 'proposed' | 'approved' | 'rejected' | 'executed' | 'failed'; result?: Record<string, any> }

export const STATUS: Record<Op['status'], string> = { proposed: 'Waiting for your decision', approved: 'Approved', rejected: 'Rejected', executed: 'Done', failed: 'Failed' };

/** Approve takes two steps: choose, then confirm. Nothing is sent until the second click. */
export function Decide({ op, verb, onDone }: { op: Op; verb: string; onDone: (msg: string) => void }) {
  const [step, setStep] = useState<'idle' | 'confirm'>('idle');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (decision: 'approve' | 'reject') => {
    setBusy(true); setErr('');
    try {
      const r = await post<{ simulated?: boolean }>(`/api/ops/${op.id}/decision`, { decision, confirm: decision === 'approve' });
      onDone(decision === 'reject' ? 'Rejected.' : r.simulated ? `${verb}: simulated, nothing left HIVE.` : `${verb}: sent to PayPal.`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); setStep('idle'); }
  };
  if (op.status !== 'proposed') return null;
  return (
    <div className="decide">
      {step === 'idle' ? (
        <><button className="primary" disabled={busy} onClick={() => setStep('confirm')}>{verb}…</button> <button disabled={busy} onClick={() => void run('reject')}>Reject</button></>
      ) : (
        <><span className="muted">Confirm: this goes to PayPal when not in demo mode.</span> <button className="primary" disabled={busy} onClick={() => void run('approve')}>{busy ? 'Working…' : 'Yes, do it'}</button> <button disabled={busy} onClick={() => setStep('idle')}>Back</button></>
      )}
      {err && <p className="notice error" role="alert">{err}</p>}
    </div>
  );
}

export function StatusPill({ op }: { op: Op }) { return <span className={`pill st-${op.status}`}>{STATUS[op.status]}{op.result?.simulated ? ' (simulated)' : ''}</span>; }
