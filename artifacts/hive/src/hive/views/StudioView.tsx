import { useEffect, useMemo, useState } from 'react';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { AgStudioAiModule } from 'ag-studio';
import type { AgDataSourcesDefinition, AgReportState, AgStudioApi } from 'ag-studio';
import { api, type Alert, type CustomerRow, type Txn } from '../api';
import { buildStudioData } from '../studio/data';
import { hiveReport, PAGE_TITLES } from '../studio/report';
import { hiveStudioTheme } from '../studio/theme';
import { hiveStudioWidgets, type HiveStudioRegistry } from '../studio/evidence-widget';
import { hiveStudioAi } from '../studio/ai';

interface Props { demo: boolean; licenseKey: string; txns: Txn[]; alerts: Alert[] }

/** The AG Studio dashboard. Loaded lazily so the rest of the app stays light. */
export default function StudioView({ demo, licenseKey, txns, alerts }: Props) {
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [page, setPage] = useState(hiveReport.selectedPageId);
  const [studio, setStudio] = useState<AgStudioApi | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => { api<CustomerRow[]>('/api/customers').then(setCustomers).catch(() => setCustomers([])); }, []);
  const data = useMemo(
    () => customers
      ? buildStudioData(txns, alerts, customers) as unknown as AgDataSourcesDefinition<HiveStudioRegistry>
      : null,
    [txns, alerts, customers],
  );
  const initialState = hiveReport as unknown as AgReportState<HiveStudioRegistry>;

  const go = (id: string) => {
    setPage(id);
    if (studio) studio.setState({ ...studio.getState(), selectedPageId: id });
  };

  if (!data) return <p className="muted pad">Loading dashboard data…</p>;
  if (!txns.length) return <p className="muted pad">No transactions yet. Make a payment in the Shop tab or let a webhook arrive, then open this dashboard.</p>;

  return (
    <section aria-labelledby="studio-h" className="studio-wrap">
      <div className="studio-bar">
        <div>
          <h2 id="studio-h">Studio dashboard</h2>
          <p className="muted">{demo
            ? 'AG Studio uses HIVE’s synthetic report data. Gemini can explain signals and reshape the dashboard; Vertex AI usage is billed to the connected Google Cloud project.'
            : 'AG Studio uses HIVE’s PayPal Sandbox report data. Its natural-language assistant is disabled here so transaction details are not sent to a model from this dashboard.'}</p>
        </div>
        <div className="seg studio-tabs" role="tablist" aria-label="Dashboard pages">
          {hiveReport.pages.map((p) => (
            <button key={p.id} role="tab" aria-selected={page === p.id} className={page === p.id ? 'on' : ''} onClick={() => go(p.id)}>{PAGE_TITLES[p.id] ?? p.id}</button>
          ))}
          <button className={editing ? 'on' : ''} onClick={() => setEditing((v) => !v)}>{editing ? 'Done editing' : 'Edit widgets'}</button>
        </div>
      </div>
      <div className="studio-canvas">
        <AgStudioProvider licenseKey={licenseKey || undefined} modules={demo ? [AgStudioAiModule] : []}>
          <AgStudio<HiveStudioRegistry>
            style={{ height: '100%', width: '100%' }}
            theme={hiveStudioTheme}
            layout={{ widgetBorderEnabled: true }}
            data={data}
            initialState={initialState}
            widgets={hiveStudioWidgets}
            {...(demo ? { ai: hiveStudioAi } : {})}
            mode={editing ? 'edit' : 'view'}
            onApiReady={(e) => setStudio(e.api)}
          />
        </AgStudioProvider>
      </div>
    </section>
  );
}
