import { useEffect, useState } from 'react';
import { AgCharts } from 'ag-charts-react';
import type { AgCartesianChartOptions } from 'ag-charts-community';
import { emit } from '../motion/bus';
import { alertTitle, api, duration, post, SCENARIO_TITLE, type Alert, type LabReport, type SimResult } from '../api';

const LAUNCH: Array<{ id: string; label: string; note: string }> = [
  { id: 'card_testing', label: 'Card testing', note: '12 tiny payments in 8 minutes' },
  { id: 'slow_card_testing', label: 'Slow card testing', note: 'the same tiny payments spread over 48 minutes' },
  { id: 'duplicate_payment', label: 'Duplicate payment', note: 'the same amount twice in 40 seconds' },
  { id: 'new_customer_large', label: 'Large first order', note: 'one huge order, with a hidden instruction in the note' },
  { id: 'failed_streak', label: 'Failed payments', note: 'five declines from one customer' },
  { id: 'refund_abuse', label: 'Refund abuse', note: 'three buy-and-refund cycles' },
];

export function LabView({ demo, onChanged, onOpenAlert }: { demo: boolean; onChanged: () => Promise<void>; onOpenAlert: (id: number) => void }) {
  const [sim, setSim] = useState<{ result: SimResult; title: string } | null>(null);
  const [simBusy, setSimBusy] = useState<string | null>(null);

  const launch = async (attack: string) => {
    setSimBusy(attack); setErr(null); setSim(null);
    try {
      const result = await post<SimResult>('/api/demo/simulate', { attack });
      await onChanged();
      const alerts = await api<Alert[]>('/api/alerts');
      const first = alerts.find((a) => result.alertIds.includes(a.id));
      setSim({ result, title: first ? alertTitle(first) : '' });
      // The animation mirrors the real outcome: it only shows a catch if HIVE actually raised an alert.
      emit('attack', { transactions: result.transactions, caughtAfter: result.alertIds.length > 0 ? result.firstAlertAfter : null, title: first ? alertTitle(first) : '' });
    } catch (e) { setErr((e as Error).message); }
    finally { setSimBusy(null); }
  };

  const [report, setReport] = useState<LabReport | null>(null);
  const [seeds, setSeeds] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api<LabReport>('/api/wasplab').then(setReport).catch((e: Error) => setErr(e.message)); }, []);

  const run = async () => {
    setBusy(true); setErr(null);
    try { setReport(await post<LabReport>('/api/wasplab/run', { seeds })); await onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const chart: AgCartesianChartOptions | null = report && {
    data: report.scenarios.map((s) => ({ name: SCENARIO_TITLE[s.attack] ?? s.attack, any: Math.round(s.recall * 100), right: Math.round((s.caughtByExpectedRule / s.runs) * 100) })),
    background: { fill: 'transparent' },
    legend: { enabled: false },
    series: [
      { type: 'bar', xKey: 'name', yKey: 'any', yName: 'Caught by any rule', fill: '#E8A317' },
      { type: 'bar', xKey: 'name', yKey: 'right', yName: 'Caught by the intended rule', fill: '#2B1D3A' },
    ],
    axes: [
      { type: 'category', position: 'bottom' },
      { type: 'number', position: 'left', min: 0, max: 100, label: { formatter: (p: { value: number }) => `${p.value}%` } },
    ],
  };

  return (
    <section className="panel lab" aria-labelledby="l-h">
      <h2 id="l-h">Wasp Lab</h2>
      <p>Wasp Lab plays realistic attacks against HIVE’s detection and reports what it caught and what it missed. Each scenario runs on a different random 60 days of ordinary shop traffic, including honest oddities like a flash sale.</p>
      <div className="row">
        <label htmlFor="l-s">Runs per scenario</label>
        <select id="l-s" value={seeds} onChange={(e) => setSeeds(Number(e.target.value))}>
          {[5, 10, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className="primary" onClick={() => void run()} disabled={busy}>{busy ? 'Running…' : 'Run Wasp Lab'}</button>
      </div>
      {err && <p className="notice error" role="alert">{err}</p>}

      <h3>Attack the demo shop</h3>
      {demo ? (
        <>
          <p className="muted">Launch an attack now and watch HIVE catch it. These are simulated transactions, labelled as synthetic in the audit log, pushed through the same detection that handles real PayPal events.</p>
          <div className="launch">
            {LAUNCH.map((l) => (
              <button key={l.id} className="launch-btn" disabled={simBusy !== null} onClick={() => void launch(l.id)}>
                <strong>{simBusy === l.id ? 'Launching…' : l.label}</strong><small>{l.note}</small>
              </button>
            ))}
          </div>
          {sim && (
            <div className="notice warn" role="status">
              {sim.result.alertIds.length > 0 ? (
                <p>Caught. HIVE raised <strong>{sim.title || 'an alert'}</strong> after {sim.result.firstAlertAfter} of {sim.result.transactions} transactions. <button className="link" onClick={() => onOpenAlert(sim.result.alertIds[0] as number)}>Open the alert</button></p>
              ) : <p>HIVE did not raise an alert for this one.</p>}
            </div>
          )}
        </>
      ) : (
        <p className="muted">Optional Sandbox test, not run here: first enable a PayPal Sandbox app, database, and webhook. Then run <code>HIVE_URL=https://YOUR-HOST/hive pnpm --filter @workspace/hive run wasplab:live -- card_testing</code>. It creates Sandbox orders and needs a Sandbox buyer approval; no real money moves.</p>
      )}

      <h3>Scorecard on synthetic history</h3>
      {report && (
        <>
          <div className="table-wrap">
            <table className="score">
              <caption className="sr">Detection results by attack scenario</caption>
              <thead><tr><th>Attack</th><th className="num">Caught</th><th className="num">By the intended rule</th><th className="num">Typical time to alert</th></tr></thead>
              <tbody>
                {report.scenarios.map((s) => (
                  <tr key={s.attack} className={s.caught < s.runs ? 'miss' : ''}>
                    <td>{SCENARIO_TITLE[s.attack] ?? s.attack}</td>
                    <td className="num">{s.caught} of {s.runs}</td>
                    <td className="num">{s.caughtByExpectedRule} of {s.runs}</td>
                    <td className="num">{duration(s.medianDetectMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="chart tall" role="img" aria-label="Bar chart of detection rate for each attack scenario">{chart && <AgCharts options={chart} />}</div>
          <p className="legend key"><span><i className="sw" style={{ background: '#E8A317' }} /> Caught by any rule</span><span><i className="sw" style={{ background: '#2B1D3A' }} /> Caught by the intended rule</span></p>

          <ul className="facts">
            <li><strong>{report.falseAlarmsPer1000Benign.toFixed(1)}</strong> false alarms per 1,000 ordinary transactions</li>
            <li><strong>{(report.hardNegativeFalseAlarmRate * 100).toFixed(0)}%</strong> false alarms on honest-but-unusual activity</li>
            <li><strong>{report.injection.attacksFlagged} of {report.injection.attacksTotal}</strong> instruction-style notes flagged; <strong>{report.injection.benignFlagged} of {report.injection.benignTotal}</strong> normal notes wrongly flagged</li>
          </ul>

          <div className="notice warn">
            <p><strong>Read this carefully.</strong> This is synthetic data and the attacks were written by the HIVE team, so the scorecard shows that the rules behave as designed. It is not a measure of real-world fraud detection. {report.misses.length > 0 ? `Misses are kept in: ${report.misses.length} ${report.misses.length === 1 ? 'run was' : 'runs were'} not caught.` : ''}</p>
          </div>
        </>
      )}
    </section>
  );
}
