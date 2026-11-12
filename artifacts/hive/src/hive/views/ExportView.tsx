import { alertTitle, money, type Alert, type Txn } from '../api';

const esc = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function download(name: string, rows: unknown[][]) {
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV exports. Cells that start with = + - @ are prefixed so a spreadsheet cannot run attacker-written text as a formula. */
export function ExportView({ txns, alerts }: { txns: Txn[]; alerts: Alert[] }) {
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <section className="panel" aria-labelledby="ex-h">
      <h2 id="ex-h">Export center</h2>
      <p className="muted">Customer names are the anonymous aliases HIVE already shows. Notes are exported as plain text.</p>
      <div className="export-grid">
        <div><h3>Transactions</h3><p className="muted">{txns.length} rows: date, kind, amount, fee, customer alias, alert ids.</p>
          <button className="primary" onClick={() => download(`hive-transactions-${stamp}.csv`, [['id', 'date', 'kind', 'amount', 'fee', 'currency', 'customer', 'alerts', 'note'], ...txns.map((t) => [t.id, new Date(t.at).toISOString(), t.kind, (t.amountCents / 100).toFixed(2), (t.feeCents / 100).toFixed(2), t.currency, t.customer, t.alerts.map((a) => a.id).join(' '), t.note])])}>Download transactions</button></div>
        <div><h3>Alert evidence</h3><p className="muted">{alerts.length} alerts with severity, reasons and the transaction ids behind each one. Attach it to a dispute or a PayPal support case.</p>
          <button className="primary" onClick={() => download(`hive-alerts-${stamp}.csv`, [['alert', 'status', 'severity', 'title', 'reason', 'next step', 'transaction ids'], ...alerts.flatMap((a) => a.signals.map((s) => [a.id, a.status, a.severity, alertTitle(a), s.reason, a.nextStep, s.evidenceIds.join(' ')]))])}>Download alert evidence</button></div>
      </div>
      <p className="muted">Total payments in this export: {money(txns.filter((t) => t.kind === 'payment').reduce((s, t) => s + t.amountCents, 0))}.</p>
    </section>
  );
}
