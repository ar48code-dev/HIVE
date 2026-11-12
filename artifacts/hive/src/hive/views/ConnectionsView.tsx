import { useEffect, useState } from 'react';
import { api, post } from '../api';

interface Item { id: string; name: string; state: 'live' | 'configured' | 'missing' | 'error'; detail: string; fix?: string }
interface Conn { demo: boolean; tested: boolean; items: Item[] }
const LABEL = { live: 'Working', configured: 'Set, not tested', missing: 'Not connected', error: 'Failed' } as const;

/** One place to see what is really connected. Tests are explicit and secrets are never shown. */
export function ConnectionsView() {
  const [c, setC] = useState<Conn | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [alertResult, setAlertResult] = useState('');
  const load = async (test?: 'paypal' | 'gemini') => {
    setBusy(true); setErr('');
    try { setC(await api<Conn>(`/api/connections${test ? `?test=${test}` : ''}`)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const testAlertDelivery = async () => {
    setBusy(true); setErr(''); setAlertResult('');
    try {
      const result = await post<{ detail: string }>('/api/connections/gmail-test', {});
      setAlertResult(result.detail);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  return (
    <section className="panel" aria-labelledby="cn-h">
      <h2 id="cn-h">Connections</h2>
      <p className="muted">Tests make real Sandbox or Vertex AI calls. Gemini requests are billed to Google Cloud. The Gmail test sends a real message to the configured recipient; secrets are never shown.</p>
      <p>
        <button className="primary" disabled={busy} onClick={() => void load('paypal')}>{busy ? 'Testing…' : 'Test PayPal Sandbox'}</button>{' '}
        <button className="secondary" disabled={busy} onClick={() => void load('gemini')}>{busy ? 'Testing…' : 'Test Gemini'}</button>
      </p>
      <p><button className="secondary" disabled={busy || !c?.items.some((item) => item.id === 'email' && item.state === 'configured')} onClick={() => void testAlertDelivery()}>{busy ? 'Testing…' : 'Send Gmail test email'}</button></p>
      {alertResult && <div className="notice" role="status"><p>{alertResult}</p></div>}
      {err && <div className="notice error" role="alert"><p>{err}</p></div>}
      {c && (
        <ul className="conn-list">
          {c.items.map((i) => (
            <li key={i.id} className={`conn ${i.state}`}>
              <span className="conn-dot" aria-hidden="true" />
              <div><strong>{i.name}</strong> <span className="conn-state">{LABEL[i.state]}</span>
                <p className="muted">{i.detail}</p>
                {i.fix && <p className="conn-fix"><b>To fix:</b> {i.fix}</p>}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
