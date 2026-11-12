import { AgCharts } from 'ag-charts-react';
import type { AgCartesianChartOptions } from 'ag-charts-community';
import { alertTitle, money, SEVERITY_LABEL, dayOf, type Alert, type Growth, type Severity, type Summary } from '../api';
import { Colony } from '../components/Colony';
import { HiveScene } from '../motion/HiveScene';
import { Honeycomb } from '../components/Honeycomb';

interface Props { summary: Summary; alerts: Alert[]; growth: Growth | null; onDay: (day: string) => void; onOpenAlert: (id: number) => void }

const change = (now: number, before: number) => {
  const d = now - before;
  return `${money(d, true)} vs the 30 days before`;
};

export function HiveView({ summary, alerts, growth, onDay, onOpenAlert }: Props) {
  const a = summary.last30, p = summary.prior30;
  const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  const alertDays = new Map<string, Severity>();
  for (const al of alerts.filter((x) => x.status === 'open')) {
    const d = dayOf(al.at);
    const cur = alertDays.get(d);
    if (!cur || rank[al.severity] > rank[cur]) alertDays.set(d, al.severity);
  }
  const open = alerts.filter((x) => x.status === 'open').sort((x, y) => rank[y.severity] - rank[x.severity]).slice(0, 4);

  const chart: AgCartesianChartOptions = {
    data: summary.daily,
    background: { fill: 'transparent' },
    padding: { top: 8, right: 8, bottom: 4, left: 4 },
    legend: { position: 'bottom' },
    series: [
      { type: 'area', xKey: 'day', yKey: 'revenue', yName: 'Revenue', fill: '#E8A317', fillOpacity: 0.35, stroke: '#B97C00', marker: { enabled: false } },
      { type: 'line', xKey: 'day', yKey: 'refunds', yName: 'Refunds', stroke: '#C2362B', strokeWidth: 2, marker: { enabled: false } },
    ],
    axes: [
      { type: 'category', position: 'bottom', label: { formatter: (p: { value: string }) => p.value.slice(5), rotation: 0, avoidCollisions: true, minSpacing: 14 } },
      { type: 'number', position: 'left', label: { formatter: (p: { value: number }) => `$${p.value}` } },
    ],
  };

  return (
    <div className="grid-hive">
      <HiveScene payments={summary.daily[summary.daily.length - 1]?.payments ?? 0} openAlerts={alerts.filter((x) => x.status === 'open').length} highAlerts={alerts.filter((x) => x.status === 'open' && x.severity === 'high').length} />
      <section className="panel comb-panel" aria-labelledby="h-comb">
        <h2 id="h-comb">The last 60 days</h2>
        <p className="muted">Each cell is a day. Deeper honey means more revenue.</p>
        <Honeycomb days={summary.daily} alertDays={alertDays} onPick={onDay} />
      </section>

      <section className="panel figures" aria-labelledby="h-fig">
        <h2 id="h-fig">Last 30 days</h2>
        <dl>
          <div className="kept"><dt>You kept</dt><dd>{money(a.netCents)}</dd><small>{change(a.netCents, p.netCents)}. After refunds and PayPal fees.</small></div>
          <div><dt>Revenue</dt><dd>{money(a.revenueCents)}</dd><small>{a.payments} payments, {change(a.revenueCents, p.revenueCents)}</small></div>
          <div><dt>Refunds</dt><dd>{money(a.refundCents)}</dd><small>{a.refunds} refunds, {change(a.refundCents, p.refundCents)}</small></div>
          <div><dt>PayPal fees</dt><dd>{money(a.feesCents)}</dd><small>{a.revenueCents ? ((a.feesCents / a.revenueCents) * 100).toFixed(1) : '0.0'}% of revenue</small></div>
          <div><dt>Repeat customers</dt><dd>{(summary.repeatRate * 100).toFixed(0)}%</dd><small>of customers who paid in the last 30 days</small></div>
          {summary.topCustomer && (
            <div><dt>Biggest customer</dt><dd>{(summary.topCustomer.shareOfRevenue * 100).toFixed(0)}%</dd><small>of revenue came from {summary.topCustomer.alias}</small></div>
          )}
        </dl>
      </section>

      <section className="panel chart-panel" aria-labelledby="h-chart">
        <h2 id="h-chart">Revenue and refunds by day</h2>
        <div className="chart" role="img" aria-label="Line and area chart of daily revenue and refunds for the last 60 days">
          <AgCharts options={chart} />
        </div>
      </section>

      <section className="panel attention" aria-labelledby="h-att">
        <h2 id="h-att">Needs your attention</h2>
        {open.length === 0 ? (
          <p className="muted">Nothing open. New alerts appear here as payments arrive.</p>
        ) : (
          <ul className="alert-list compact">
            {open.map((al) => (
              <li key={al.id}>
                <button className={`alert-row sev-${al.severity}`} onClick={() => onOpenAlert(al.id)}>
                  <span className="sev">{SEVERITY_LABEL[al.severity]}</span>
                  <span className="title">{alertTitle(al)}</span>
                  <span className="meta">{al.evidenceCount} {al.evidenceCount === 1 ? 'transaction' : 'transactions'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {growth && <Colony growth={growth} />}
    </div>
  );
}
