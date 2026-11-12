import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { emit } from './motion/bus';
import { AttackTheater } from './motion/AttackTheater';
import { BeeLoader, BeeLogo, MotionToggle } from './motion/Logo';
import { api, post, type Alert, type AuditEntry, type Growth, type Summary, type Txn } from './api';
import { CustomersView } from './views/CustomersView';
import { CalendarView } from './views/CalendarView';
import { ShopView } from './views/ShopView';
import { HiveView } from './views/HiveView';
import { RadarView } from './views/RadarView';
import { QueenView, type Turn } from './views/QueenView';
import { AnalyticsView } from './views/AnalyticsView';
import { LabView } from './views/LabView';
import { AuditView } from './views/AuditView';
import { getToken, setToken, type ModeInfo } from './api';
import { HiveHub } from './hub/HiveHub';
import type { Tab } from './hub/features';
import { ConnectionsView } from './views/ConnectionsView';
import { BriefView } from './views/BriefView';
import { FeesView } from './views/FeesView';
import { OutlookView } from './views/OutlookView';
import { ExportView } from './views/ExportView';
import { DisputesView } from './views/DisputesView';
import { PayoutsView } from './views/PayoutsView';
import { InvoicesView } from './views/InvoicesView';
import { AgentGateView } from './views/AgentGateView';
const StudioView = lazy(() => import('./views/StudioView'));

export type { Tab };
export interface Focus { ids?: string[]; day?: string; label: string }
export interface QueenSeed { question: string; alertId?: number; nonce: number }

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: 'Hub' },
  { id: 'hive', label: 'Honey Stats' },
  { id: 'radar', label: 'Wasp Radar' },
  { id: 'queen', label: 'Queen AI' },
  { id: 'customers', label: 'Customers' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'studio', label: 'Studio' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'shop', label: 'Shop' },
  { id: 'lab', label: 'Wasp Lab' },
  { id: 'brief', label: 'Daily Brief' },
  { id: 'fees', label: 'Fee Insights' },
  { id: 'outlook', label: 'Cash Outlook' },
  { id: 'export', label: 'Export' },
  { id: 'disputes', label: 'Disputes' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'agent', label: 'Agent Gate' },
  { id: 'connections', label: 'Connections' },
  { id: 'audit', label: 'Audit log' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [mode, setMode] = useState<ModeInfo | null>(null);
  const [studioKey, setStudioKey] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenOk, setTokenOk] = useState(() => !!getToken());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 6000); };
  const seen = useRef<{ txns: number; alerts: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<number | null>(null);
  const [seed, setSeed] = useState<QueenSeed | null>(null);
  const [queenTurns, setQueenTurns] = useState<Turn[]>([]);

  useEffect(() => { api<{ agStudioLicense?: string }>('/api/config').then((c) => setStudioKey(c.agStudioLicense ?? '')).catch(() => undefined); }, []);

  const saveToken = async () => {
    setToken(tokenInput.trim());
    try { await post('/api/auth/check', {}); setTokenOk(true); setToast('Access token accepted.'); }
    catch (e) { setToken(''); setTokenOk(false); setToast((e as Error).message); }
  };

  const load = useCallback(async () => {
    try {
      const [m, s, t, a, l, g] = await Promise.all([
        api<ModeInfo>('/api/mode'),
        api<Summary>('/api/summary'),
        api<Txn[]>('/api/transactions'),
        api<Alert[]>('/api/alerts'),
        api<AuditEntry[]>('/api/audit'),
        api<Growth>('/api/growth'),
      ]);
      setMode(m); setSummary(s); setTxns(t); setAlerts(a); setAudit(l); setGrowth(g); setError(null);
      const prev = seen.current;
      if (prev) {
        const newTx = t.length - prev.txns, newAl = a.length - prev.alerts;
        if (newTx > 0 || newAl > 0) {
          if (newTx > 0) emit('payment', { count: newTx });
          if (newAl > 0) emit('alert', { severity: a[0]?.severity ?? 'medium' });
          setToast(`${newTx > 0 ? `${newTx} new ${newTx === 1 ? 'transaction' : 'transactions'}` : ''}${newTx > 0 && newAl > 0 ? ' and ' : ''}${newAl > 0 ? `${newAl} new ${newAl === 1 ? 'alert' : 'alerts'}` : ''} arrived`);
          window.setTimeout(() => setToast(null), 6000);
        }
      }
      seen.current = { txns: t.length, alerts: a.length };
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Pick up payments that arrive by webhook without a page refresh.
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => { void load(); }, [load]);

  const showTxns = (f: Focus) => { setFocus(f); setTab('analytics'); };
  const openAlert = (id: number) => { setSelectedAlert(id); setTab('radar'); };
  const askQueen = (question: string, alertId?: number) => { setSeed({ question, alertId, nonce: Date.now() }); setTab('queen'); };

  return (
    <div className={`shell${tab === 'home' ? ' hub-mode' : ''}`}>
      <nav className="rail" aria-label="Main">
        <button className="brand" aria-label="HIVE home" onClick={() => setTab('home')}>
          <BeeLogo size={38} />
          <span>HIVE</span>
        </button>
        <ul>
          {TABS.map((t) => (
            <li key={t.id}>
              <button className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => { setTab(t.id); if (t.id === 'analytics') setFocus(null); }}>
                <i className="hexi" aria-hidden="true" />
                <span>{t.label}</span>
                {t.id === 'radar' && alerts.some((a) => a.status === 'open') && (
                  <b className="count" aria-label={`${alerts.filter((a) => a.status === 'open').length} open alerts`}>{alerts.filter((a) => a.status === 'open').length}</b>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="main">
        <header className="top">
          <div>
            <h1>The colony that investigates your money</h1>
            <p className="sub">Every conclusion comes with the transactions behind it.</p>
          </div>
          {mode && (
            <div className="badges">
              {mode.demo && <span className="badge demo" title="Everything on screen is generated, not real account data">Demo data (synthetic)</span>}
              {!mode.demo && <span className="badge sandbox" title="Persistent HIVE database is connected. PayPal is Sandbox-only; no real money moves.">Sandbox · test payments only</span>}
              <span className="badge" title={mode.ai === 'template' ? 'No AI key set. Answers come from rule-based templates.' : 'Answers are written by the model and checked before you see them.'}>
                Queen AI: {mode.ai === 'template' ? 'rule-based templates' : mode.ai}
              </span>
              <MotionToggle />
            </div>
          )}
        </header>

        {mode?.authRequired && !tokenOk && (
          <form className="notice token" onSubmit={(e) => { e.preventDefault(); void saveToken(); }}>
            <label htmlFor="tok">Viewing is open. To approve actions or change alert status, enter the HIVE admin token stored in Replit Secrets as ADMIN_TOKEN.</label>
            <input id="tok" type="password" autoComplete="off" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="Access token" />
            <button type="submit">Unlock</button>
          </form>
        )}

        {error && (
          <div className="notice error" role="alert">
            <p>We could not load your data: {error}</p>
            <button onClick={() => void load()}>Try again</button>
          </div>
        )}

        {!summary && !error && <BeeLoader />}

        {summary && (
          <div key={tab} className="view-enter">
            {tab === 'home' && <HiveHub txns={txns} alerts={alerts} demo={mode?.demo ?? true} ai={mode?.ai ?? 'template'} connected={!!mode && !mode.demo} onOpen={(t) => { if (t === 'analytics') setFocus(null); setTab(t); }} onOpenAlert={openAlert} />}
            {tab === 'brief' && <BriefView summary={summary} alerts={alerts} onAsk={askQueen} />}
            {tab === 'fees' && <FeesView txns={txns} />}
            {tab === 'outlook' && <OutlookView summary={summary} />}
            {tab === 'export' && <ExportView txns={txns} alerts={alerts} />}
            {tab === 'connections' && <ConnectionsView />}
            {tab === 'disputes' && <DisputesView onToast={flash} />}
            {tab === 'payouts' && <PayoutsView onToast={flash} />}
            {tab === 'invoices' && <InvoicesView onToast={flash} />}
            {tab === 'agent' && <AgentGateView />}
            {tab === 'hive' && <HiveView summary={summary} alerts={alerts} growth={growth} onDay={(day) => showTxns({ day, label: `Transactions on ${day}` })} onOpenAlert={openAlert} />}
            {tab === 'radar' && <RadarView alerts={alerts} txns={txns} selectedId={selectedAlert} onSelect={setSelectedAlert} onShow={showTxns} onAsk={askQueen} onChanged={load} brain={mode?.secondOpinion} />}
            {tab === 'queen' && <QueenView seed={seed} turns={queenTurns} setTurns={setQueenTurns} onSeedUsed={() => setSeed(null)} onShow={showTxns} onChanged={load} />}
            {tab === 'customers' && <CustomersView />}
            {tab === 'calendar' && <CalendarView onShow={showTxns} />}
            {tab === 'shop' && <ShopView demo={mode?.demo ?? true} onChanged={load} />}
            {tab === 'analytics' && <AnalyticsView txns={txns} focus={focus} onClear={() => setFocus(null)} />}
            {tab === 'lab' && <LabView demo={mode?.demo ?? true} onChanged={load} onOpenAlert={openAlert} />}
            {tab === 'studio' && <Suspense fallback={<p className="muted pad">Loading AG Studio…</p>}><StudioView demo={mode?.demo ?? true} licenseKey={studioKey} txns={txns} alerts={alerts} /></Suspense>}
            {tab === 'audit' && <AuditView entries={audit} />}
          </div>
        )}
        <footer className="foot">
          HIVE is a monitoring assistant, not financial advice, and it cannot guarantee fraud prevention. Predictions are estimates, never confirmed income.
        </footer>
        {toast && <p className="toast live" role="status">{toast}</p>}
        <AttackTheater />
      </main>
    </div>
  );
}
