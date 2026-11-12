import { lazy, Suspense, useEffect, useState } from 'react';
import { api, money, type Recurring } from '../api';
import type { Focus } from '../App';

const BryntumCalendar = lazy(() => import('./BryntumCalendar')); // big library: loaded only when the month view opens

interface Resp { asOf: number; items: Recurring[]; note: string }

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const rel = (d: number) => (d < -1 ? `${Math.round(-d)} days late` : d < 0.5 ? 'due today' : d < 1.5 ? 'tomorrow' : `in ${Math.round(d)} days`);

export function CalendarView({ onShow }: { onShow: (f: Focus) => void }) {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [month, setMonth] = useState(false);
  useEffect(() => { api<Resp>('/api/recurring').then(setData).catch((e: Error) => setErr(e.message)); }, []);

  const upcoming = (data?.items ?? []).filter((i) => !i.overdue);
  const late = (data?.items ?? []).filter((i) => i.overdue);
  // How many payments each rhythm should bring in the next 30 days, if it holds.
  const expected30 = upcoming.reduce((sum, i) => (i.daysUntil <= 30 ? sum + (Math.floor((30 - Math.max(0, i.daysUntil)) / i.cadenceDays) + 1) * i.typicalCents : sum), 0);

  const row = (i: Recurring) => (
    <tr key={i.customer}>
      <td><strong>{day(i.nextAt)}</strong><br /><small className="muted">{rel(i.daysUntil)}</small></td>
      <td>{i.customer}</td>
      <td className="num">{money(i.typicalCents)}</td>
      <td>every {i.cadenceDays} days</td>
      <td>{i.confidence}</td>
      <td><button className="link" onClick={() => onShow({ ids: i.paymentIds, label: `the ${i.paymentIds.length} payments behind ${i.customer}’s rhythm` })}>{i.paymentIds.length} payments</button></td>
    </tr>
  );
  const head = <thead><tr><th>Expected</th><th>Customer</th><th className="num">Usual amount</th><th>Rhythm</th><th>Confidence</th><th>Based on</th></tr></thead>;

  return (
    <section className="panel" aria-labelledby="ca-h">
      <h2 id="ca-h">Calendar</h2>
      <div className="notice warn"><p><strong>These are estimates.</strong> HIVE looks for customers who pay on a steady rhythm and guesses when they will pay next. Nothing here is a confirmed payment.</p></div>
      {err && <p className="notice error" role="alert">{err}</p>}
      {!data && !err && <p className="muted">Looking for patterns…</p>}
      {data && data.items.length === 0 && <p className="muted pad">No steady payers found yet. A customer needs at least three payments with similar spacing and amounts.</p>}
      {data && data.items.length > 0 && (
        <p><button className="link" aria-pressed={month} onClick={() => setMonth((m) => !m)}>{month ? 'Hide month view' : 'Show month view'}</button> <span className="tag">Bryntum Calendar</span></p>
      )}
      {month && data && (
        <Suspense fallback={<p className="muted">Loading calendar…</p>}>
          <div className="bryntum-card"><BryntumCalendar items={data.items} asOf={data.asOf} onPick={(i) => onShow({ ids: i.paymentIds, label: `the ${i.paymentIds.length} payments behind ${i.customer}’s rhythm` })} /></div>
          <p className="muted">Green is a high-confidence rhythm, blue medium, grey low, red already late. All dates are estimates.</p>
        </Suspense>
      )}
      {data && upcoming.length > 0 && (
        <>
          <p className="big-estimate">Roughly <strong>{money(expected30)}</strong> could arrive in the next 30 days <span className="tag">estimate</span></p>
          <h3>Coming up</h3>
          <div className="table-wrap"><table className="mini">{head}<tbody>{upcoming.map(row)}</tbody></table></div>
        </>
      )}
      {late.length > 0 && (
        <>
          <h3>Running late</h3>
          <p className="muted">These customers usually pay by now. A late payment can be nothing, or worth a friendly nudge.</p>
          <div className="table-wrap"><table className="mini">{head}<tbody>{late.map(row)}</tbody></table></div>
        </>
      )}
    </section>
  );
}
