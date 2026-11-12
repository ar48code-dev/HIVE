import { when, type AuditEntry } from '../api';

const LABEL: Record<string, string> = {
  demo_seeded: 'Demo data loaded', alert_created: 'Alert raised', alert_reviewed: 'Alert marked reviewed', alert_dismissed: 'Alert dismissed', alert_open: 'Alert reopened',
  action_approved: 'Action approved', action_rejected: 'Action rejected', action_executed: 'Action carried out', action_failed: 'Action failed',
  answered: 'Queen answered a question', wasplab_run: 'Wasp Lab run', attack_simulated: 'Simulated attack launched (synthetic)', backfill: 'History imported from PayPal',
};

export function AuditView({ entries }: { entries: AuditEntry[] }) {
  return (
    <section className="panel" aria-labelledby="au-h">
      <h2 id="au-h">Audit log</h2>
      <p className="muted">Everything HIVE and you did, newest first. Nothing that moves money happens without a line here.</p>
      {entries.length === 0 ? <p className="muted pad">Nothing yet.</p> : (
        <div className="table-wrap">
          <table className="mini audit">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}><td>{when(e.at)}</td><td>{e.actor === 'user' ? 'You' : e.actor === 'queen-ai' ? 'Queen AI' : 'HIVE'}</td><td>{LABEL[e.event] ?? e.event}</td><td className="muted">{JSON.stringify(e.detail).slice(0, 140)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
