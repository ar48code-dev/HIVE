import { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { themeQuartz, type ColDef, type RowClassParams } from 'ag-grid-community';
import { dayOf, money, when, SEVERITY_LABEL, type Txn } from '../api';
import type { Focus } from '../App';

const theme = themeQuartz.withParams({
  accentColor: '#B97C00',
  backgroundColor: '#FFFFFF',
  foregroundColor: '#241A31',
  headerBackgroundColor: '#F3F1F6',
  borderColor: '#E1DCE8',
  fontFamily: "'Public Sans', system-ui, sans-serif",
  headerFontFamily: "'Bricolage Grotesque', 'Public Sans', system-ui, sans-serif",
  headerFontWeight: 600,
  rowHoverColor: '#FBF4E2',
  fontSize: 14,
});

export function AnalyticsView({ txns, focus, onClear }: { txns: Txn[]; focus: Focus | null; onClear: () => void }) {
  const [quick, setQuick] = useState('');
  const ids = useMemo(() => (focus?.ids ? new Set(focus.ids) : null), [focus]);

  const rows = useMemo(() => {
    if (!focus) return txns;
    if (ids) return txns.filter((t) => ids.has(t.id));
    if (focus.day) return txns.filter((t) => dayOf(t.at) === focus.day);
    return txns;
  }, [txns, focus, ids]);

  const cols = useMemo<ColDef<Txn>[]>(() => [
    { headerName: 'When', field: 'at', valueFormatter: (p) => when(p.value as number), filter: 'agNumberColumnFilter', sort: 'desc', width: 170 },
    { headerName: 'Type', field: 'kind', valueFormatter: (p) => ({ payment: 'Payment', refund: 'Refund', failed: 'Failed' }[p.value as string] ?? String(p.value)), filter: 'agTextColumnFilter', width: 120 },
    { headerName: 'Amount', field: 'amountCents', type: 'rightAligned', filter: 'agNumberColumnFilter', valueGetter: (p) => ((p.data?.kind === 'refund' ? -1 : 1) * (p.data?.amountCents ?? 0)) / 100, valueFormatter: (p) => money(Math.round((p.value as number) * 100), true), width: 130 },
    { headerName: 'Fee', headerTooltip: 'PayPal fee', field: 'feeCents', type: 'rightAligned', valueFormatter: (p) => money(p.value as number), filter: 'agNumberColumnFilter', width: 100 },
    { headerName: 'Customer', field: 'customer', filter: 'agTextColumnFilter', width: 130 },
    { headerName: 'Alerts', field: 'alerts', valueGetter: (p) => (p.data?.alerts ?? []).map((a) => `#${a.id} ${SEVERITY_LABEL[a.severity]}`).join(', '), filter: 'agTextColumnFilter', width: 150 },
    { headerName: 'Source', field: 'source', valueFormatter: (p) => (p.value === 'synthetic' ? 'Demo' : 'PayPal'), width: 110 },
    { headerName: 'Note', headerTooltip: 'Free text from the payer. HIVE shows it as plain text and never follows it.', field: 'note', flex: 1, minWidth: 160, valueGetter: (p) => (p.data?.noteFlagged ? `Flagged as instruction: ${p.data.note}` : (p.data?.note ?? '')) },
    { headerName: 'Id', field: 'id', width: 150 },
  ], []);

  const rowClass = (p: RowClassParams<Txn>) => (p.data?.alerts.length ? `row-alert-${p.data.alerts[0]!.severity}` : '');

  return (
    <section className="panel analytics" aria-labelledby="a-h">
      <div className="row between">
        <div>
          <h2 id="a-h">Transactions</h2>
          <p className="muted">Filter, sort and search every payment, refund and failed attempt. Rows tied to an alert are marked.</p>
        </div>
        <div className="row">
          <label htmlFor="a-q" className="sr">Search transactions</label>
          <input id="a-q" className="search" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Search anything" />
        </div>
      </div>
      {focus && (
        <p className="focus-bar" role="status">
          Showing {rows.length} {rows.length === 1 ? 'transaction' : 'transactions'}: {focus.label}.
          <button className="link" onClick={onClear}>Show all</button>
        </p>
      )}
      <div className="grid-wrap">
        <AgGridReact<Txn>
          theme={theme}
          rowData={rows}
          columnDefs={cols}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          quickFilterText={quick}
          getRowClass={rowClass}
          pagination
          paginationPageSize={25}
          paginationPageSizeSelector={[25, 50, 100]}
          getRowId={(p) => p.data.id}
          overlayNoRowsTemplate="No transactions match. Clear the search or the focus above."
        />
      </div>
    </section>
  );
}
